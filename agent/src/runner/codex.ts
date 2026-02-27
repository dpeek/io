import { createLogger, type Logger } from "@io/lib";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

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

function createDefaultTurnSandbox(workspace: PreparedWorkspace) {
  return {
    excludeSlashTmp: false,
    excludeTmpdirEnvVar: false,
    networkAccess: true,
    readOnlyAccess: { type: "fullAccess" } as const,
    type: "workspaceWrite" as const,
    writableRoots: [workspace.path],
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

function printDirectOutput(issueIdentifier: string, stream: "stderr" | "stdout", line: string) {
  const text = `[${issueIdentifier} ${stream}] ${line}\n`;
  if (stream === "stderr") {
    process.stderr.write(text);
    return;
  }
  process.stdout.write(text);
}

type WorkspaceLogWriter = {
  eventLogPath: string;
  stderrLogPath: string;
  stdoutLogPath: string;
  writeEvent: (event: string, data?: Record<string, unknown>) => void;
  writeStderr: (line: string) => void;
  writeStdout: (line: string) => void;
};

async function createWorkspaceLogWriter(workspace: PreparedWorkspace): Promise<WorkspaceLogWriter> {
  const logDir = join(workspace.path, ".agent");
  await mkdir(logDir, { recursive: true });
  const eventLogPath = join(logDir, "events.log");
  const stderrLogPath = join(logDir, "codex.stderr.log");
  const stdoutLogPath = join(logDir, "codex.stdout.jsonl");

  const appendLine = (path: string, line: string) => {
    void appendFile(path, `${line}\n`);
  };

  return {
    eventLogPath,
    stderrLogPath,
    stdoutLogPath,
    writeEvent(event, data) {
      appendLine(
        eventLogPath,
        JSON.stringify({
          data,
          event,
          ts: new Date().toISOString(),
        }),
      );
    },
    writeStderr(line) {
      appendLine(stderrLogPath, line);
    },
    writeStdout(line) {
      appendLine(stdoutLogPath, line);
    },
  };
}

export class CodexAppServerRunner {
  readonly #config: CodexConfig;
  readonly #log: Logger;

  constructor(config: CodexConfig, log: Logger = createLogger({ pkg: "agent" })) {
    this.#config = config;
    this.#log = log.child({ event_prefix: "codex" });
  }

  async run(options: {
    issue: AgentIssue;
    prompt: string;
    workspace: PreparedWorkspace;
  }): Promise<IssueRunResult> {
    const logs = await createWorkspaceLogWriter(options.workspace);
    const proc = Bun.spawn({
      cmd: ["bash", "-lc", this.#config.command],
      cwd: options.workspace.path,
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
    });
    const queue = new MessageQueue();
    const state: PendingTurnState = { inputRequired: false, stderr: [], stdout: [] };
    this.#log.info("session.starting", {
      issueIdentifier: options.issue.identifier,
      workspace: options.workspace.path,
    });
    logs.writeEvent("session.starting", {
      issueIdentifier: options.issue.identifier,
      workspace: options.workspace.path,
    });

    void readJsonLines(
      proc.stdout,
      (line) => {
        state.stdout.push(line);
        logs.writeStdout(line);
        printDirectOutput(options.issue.identifier, "stdout", line);
        try {
          const message = JSON.parse(line) as JsonRpcMessage;
          state.lastEvent = summarizeMessage(message);
          if (message.method && message.method !== "item/agentMessage/delta") {
            const data = {
              event: message.method,
              issueIdentifier: options.issue.identifier,
              ...summarizeParams(message.params),
              workspace: options.workspace.path,
            };
            this.#log.info("session.event", data);
            logs.writeEvent("session.event", data);
          }
          queue.push(message);
        } catch (error) {
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
        printDirectOutput(options.issue.identifier, "stderr", line);
        const data = {
          issueIdentifier: options.issue.identifier,
          line,
          workspace: options.workspace.path,
        };
        logs.writeStderr(line);
        logs.writeEvent("session.stderr", data);
      },
      () => undefined,
    );

    let nextId = 1;
    const sendLine = (line: string) => {
      proc.stdin.write(`${line}\n`);
    };
    const sendRequest = async <T>(method: string, params: unknown) => {
      const id = nextId++;
      const data = {
        id,
        issueIdentifier: options.issue.identifier,
        method,
        workspace: options.workspace.path,
      };
      this.#log.info("session.request", data);
      logs.writeEvent("session.request", data);
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
      logs.writeEvent("session.heartbeat", data);
    }, 15_000);

    const initializeId = nextId++;
    const initializeData = {
      id: initializeId,
      issueIdentifier: options.issue.identifier,
      method: "initialize",
      workspace: options.workspace.path,
    };
    this.#log.info("session.request", initializeData);
    logs.writeEvent("session.request", initializeData);
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
    logs.writeEvent("session.started", sessionStartedData);
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
    logs.writeEvent("turn.started", turnStartedData);

    try {
      await this.#waitForTurnCompletion(queue, state, options.workspace.path, sendLine);
      const turnCompletedData = {
        issueIdentifier: options.issue.identifier,
        threadId,
        turnId,
        workspace: options.workspace.path,
      };
      this.#log.info("turn.completed", turnCompletedData);
      logs.writeEvent("turn.completed", turnCompletedData);
      return {
        issue: options.issue,
        logPaths: {
          eventLog: logs.eventLogPath,
          stderrLog: logs.stderrLogPath,
          stdoutLog: logs.stdoutLogPath,
        },
        prompt: options.prompt,
        sessionId: `${threadId}-${turnId}`,
        stderr: state.stderr,
        stdout: state.stdout,
        success: !state.inputRequired,
        threadId,
        turnId,
        workspace: options.workspace,
      };
    } finally {
      clearInterval(heartbeat);
      logs.writeEvent("session.stopping", {
        issueIdentifier: options.issue.identifier,
        threadId: heartbeatThreadId,
        turnId: heartbeatTurnId,
        workspace: options.workspace.path,
      });
      try {
        proc.kill();
      } catch {
        // ignore
      }
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
        state.inputRequired = true;
        const response: ToolRequestUserInputResponse = { answers: {} };
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
