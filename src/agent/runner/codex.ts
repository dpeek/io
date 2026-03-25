import { appendFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";

import { createLogger, type Logger } from "@io/core/lib";

import type {
  ApplyPatchApprovalResponse,
  ExecCommandApprovalResponse,
  InitializeParams,
  InitializeResponse,
  ServerRequest,
} from "../plugin/codex/server/api/index.js";
import type {
  CommandExecutionRequestApprovalResponse,
  DynamicToolCallResponse,
  FileChangeRequestApprovalResponse,
  ThreadStartParams,
  ThreadStartResponse,
  ToolRequestUserInputParams,
  ToolRequestUserInputQuestion,
  ToolRequestUserInputResponse,
  TurnStartParams,
  TurnStartResponse,
} from "../plugin/codex/server/api/v2/index.js";
import {
  closeAgentSessionDisplayLine,
  createAgentSessionDisplayState,
  createAgentSessionEventBus,
  renderAgentStatusEvent,
  renderCodexNotificationEvent,
  type AgentCodexNotificationEventInit,
  type AgentRawLineEventInit,
  type AgentSessionEventBus,
  type AgentSessionEventInit,
  type AgentSessionEventObserver,
  type AgentSessionLifecycleEventInit,
  type AgentSessionRef,
  type AgentStatusEventInit,
} from "../tui/index.js";
import type { AgentIssue, CodexConfig, IssueRunResult, PreparedWorkspace } from "../types.js";
import {
  isJsonRpcErrorResponse,
  isJsonRpcSuccessResponse,
  isServerNotificationMessage,
  isServerRequestMessage,
  summarizeCodexMessage,
  summarizeCodexParams,
  toCodexNotificationEvent,
  type CodexSessionMessage,
} from "./codex-events.js";

export { toCodexNotificationEvent, type CodexSessionMessage } from "./codex-events.js";

type PendingTurnState = {
  inputRequired: boolean;
  lastEvent?: string;
  stderr: string[];
  stdout: string[];
};

class MessageQueue {
  #closed = false;
  #error?: Error;
  #messages: CodexSessionMessage[] = [];
  #resolvers: Array<(message: CodexSessionMessage) => void> = [];

  close(error?: Error) {
    this.#closed = true;
    this.#error = error;
    while (this.#resolvers.length) {
      const resolve = this.#resolvers.shift();
      resolve?.({ error: { message: error?.message ?? "closed" } });
    }
  }

  push(message: CodexSessionMessage) {
    const resolve = this.#resolvers.shift();
    if (resolve) {
      resolve(message);
      return;
    }
    this.#messages.push(message);
  }

  async take(timeoutMs: number): Promise<CodexSessionMessage> {
    if (this.#messages.length) {
      return this.#messages.shift()!;
    }
    if (this.#closed) {
      throw this.#error ?? new Error("codex_app_server_closed");
    }
    return await new Promise<CodexSessionMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#resolvers = this.#resolvers.filter((entry) => entry !== onResolve);
        reject(new Error("response_timeout"));
      }, timeoutMs);
      const onResolve = (message: CodexSessionMessage) => {
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

function toWireSandboxPolicy(
  policy:
    | CodexConfig["turnSandboxPolicy"]
    | ReturnType<typeof createDefaultTurnSandbox>
    | undefined,
): TurnStartParams["sandboxPolicy"] {
  if (!policy) {
    return undefined;
  }
  if (policy.type === "externalSandbox") {
    if (policy.networkAccess === "disabled") {
      throw new Error('Codex v2 does not support `externalSandbox.networkAccess: "disabled"`.');
    }
    return {
      networkAccess: policy.networkAccess,
      type: "externalSandbox",
    };
  }
  return policy;
}

function chooseApprovalOptionLabel(question: ToolRequestUserInputQuestion) {
  const labels = (question.options ?? []).map((option) => option.label).filter(Boolean);
  return (
    labels.find((label) => /^approve this session$/i.test(label)) ??
    labels.find((label) => /^approve once$/i.test(label)) ??
    labels.find((label) => /^(approve|allow|accept|yes)\b/i.test(label)) ??
    labels.find((label) => !/^(deny|decline|cancel)\b/i.test(label))
  );
}

export function buildAutomaticUserInputResponse(
  params: Pick<ToolRequestUserInputParams, "questions">,
): ToolRequestUserInputResponse | undefined {
  const { questions } = params;
  if (!questions.length) {
    return undefined;
  }

  const answers: ToolRequestUserInputResponse["answers"] = {};
  for (const question of questions) {
    const label = chooseApprovalOptionLabel(question);
    if (!question.id || !label) {
      return undefined;
    }
    answers[question.id] = { answers: [label] };
  }
  return { answers };
}

type RunnerSessionEvent =
  | Omit<AgentCodexNotificationEventInit, "session">
  | Omit<AgentStatusEventInit, "session">
  | Omit<AgentRawLineEventInit, "session">
  | Omit<AgentSessionLifecycleEventInit, "session">;

function formatRawLineOutput(session: AgentSessionRef, stream: "stdout" | "stderr", line: string) {
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

      if (event.type === "codex-notification") {
        renderCodexNotificationEvent({
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

      closeAgentSessionDisplayLine({
        state: displayState,
        writeDisplay: (text) => {
          enqueueAppend(displayLogPath, text);
          enqueueAppend(mainOutputPath, text);
        },
      });

      if (event.stream === "stdout") {
        appendLine(stdoutLogPath, event.line);
        if (event.encoding === "text") {
          enqueueAppend(
            mainOutputPath,
            formatRawLineOutput(event.session, event.stream, event.line),
          );
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
          const message = JSON.parse(line) as CodexSessionMessage;
          publish({
            encoding: "jsonl",
            line,
            stream: "stdout",
            type: "raw-line",
          });
          const codexEvent = toCodexNotificationEvent(message);
          if (codexEvent) {
            publish(codexEvent);
          }
          state.lastEvent = summarizeCodexMessage(message);
          if (
            (isServerNotificationMessage(message) || isServerRequestMessage(message)) &&
            message.method !== "item/agentMessage/delta"
          ) {
            this.#log.info("session.event", {
              event: message.method,
              issueIdentifier: options.issue.identifier,
              ...summarizeCodexParams(message.params),
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
    await this.#waitForResponse<InitializeResponse>(
      initializeId,
      queue,
      state,
      options.workspace.path,
      sendLine,
    );
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
      sandboxPolicy: toWireSandboxPolicy(
        this.#config.turnSandboxPolicy ?? createDefaultTurnSandbox(options.workspace),
      ),
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
    message: ServerRequest,
    workspacePath: string,
    state: PendingTurnState,
  ) {
    const requestId = message.id;
    switch (message.method) {
      case "item/commandExecution/requestApproval": {
        const response: CommandExecutionRequestApprovalResponse = { decision: "acceptForSession" };
        return JSON.stringify({ id: requestId, result: response });
      }
      case "execCommandApproval": {
        const response: ExecCommandApprovalResponse = { decision: "approved_for_session" };
        return JSON.stringify({ id: requestId, result: response });
      }
      case "item/fileChange/requestApproval": {
        const response: FileChangeRequestApprovalResponse = { decision: "acceptForSession" };
        return JSON.stringify({ id: requestId, result: response });
      }
      case "applyPatchApproval": {
        const response: ApplyPatchApprovalResponse = { decision: "approved_for_session" };
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
      if (isJsonRpcSuccessResponse(message) && message.id === id) {
        return message.result as T;
      }
      if (isJsonRpcErrorResponse(message) && message.id === id) {
        throw new Error(message.error.message ?? "response_error");
      }
      if (isServerRequestMessage(message)) {
        const response = await this.#handleServerRequest(message, workspacePath, state);
        if (response) {
          sendLine(response);
        }
        continue;
      }
      if ("method" in message && message.method === "malformed") {
        throw new Error(message.error.message);
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
      if (isServerRequestMessage(message)) {
        const response = await this.#handleServerRequest(message, workspacePath, state);
        if (response) {
          sendLine(response);
        }
        continue;
      }
      if (isServerNotificationMessage(message) && message.method === "turn/completed") {
        if (state.inputRequired) {
          throw new Error("turn_input_required");
        }
        if (message.params.turn.status === "failed") {
          throw new Error(message.params.turn.error?.message ?? "turn_failed");
        }
        if (message.params.turn.status === "interrupted") {
          throw new Error("turn_interrupted");
        }
        return;
      }
      if (isServerNotificationMessage(message) && message.method === "error") {
        throw new Error(message.params.error.message);
      }
      if ("method" in message && message.method === "malformed") {
        throw new Error(message.error.message);
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
