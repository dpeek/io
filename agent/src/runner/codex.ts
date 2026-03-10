import { createLogger, type Logger } from "@io/lib";
import { appendFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";

import type {
  CommandExecutionRequestApprovalResponse,
  DynamicToolCallResponse,
  FileChangeRequestApprovalResponse,
  InitializeParams,
  ThreadStartParams,
  ThreadStartResponse,
  ToolRequestUserInputResponse,
  TurnStartParams,
  TurnStartResponse,
} from "../codex-schema.js";
import {
  createAgentSessionDisplayState,
  createAgentSessionEventBus,
  renderAgentStatusEvent,
  type AgentSessionEventBus,
  type AgentSessionEventInit,
  type AgentSessionLifecycleEventInit,
  type AgentSessionEventObserver,
  type AgentRawLineEventInit,
  type AgentSessionRef,
  type AgentStatusEventInit,
} from "../session-events.js";
import type { AgentIssue, CodexConfig, IssueRunResult, PreparedWorkspace } from "../types.js";

type JsonRpcMessage = {
  error?: { message?: string };
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
};

type PendingTurnState = {
  inputRequired: boolean;
  lastEvent?: string;
  stderr: string[];
  stdout: string[];
};

class MessageQueue {
  #closed = false;
  #error?: Error;
  #messages: JsonRpcMessage[] = [];
  #resolvers: Array<(message: JsonRpcMessage) => void> = [];

  close(error?: Error) {
    this.#closed = true;
    this.#error = error;
    while (this.#resolvers.length) {
      const resolve = this.#resolvers.shift();
      resolve?.({ error: { message: error?.message ?? "closed" } });
    }
  }

  push(message: JsonRpcMessage) {
    const resolve = this.#resolvers.shift();
    if (resolve) {
      resolve(message);
      return;
    }
    this.#messages.push(message);
  }

  async take(timeoutMs: number): Promise<JsonRpcMessage> {
    if (this.#messages.length) {
      return this.#messages.shift()!;
    }
    if (this.#closed) {
      throw this.#error ?? new Error("codex_app_server_closed");
    }
    return await new Promise<JsonRpcMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#resolvers = this.#resolvers.filter((entry) => entry !== onResolve);
        reject(new Error("response_timeout"));
      }, timeoutMs);
      const onResolve = (message: JsonRpcMessage) => {
        clearTimeout(timer);
        resolve(message);
      };
      this.#resolvers.push(onResolve);
    });
  }
}

async function readJsonLines(
  stream: ReadableStream<Uint8Array> | null | undefined,
  onLine: (line: string) => void,
  onDone: (error?: Error) => void,
) {
  if (!stream) {
    onDone();
    return;
  }
  const reader = new Response(stream).body?.pipeThrough(new TextDecoderStream()).getReader();
  if (!reader) {
    onDone();
    return;
  }
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += value ?? "";
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          onLine(trimmed);
        }
      }
    }
    if (buffer.trim()) {
      onLine(buffer.trim());
    }
    onDone();
  } catch (error) {
    onDone(error instanceof Error ? error : new Error(String(error)));
  }
}

function toRequest<T>(id: number, method: string, params: T) {
  return JSON.stringify({ id, method, params });
}

function toNotification(method: string, params?: unknown) {
  return JSON.stringify(params === undefined ? { method } : { method, params });
}

function uniquePaths(paths: Array<string | undefined>) {
  return Array.from(new Set(paths.filter((value): value is string => Boolean(value))));
}

export function createDefaultTurnSandbox(workspace: PreparedWorkspace) {
  const controlGitPath =
    basename(workspace.controlPath) === ".git" || workspace.controlPath.endsWith(".git")
      ? workspace.controlPath
      : join(workspace.controlPath, ".git");
  const originGitPath =
    basename(workspace.originPath) === ".git" || workspace.originPath.endsWith(".git")
      ? undefined
      : join(workspace.originPath, ".git");
  return {
    excludeSlashTmp: false,
    excludeTmpdirEnvVar: false,
    networkAccess: true,
    readOnlyAccess: { type: "fullAccess" } as const,
    type: "workspaceWrite" as const,
    writableRoots: uniquePaths([
      workspace.path,
      workspace.controlPath,
      controlGitPath,
      workspace.originPath,
      originGitPath,
    ]),
  };
}

function summarizeMessage(message: JsonRpcMessage) {
  if (message.method) {
    return message.method;
  }
  if (message.id !== undefined && message.error) {
    return `response:error:${message.id}`;
  }
  if (message.id !== undefined && "result" in message) {
    return `response:ok:${message.id}`;
  }
  return "message:unknown";
}

function summarizeParams(params: unknown) {
  if (!params || typeof params !== "object") {
    return undefined;
  }
  const record = params as Record<string, unknown>;
  return {
    itemId: typeof record.itemId === "string" ? record.itemId : undefined,
    threadId: typeof record.threadId === "string" ? record.threadId : undefined,
    turnId: typeof record.turnId === "string" ? record.turnId : undefined,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function summarizeCommandAction(action: unknown) {
  const record = asRecord(action);
  return asString(record?.command) ?? asString(record?.cmd);
}

function summarizeCommandExecution(item: Record<string, unknown>) {
  const actions = Array.isArray(item.commandActions) ? item.commandActions : [];
  const actionCommand = actions.map(summarizeCommandAction).find(Boolean);
  return actionCommand ?? asString(item.command) ?? "command";
}

function summarizeToolCall(item: Record<string, unknown>) {
  const server = asString(item.server) ?? "tool";
  const tool = asString(item.tool) ?? "call";
  const argumentsText =
    item.arguments && typeof item.arguments === "object"
      ? ` ${JSON.stringify(item.arguments)}`
      : "";
  return `${server}.${tool}${argumentsText}`;
}

function formatQuestionSummary(question: unknown) {
  const record = asRecord(question);
  const header = asString(record?.header);
  const prompt = asString(record?.question);
  return [header, prompt].filter(Boolean).join(": ");
}

function chooseApprovalOptionLabel(question: unknown) {
  const record = asRecord(question);
  const options = Array.isArray(record?.options) ? record.options : [];
  const labels = options
    .map((option) => asString(asRecord(option)?.label))
    .filter((label): label is string => Boolean(label));
  return (
    labels.find((label) => /^approve this session$/i.test(label)) ??
    labels.find((label) => /^approve once$/i.test(label)) ??
    labels.find((label) => /^(approve|allow|accept|yes)\b/i.test(label)) ??
    labels.find((label) => !/^(deny|decline|cancel)\b/i.test(label))
  );
}

export function buildAutomaticUserInputResponse(
  params: unknown,
): ToolRequestUserInputResponse | undefined {
  const record = asRecord(params);
  const questions = Array.isArray(record?.questions) ? record.questions : [];
  if (!questions.length) {
    return undefined;
  }

  const answers: ToolRequestUserInputResponse["answers"] = {};
  for (const question of questions) {
    const questionRecord = asRecord(question);
    const questionId = asString(questionRecord?.id);
    const label = chooseApprovalOptionLabel(question);
    if (!questionId || !label) {
      return undefined;
    }
    answers[questionId] = { answers: [label] };
  }
  return { answers };
}

type CodexStatusEvent = Omit<AgentStatusEventInit, "session">;
type RunnerSessionEvent =
  | CodexStatusEvent
  | Omit<AgentRawLineEventInit, "session">
  | Omit<AgentSessionLifecycleEventInit, "session">;

function renderCommandOutput(output: string): CodexStatusEvent[] {
  const normalized = output.replace(/\r\n/g, "\n").replace(/\n$/, "");
  if (!normalized) {
    return [];
  }
  return normalized.split("\n").map((line) => ({
    code: "command-output",
    format: "line",
    text: `| ${line}`,
    type: "status",
  }));
}

export function normalizeCodexSessionMessage(message: JsonRpcMessage): CodexStatusEvent[] {
  switch (message.method) {
    case "thread/started":
      return [{ code: "thread-started", format: "line", text: "Session started", type: "status" }];
    case "turn/started":
      return [{ code: "turn-started", format: "line", text: "Turn started", type: "status" }];
    case "turn/completed":
      return [{ code: "turn-completed", format: "line", text: "Turn completed", type: "status" }];
    case "turn/cancelled":
      return [{ code: "turn-cancelled", format: "line", text: "Turn cancelled", type: "status" }];
    case "turn/failed":
      return [{ code: "turn-failed", format: "line", text: "Turn failed", type: "status" }];
    case "thread/status/changed": {
      const params = asRecord(message.params);
      const status = asRecord(params?.status);
      const activeFlags = Array.isArray(status?.activeFlags) ? status.activeFlags : [];
      if (!activeFlags.includes("waitingOnUserInput")) {
        return [];
      }
      return [
        {
          code: "waiting-on-user-input",
          format: "line",
          text: "Waiting for user input",
          type: "status",
        },
      ];
    }
    case "item/started": {
      const params = asRecord(message.params);
      const item = asRecord(params?.item);
      const itemType = asString(item?.type);
      if (!item || !itemType) {
        return [];
      }
      if (itemType === "commandExecution") {
        return [
          {
            code: "command",
            format: "line",
            text: `$ ${summarizeCommandExecution(item)}`,
            type: "status",
          },
        ];
      }
      if (itemType === "mcpToolCall") {
        return [
          {
            code: "tool",
            format: "line",
            text: `Tool: ${summarizeToolCall(item)}`,
            type: "status",
          },
        ];
      }
      return [];
    }
    case "item/agentMessage/delta": {
      const params = asRecord(message.params);
      const delta = asString(params?.delta) ?? "";
      if (!delta) {
        return [];
      }
      return [
        {
          code: "agent-message-delta",
          format: "chunk",
          itemId: asString(params?.itemId),
          text: delta,
          type: "status",
        },
      ];
    }
    case "item/tool/requestUserInput": {
      const params = asRecord(message.params);
      const questions = Array.isArray(params?.questions) ? params.questions : [];
      const summary = questions.map(formatQuestionSummary).filter(Boolean).join(" | ");
      return [
        {
          code: "approval-required",
          format: "line",
          text: summary ? `Approval required: ${summary}` : "Approval required",
          type: "status",
        },
      ];
    }
    case "item/completed": {
      const params = asRecord(message.params);
      const item = asRecord(params?.item);
      const itemType = asString(item?.type);
      if (!item || !itemType) {
        return [];
      }
      if (itemType === "agentMessage") {
        return [
          {
            code: "agent-message-completed",
            format: "close",
            itemId: asString(item.id),
            type: "status",
          },
        ];
      }
      if (itemType === "commandExecution") {
        const events = renderCommandOutput(asString(item.aggregatedOutput) ?? "");
        const status = asString(item.status);
        const exitCode = item.exitCode;
        if (status === "failed") {
          const suffix = typeof exitCode === "number" ? ` (exit ${exitCode})` : "";
          events.push({
            code: "command-failed",
            format: "line",
            text: `Command failed${suffix}`,
            type: "status",
          });
        }
        return events;
      }
      if (itemType === "mcpToolCall") {
        const error = asRecord(item.error);
        const errorMessage = asString(error?.message);
        if (!errorMessage) {
          return [];
        }
        return [
          {
            code: "tool-failed",
            format: "line",
            text: `Tool failed: ${errorMessage}`,
            type: "status",
          },
        ];
      }
      return [];
    }
    case "error":
      return [
        {
          code: "error",
          format: "line",
          text: `Error: ${JSON.stringify(message.params)}`,
          type: "status",
        },
      ];
    default:
      return [];
  }
}

function formatRawLineOutput(
  session: AgentSessionRef,
  stream: "stdout" | "stderr",
  line: string,
) {
  const issueIdentifier = session.issue?.identifier ?? session.workerId;
  return `[${issueIdentifier} ${stream}] ${line}\n`;
}

type WorkspaceLogObserver = {
  displayLogPath: string;
  eventLogPath: string;
  flush: () => Promise<void>;
  mainOutputPath: string;
  observe: AgentSessionEventObserver;
  stderrLogPath: string;
  stdoutLogPath: string;
};

async function createWorkspaceLogObserver(
  workspace: PreparedWorkspace,
  sessionId: string,
): Promise<WorkspaceLogObserver> {
  if (!workspace.runtimePath) {
    throw new Error("workspace_runtime_path_missing");
  }
  const logDir = workspace.runtimePath;
  await mkdir(logDir, { recursive: true });
  const displayLogPath = join(logDir, "codex.session.log");
  const eventLogPath = join(logDir, "events.log");
  const mainOutputPath = workspace.outputPath ?? join(logDir, "output.log");
  const stderrLogPath = join(logDir, "codex.stderr.log");
  const stdoutLogPath = join(logDir, "codex.stdout.jsonl");
  const displayState = createAgentSessionDisplayState();

  let pending = Promise.resolve();
  const enqueueAppend = (path: string, text: string) => {
    pending = pending.then(() => appendFile(path, text));
  };
  const appendLine = (path: string, line: string) => {
    enqueueAppend(path, `${line}\n`);
  };

  return {
    displayLogPath,
    eventLogPath,
    flush() {
      return pending;
    },
    mainOutputPath,
    observe(event) {
      if (event.session.id !== sessionId) {
        return;
      }

      appendLine(eventLogPath, JSON.stringify(event));

      if (event.type === "status") {
        renderAgentStatusEvent({
          event,
          state: displayState,
          writeDisplay: (text) => {
            enqueueAppend(displayLogPath, text);
            enqueueAppend(mainOutputPath, text);
          },
        });
        return;
      }

      if (event.type !== "raw-line") {
        return;
      }

      if (event.stream === "stdout") {
        appendLine(stdoutLogPath, event.line);
        if (event.encoding === "text") {
          enqueueAppend(mainOutputPath, formatRawLineOutput(event.session, event.stream, event.line));
        }
        return;
      }

      appendLine(stderrLogPath, event.line);
      enqueueAppend(mainOutputPath, formatRawLineOutput(event.session, event.stream, event.line));
    },
    stderrLogPath,
    stdoutLogPath,
  };
}

export interface CodexAppServerRunnerOptions {
  sessionEvents?: AgentSessionEventBus;
}

export class CodexAppServerRunner {
  readonly #config: CodexConfig;
  readonly #log: Logger;
  readonly #sessionEvents: AgentSessionEventBus;

  constructor(
    config: CodexConfig,
    log: Logger = createLogger({ pkg: "agent" }),
    options: CodexAppServerRunnerOptions = {},
  ) {
    this.#config = config;
    this.#log = log.child({ event_prefix: "codex" });
    this.#sessionEvents = options.sessionEvents ?? createAgentSessionEventBus();
  }

  async run(options: {
    issue: AgentIssue;
    prompt: string;
    session?: AgentSessionRef;
    workspace: PreparedWorkspace;
  }): Promise<IssueRunResult> {
    let session = options.session ?? {
      branchName: options.workspace.branchName,
      id: `worker:${options.workspace.workerId}`,
      issue: {
        id: options.issue.id,
        identifier: options.issue.identifier,
        title: options.issue.title,
      },
      kind: "worker" as const,
      rootSessionId: `worker:${options.workspace.workerId}`,
      title: options.issue.title,
      workerId: options.workspace.workerId,
      workspacePath: options.workspace.path,
    };
    const logs = await createWorkspaceLogObserver(options.workspace, session.id);
    const publish = (event: RunnerSessionEvent) => {
      const stampedEvent = this.#sessionEvents.publish({
        ...event,
        session,
      } as AgentSessionEventInit);
      logs.observe(stampedEvent);
      return stampedEvent;
    };
    const proc = Bun.spawn({
      cmd: ["bash", "-lc", this.#config.command],
      cwd: options.workspace.path,
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
    });
    const queue = new MessageQueue();
    const state: PendingTurnState = {
      inputRequired: false,
      stderr: [],
      stdout: [],
    };
    this.#log.info("session.starting", {
      issueIdentifier: options.issue.identifier,
      workspace: options.workspace.path,
    });

    void readJsonLines(
      proc.stdout,
      (line) => {
        state.stdout.push(line);
        try {
          const message = JSON.parse(line) as JsonRpcMessage;
          publish({
            encoding: "jsonl",
            line,
            stream: "stdout",
            type: "raw-line",
          });
          for (const event of normalizeCodexSessionMessage(message)) {
            publish(event);
          }
          state.lastEvent = summarizeMessage(message);
          if (message.method && message.method !== "item/agentMessage/delta") {
            this.#log.info("session.event", {
              event: message.method,
              issueIdentifier: options.issue.identifier,
              ...summarizeParams(message.params),
              workspace: options.workspace.path,
            });
          }
          queue.push(message);
        } catch (error) {
          publish({
            encoding: "text",
            line,
            stream: "stdout",
            type: "raw-line",
          });
          queue.push({
            error: { message: `malformed:${(error as Error).message}` },
            method: "malformed",
          });
        }
      },
      (error) => {
        queue.close(error);
      },
    );

    void readJsonLines(
      proc.stderr,
      (line) => {
        state.stderr.push(line);
        publish({
          encoding: "text",
          line,
          stream: "stderr",
          type: "raw-line",
        });
      },
      () => undefined,
    );

    let nextId = 1;
    const sendLine = (line: string) => {
      proc.stdin.write(`${line}\n`);
    };
    const sendRequest = async <T>(method: string, params: unknown) => {
      const id = nextId++;
      this.#log.info("session.request", {
        id,
        issueIdentifier: options.issue.identifier,
        method,
        workspace: options.workspace.path,
      });
      sendLine(toRequest(id, method, params));
      return await this.#waitForResponse<T>(id, queue, state, options.workspace.path, sendLine);
    };

    let heartbeatThreadId: string | undefined;
    let heartbeatTurnId: string | undefined;
    const heartbeat = setInterval(() => {
      const data = {
        issueIdentifier: options.issue.identifier,
        lastEvent: state.lastEvent,
        threadId: heartbeatThreadId,
        turnId: heartbeatTurnId,
        workspace: options.workspace.path,
      };
      this.#log.info("session.heartbeat", data);
    }, 15_000);

    const initializeId = nextId++;
    const initializeData = {
      id: initializeId,
      issueIdentifier: options.issue.identifier,
      method: "initialize",
      workspace: options.workspace.path,
    };
    this.#log.info("session.request", initializeData);
    sendLine(
      toRequest<InitializeParams>(initializeId, "initialize", {
        capabilities: null,
        clientInfo: { name: "opensurf-agent", title: "OpenSurf Agent", version: "0.0.0" },
      }),
    );
    await this.#waitForResponse(initializeId, queue, state, options.workspace.path, sendLine);
    sendLine(toNotification("initialized"));
    const thread = await sendRequest<ThreadStartResponse>("thread/start", {
      approvalPolicy: this.#config.approvalPolicy,
      cwd: options.workspace.path,
      experimentalRawEvents: false,
      persistExtendedHistory: false,
      sandbox: this.#config.threadSandbox,
    } satisfies ThreadStartParams);
    const threadId = thread.thread.id;
    heartbeatThreadId = threadId;
    const sessionStartedData = {
      issueIdentifier: options.issue.identifier,
      threadId,
      workspace: options.workspace.path,
    };
    this.#log.info("session.started", sessionStartedData);
    const turn = await sendRequest<TurnStartResponse>("turn/start", {
      approvalPolicy: this.#config.approvalPolicy,
      cwd: options.workspace.path,
      input: [{ text: options.prompt, text_elements: [], type: "text" }],
      sandboxPolicy: this.#config.turnSandboxPolicy ?? createDefaultTurnSandbox(options.workspace),
      threadId,
    } satisfies TurnStartParams);
    const turnId = turn.turn.id;
    heartbeatTurnId = turnId;
    const turnStartedData = {
      issueIdentifier: options.issue.identifier,
      threadId,
      turnId,
      workspace: options.workspace.path,
    };
    this.#log.info("turn.started", turnStartedData);
    session = {
      ...session,
      threadId,
      turnId,
    };
    publish({
      data: {
        workspacePath: options.workspace.path,
      },
      phase: "started",
      type: "session",
    });

    try {
      await this.#waitForTurnCompletion(queue, state, options.workspace.path, sendLine);
      const result = {
        issue: options.issue,
        logPaths: {
          eventLog: logs.eventLogPath,
          mainOutput: logs.mainOutputPath,
          stderrLog: logs.stderrLogPath,
          stdoutLog: logs.stdoutLogPath,
        },
        prompt: options.prompt,
        sessionId: session.id,
        stderr: state.stderr,
        stdout: state.stdout,
        success: !state.inputRequired,
        threadId,
        turnId,
        workspace: options.workspace,
      };
      await logs.flush();
      return result;
    } catch (error) {
      publish({
        data: {
          reason: error instanceof Error ? error.message : String(error),
        },
        phase: "failed",
        type: "session",
      });
      throw error;
    } finally {
      clearInterval(heartbeat);
      publish({
        data: {
          threadId: heartbeatThreadId,
          turnId: heartbeatTurnId,
          workspacePath: options.workspace.path,
        },
        phase: "stopped",
        type: "session",
      });
      try {
        proc.kill();
      } catch {
        // ignore
      }
      await logs.flush();
    }
  }

  async #handleServerRequest(
    message: JsonRpcMessage,
    workspacePath: string,
    state: PendingTurnState,
  ) {
    const requestId = message.id;
    if (requestId === undefined) {
      return;
    }
    switch (message.method) {
      case "item/commandExecution/requestApproval":
      case "execCommandApproval": {
        const response: CommandExecutionRequestApprovalResponse = { decision: "acceptForSession" };
        return JSON.stringify({ id: requestId, result: response });
      }
      case "item/fileChange/requestApproval":
      case "applyPatchApproval": {
        const response: FileChangeRequestApprovalResponse = { decision: "acceptForSession" };
        return JSON.stringify({ id: requestId, result: response });
      }
      case "item/tool/call": {
        const response: DynamicToolCallResponse = {
          contentItems: [{ text: "unsupported_tool_call", type: "inputText" }],
          success: false,
        };
        return JSON.stringify({ id: requestId, result: response });
      }
      case "item/tool/requestUserInput": {
        const response = buildAutomaticUserInputResponse(message.params);
        if (!response) {
          state.inputRequired = true;
          return JSON.stringify({
            id: requestId,
            result: { answers: {} } satisfies ToolRequestUserInputResponse,
          });
        }
        return JSON.stringify({ id: requestId, result: response });
      }
      default:
        this.#log.warn("server_request.unsupported", {
          method: message.method,
          workspacePath,
        });
        return JSON.stringify({
          error: { code: -32601, message: `unsupported request: ${message.method}` },
          id: requestId,
        });
    }
  }

  async #waitForResponse<T>(
    id: number,
    queue: MessageQueue,
    state: PendingTurnState,
    workspacePath: string,
    sendLine: (line: string) => void,
  ): Promise<T> {
    for (;;) {
      const message = await queue.take(this.#config.readTimeoutMs);
      if (message.id === id && "result" in message) {
        return message.result as T;
      }
      if (message.id === id && message.error) {
        throw new Error(message.error.message ?? "response_error");
      }
      if (message.method && message.id !== undefined) {
        const response = await this.#handleServerRequest(message, workspacePath, state);
        if (response) {
          sendLine(response);
        }
        continue;
      }
      if (message.method === "malformed") {
        throw new Error(message.error?.message ?? "malformed");
      }
    }
  }

  async #waitForTurnCompletion(
    queue: MessageQueue,
    state: PendingTurnState,
    workspacePath: string,
    sendLine: (line: string) => void,
  ) {
    const turnDeadline = Date.now() + this.#config.turnTimeoutMs;
    let lastActivity = Date.now();
    for (;;) {
      const timeUntilTurnTimeout = Math.max(1, turnDeadline - Date.now());
      const timeUntilStallTimeout =
        this.#config.stallTimeoutMs > 0
          ? Math.max(1, this.#config.stallTimeoutMs - (Date.now() - lastActivity))
          : timeUntilTurnTimeout;
      const timeoutMs = Math.min(timeUntilTurnTimeout, timeUntilStallTimeout);
      const message = await queue.take(timeoutMs);
      lastActivity = Date.now();
      if (message.method && message.id !== undefined) {
        const response = await this.#handleServerRequest(message, workspacePath, state);
        if (response) {
          sendLine(response);
        }
        continue;
      }
      if (message.method === "turn/completed") {
        if (state.inputRequired) {
          throw new Error("turn_input_required");
        }
        return;
      }
      if (message.method === "turn/cancelled") {
        throw new Error("turn_cancelled");
      }
      if (message.method === "turn/failed") {
        throw new Error("turn_failed");
      }
      if (message.method === "error") {
        throw new Error(JSON.stringify(message.params));
      }
      if (message.method === "malformed") {
        throw new Error(message.error?.message ?? "malformed");
      }
      if (Date.now() >= turnDeadline) {
        throw new Error("turn_timeout");
      }
      if (
        this.#config.stallTimeoutMs > 0 &&
        Date.now() - lastActivity >= this.#config.stallTimeoutMs
      ) {
        throw new Error("stall_timeout");
      }
    }
  }
}
