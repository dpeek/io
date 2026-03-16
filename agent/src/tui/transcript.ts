import type {
  AgentCodexNotificationEvent,
  AgentRawLineEvent,
  AgentSessionDisplayState,
  AgentSessionEvent,
  AgentSessionEventObserver,
  AgentSessionPhase,
  AgentSessionRef,
  AgentStatusCode,
  AgentStatusEvent,
  AgentStatusFormat,
} from "./session-events.js";
import {
  appendCodexNotificationToBlocks,
  formatCodexNotificationSummary,
  renderCodexNotificationEvent as renderCodexNotificationEventImpl,
} from "./codex-event-stream.js";
import { summarizeLinearToolCall } from "./linear-tool-format.js";
export { createStatusSummaryFromCodexNotification } from "./codex-event-stream.js";

const DEFAULT_TRANSCRIPT_WAITING_MESSAGE = "Waiting for session transcript...";
const REASONING_SPINNER_FRAMES = ["|", "/", "-", "\\"];

type BlockTarget = {
  blocks: AgentTuiBlock[];
};

export interface AgentTuiStatusSummary {
  code: AgentStatusCode;
  data?: Record<string, unknown>;
  format: AgentStatusFormat;
  itemId?: string;
  text?: string;
  timestamp: string;
}

interface AgentTuiBlockBase {
  count: number;
  sequenceEnd: number;
  sequenceStart: number;
  timestamp: string;
}

export interface AgentTuiLifecycleEntry extends AgentTuiBlockBase {
  kind: "lifecycle";
  phase: AgentSessionPhase;
  text: string;
}

export interface AgentTuiStatusEntry extends AgentTuiBlockBase {
  code: AgentStatusCode;
  data?: Record<string, unknown>;
  format: AgentStatusFormat;
  itemId?: string;
  kind: "status";
  text: string;
}

export interface AgentTuiAgentMessageEntry extends AgentTuiBlockBase {
  itemId?: string;
  kind: "agent-message";
  segments: string[];
  text: string;
}

export interface AgentTuiCommandOutputEntry extends AgentTuiBlockBase {
  kind: "command-output";
  lines: string[];
}

export interface AgentTuiCommandEntry extends AgentTuiBlockBase {
  command: string;
  cwd?: string;
  exitCode?: number;
  itemId?: string;
  kind: "command";
  outputLines: string[];
  status: "completed" | "failed" | "running";
}

export interface AgentTuiToolEntry extends AgentTuiBlockBase {
  argumentsData?: unknown;
  argumentsText?: string;
  errorText?: string;
  itemId?: string;
  kind: "tool";
  resultData?: unknown;
  resultText?: string;
  server: string;
  status: "completed" | "failed" | "running";
  tool: string;
}

export interface AgentTuiApprovalEntry extends AgentTuiBlockBase {
  kind: "approval";
  text: string;
}

export interface AgentTuiPlanEntry extends AgentTuiBlockBase {
  itemId?: string;
  kind: "plan";
  status: "completed" | "streaming";
  text: string;
}

export interface AgentTuiReasoningEntry extends AgentTuiBlockBase {
  content: string[];
  itemId?: string;
  kind: "reasoning";
  status: "completed" | "streaming";
  summary: string[];
}

export interface AgentTuiRawEntry extends AgentTuiBlockBase {
  encoding: AgentRawLineEvent["encoding"];
  kind: "raw";
  lines: string[];
  stream: AgentRawLineEvent["stream"];
}

export interface AgentTuiMirrorEntry extends AgentTuiBlockBase {
  kind: "mirror";
  text: string;
}

export type AgentTuiBlock =
  | AgentTuiAgentMessageEntry
  | AgentTuiApprovalEntry
  | AgentTuiCommandEntry
  | AgentTuiCommandOutputEntry
  | AgentTuiLifecycleEntry
  | AgentTuiMirrorEntry
  | AgentTuiPlanEntry
  | AgentTuiRawEntry
  | AgentTuiReasoningEntry
  | AgentTuiStatusEntry
  | AgentTuiToolEntry;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function formatWorkerHeader(session: AgentSessionRef) {
  const issueIdentifier = session.issue?.identifier ?? session.workerId;
  const issueTitle = session.issue?.title ?? session.title;
  const workerPrefix = session.workerId ? `${session.workerId} ` : "";
  return `=== ${workerPrefix}${issueIdentifier} ${issueTitle} ===`;
}

function renderSessionText(
  text: string,
  state: AgentSessionDisplayState,
  writeDisplay: (text: string) => void,
) {
  if (!text) {
    return;
  }
  writeDisplay(text);
  state.lineOpen = !text.endsWith("\n");
}

function renderSessionLine(
  text: string,
  state: AgentSessionDisplayState,
  writeDisplay: (text: string) => void,
) {
  if (state.lineOpen) {
    writeDisplay("\n");
  }
  writeDisplay(`${text}\n`);
  state.lineOpen = false;
}

function closeSessionLine(
  state: AgentSessionDisplayState,
  writeDisplay: (text: string) => void,
) {
  if (!state.lineOpen) {
    return;
  }
  writeDisplay("\n");
  state.lineOpen = false;
}

export function createAgentSessionDisplayState(): AgentSessionDisplayState {
  return {
    headerPrinted: false,
    lineOpen: false,
  };
}

export function closeAgentSessionDisplayLine(options: {
  state: AgentSessionDisplayState;
  writeDisplay: (text: string) => void;
}) {
  closeSessionLine(options.state, options.writeDisplay);
}

function formatQuestionSummary(question: unknown) {
  const record = asRecord(question);
  const header = asString(record?.header);
  const prompt = asString(record?.question);
  return [header, prompt].filter(Boolean).join(": ");
}

function formatApprovalPromptText(data: Record<string, unknown> | undefined) {
  const questions = Array.isArray(data?.questions) ? data.questions : [];
  const summary = questions.map(formatQuestionSummary).filter(Boolean).join(" | ");
  return summary ? `Approval required: ${summary}` : "Approval required";
}

function formatToolCallText(data: Record<string, unknown> | undefined) {
  const server = asString(data?.server);
  const tool = asString(data?.tool);
  if (!server || !tool) {
    return undefined;
  }
  const argumentsText =
    data?.arguments && typeof data.arguments === "object" ? ` ${JSON.stringify(data.arguments)}` : "";
  return `Tool: ${server}.${tool}${argumentsText}`;
}

function formatCommandText(data: Record<string, unknown> | undefined) {
  const command = asString(data?.command);
  return command ? `$ ${command}` : undefined;
}

function formatCommandFailedText(data: Record<string, unknown> | undefined) {
  const exitCode = asNumber(data?.exitCode);
  return `Command failed${typeof exitCode === "number" ? ` (exit ${exitCode})` : ""}`;
}

function formatToolFailedText(data: Record<string, unknown> | undefined) {
  const message = asString(data?.message);
  return message ? `Tool failed: ${message}` : undefined;
}

function formatErrorText(data: Record<string, unknown> | undefined) {
  const details = [asString(data?.message), asString(data?.additionalDetails)].filter(Boolean).join(" ");
  return details ? `Error: ${details}` : undefined;
}

function getCommandOutputLines(event: AgentStatusEvent) {
  const lines = Array.isArray(event.data?.lines)
    ? event.data.lines
        .map((line) => asString(line))
        .filter((line): line is string => Boolean(line))
        .map((line) => line.replace(/^\|\s?/, ""))
    : [];
  if (lines.length) {
    return lines;
  }
  if (!event.text) {
    return [];
  }
  return [event.text.replace(/^\|\s?/, "")];
}

export function formatStatusEventText(event: AgentStatusEvent) {
  if (event.code === "agent-message-delta") {
    return event.text ?? "";
  }
  if (event.code === "command-output" || event.format === "close") {
    return undefined;
  }

  switch (event.code) {
    case "approval-required":
      return formatApprovalPromptText(event.data);
    case "command":
      return formatCommandText(event.data) ?? event.text;
    case "command-failed":
      return formatCommandFailedText(event.data) ?? event.text;
    case "error":
      return formatErrorText(event.data) ?? event.text;
    case "thread-started":
      return "Session started";
    case "tool":
      return formatToolCallText(event.data) ?? event.text;
    case "tool-failed":
      return formatToolFailedText(event.data) ?? event.text;
    case "turn-cancelled":
      return event.text ?? "Turn interrupted";
    case "turn-completed":
      return "Turn completed";
    case "turn-failed":
      return event.text ?? "Turn failed";
    case "turn-started":
      return "Turn started";
    case "waiting-on-user-input":
      return "Waiting for user input";
    default:
      return event.text ?? event.code;
  }
}

export function renderCodexNotificationEvent(options: {
  event: AgentCodexNotificationEvent;
  state: AgentSessionDisplayState;
  writeDisplay: (text: string) => void;
}) {
  renderCodexNotificationEventImpl({
    ...options,
    renderStatusEvent: renderAgentStatusEvent,
  });
}

export function renderAgentStatusEvent(options: {
  event: AgentStatusEvent;
  state: AgentSessionDisplayState;
  writeDisplay: (text: string) => void;
}) {
  const { event, state, writeDisplay } = options;
  if (event.session.kind === "worker" && !state.headerPrinted) {
    renderSessionLine(formatWorkerHeader(event.session), state, writeDisplay);
    state.headerPrinted = true;
  }

  switch (event.format) {
    case "chunk": {
      if (event.itemId && state.activeAgentMessageId && event.itemId !== state.activeAgentMessageId) {
        closeSessionLine(state, writeDisplay);
      }
      if (event.itemId) {
        state.activeAgentMessageId = event.itemId;
      }
      renderSessionText(event.text ?? "", state, writeDisplay);
      return;
    }
    case "close":
      closeSessionLine(state, writeDisplay);
      if (!event.itemId || event.itemId === state.activeAgentMessageId) {
        state.activeAgentMessageId = undefined;
      }
      return;
    case "line":
      if (event.code === "command-output") {
        for (const line of getCommandOutputLines(event)) {
          renderSessionLine(`| ${line}`, state, writeDisplay);
        }
        return;
      }
      renderSessionLine(formatStatusEventText(event) ?? "", state, writeDisplay);
      return;
  }
}

export function createAgentSessionStdoutObserver(): AgentSessionEventObserver {
  const displayStates = new Map<string, AgentSessionDisplayState>();

  return (event) => {
    if (event.type === "session") {
      return;
    }

    const displayState =
      displayStates.get(event.session.id) ??
      (() => {
        const state = createAgentSessionDisplayState();
        displayStates.set(event.session.id, state);
        return state;
      })();

    if (event.type === "status") {
      renderAgentStatusEvent({
        event,
        state: displayState,
        writeDisplay: (text) => {
          process.stdout.write(text);
        },
      });
      return;
    }

    if (event.type === "codex-notification") {
      renderCodexNotificationEvent({
        event,
        state: displayState,
        writeDisplay: (text) => {
          process.stdout.write(text);
        },
      });
      return;
    }

    if (event.stream === "stdout" && event.encoding !== "text") {
      return;
    }

    closeAgentSessionDisplayLine({
      state: displayState,
      writeDisplay: (text) => {
        process.stdout.write(text);
      },
    });

    const issueIdentifier = event.session.issue?.identifier ?? event.session.workerId;
    const text = `[${issueIdentifier} ${event.stream}] ${event.line}\n`;
    if (event.stream === "stderr") {
      process.stderr.write(text);
      return;
    }
    process.stdout.write(text);
  };
}

export function appendBlock(
  target: BlockTarget,
  entry: AgentTuiBlock,
) {
  target.blocks.push(entry);
}

export function formatLifecycleText(
  phase: AgentSessionPhase,
  data: Record<string, unknown> | undefined,
  session: AgentSessionRef,
) {
  const parts = [`Session ${phase}`];
  const commitSha = typeof data?.commitSha === "string" ? data.commitSha : undefined;
  const reason = typeof data?.reason === "string" ? data.reason : undefined;
  const branchName =
    (typeof data?.branchName === "string" ? data.branchName : undefined) ?? session.branchName;
  const workspacePath =
    (typeof data?.workspacePath === "string" ? data.workspacePath : undefined) ?? session.workspacePath;
  if (commitSha) {
    parts.push(`commit ${commitSha.slice(0, 7)}`);
  }
  if (branchName) {
    parts.push(branchName);
  }
  if (workspacePath) {
    parts.push(workspacePath);
  }
  let text = parts.join(" | ");
  if (reason) {
    text = `${text}: ${reason}`;
  }
  return text;
}

export function formatRawLineEvent(event: AgentRawLineEvent) {
  const prefix = event.encoding === "jsonl" ? "jsonl" : event.stream;
  return `${prefix}: ${event.line}`;
}

function appendAgentMessageEntry(
  target: BlockTarget,
  event: AgentStatusEvent,
) {
  const text = event.text ?? "";
  if (!text) {
    return;
  }
  const lastEntry = target.blocks.at(-1);
  if (lastEntry?.kind === "agent-message" && lastEntry.itemId === event.itemId) {
    lastEntry.count += 1;
    lastEntry.sequenceEnd = event.sequence;
    lastEntry.segments.push(text);
    lastEntry.text += text;
    lastEntry.timestamp = event.timestamp;
    return;
  }
  appendBlock(
    target,
    {
      count: 1,
      itemId: event.itemId,
      kind: "agent-message",
      segments: [text],
      sequenceEnd: event.sequence,
      sequenceStart: event.sequence,
      text,
      timestamp: event.timestamp,
    },
  );
}

function appendCommandOutputEntry(
  target: BlockTarget,
  event: AgentStatusEvent,
) {
  const lines = getCommandOutputLines(event);
  if (!lines.length) {
    return;
  }
  const commandEntry = [...target.blocks]
    .reverse()
    .find((entry) => entry.kind === "command" && (!event.itemId || entry.itemId === event.itemId));
  if (commandEntry?.kind === "command") {
    commandEntry.count += lines.length;
    commandEntry.outputLines.push(...lines);
    commandEntry.sequenceEnd = event.sequence;
    commandEntry.timestamp = event.timestamp;
    return;
  }
  const lastEntry = target.blocks.at(-1);
  if (lastEntry?.kind === "command-output") {
    lastEntry.count += lines.length;
    lastEntry.lines.push(...lines);
    lastEntry.sequenceEnd = event.sequence;
    lastEntry.timestamp = event.timestamp;
    return;
  }
  appendBlock(
    target,
    {
      count: lines.length,
      kind: "command-output",
      lines,
      sequenceEnd: event.sequence,
      sequenceStart: event.sequence,
      timestamp: event.timestamp,
    },
  );
}

function appendCommandStatusEntry(
  target: BlockTarget,
  event: AgentStatusEvent,
) {
  const commandText = formatCommandText(event.data) ?? event.text?.replace(/^\$\s*/, "").trim();
  if (!commandText) {
    return false;
  }
  const existing = findBlockByItemId(target, event.itemId);
  if (existing?.kind === "command") {
    existing.command = commandText.replace(/^\$\s*/, "");
    existing.cwd = asString(event.data?.cwd) ?? existing.cwd;
    existing.count += 1;
    existing.sequenceEnd = event.sequence;
    existing.timestamp = event.timestamp;
    return true;
  }

  appendBlock(
    target,
    {
      command: commandText.replace(/^\$\s*/, ""),
      count: 1,
      cwd: asString(event.data?.cwd),
      itemId: event.itemId,
      kind: "command",
      outputLines: [],
      sequenceEnd: event.sequence,
      sequenceStart: event.sequence,
      status: "running",
      timestamp: event.timestamp,
    },
  );
  return true;
}

function appendCommandFailureEntry(
  target: BlockTarget,
  event: AgentStatusEvent,
) {
  const existing = [...target.blocks]
    .reverse()
    .find((entry) => entry.kind === "command" && (!event.itemId || entry.itemId === event.itemId));
  if (existing?.kind === "command") {
    existing.count += 1;
    existing.exitCode = asNumber(event.data?.exitCode) ?? existing.exitCode;
    existing.sequenceEnd = event.sequence;
    existing.status = "failed";
    existing.timestamp = event.timestamp;
    return true;
  }
  return false;
}

function getBlockItemId(entry: AgentTuiBlock) {
  switch (entry.kind) {
    case "agent-message":
    case "command":
    case "plan":
    case "reasoning":
    case "status":
    case "tool":
      return entry.itemId;
    default:
      return undefined;
  }
}

function findBlockByItemId(
  target: BlockTarget,
  itemId: string | undefined,
): AgentTuiBlock | undefined {
  if (!itemId) {
    return undefined;
  }
  for (let index = target.blocks.length - 1; index >= 0; index -= 1) {
    const entry = target.blocks[index];
    if (entry && getBlockItemId(entry) === itemId) {
      return entry;
    }
  }
  return undefined;
}

function appendToolStatusEntry(
  target: BlockTarget,
  event: AgentStatusEvent,
) {
  const parsedToolText = parseToolText(event.text);
  const server = asString(event.data?.server) ?? parsedToolText?.server;
  const tool = asString(event.data?.tool) ?? parsedToolText?.tool;
  if (!server || !tool) {
    return false;
  }

  const existing =
    findBlockByItemId(target, event.itemId) ??
    [...target.blocks]
      .reverse()
      .find(
        (entry) =>
          entry.kind === "tool" &&
          entry.server === server &&
          entry.tool === tool,
      );
  const hasResultData = Object.prototype.hasOwnProperty.call(event.data ?? {}, "result");
  const resultData = hasResultData ? event.data?.result : undefined;
  const resultText = asString(event.data?.resultText);
  const errorText = asString(event.data?.message);
  const status =
    event.code === "tool-failed"
      ? "failed"
      : hasResultData || resultText
        ? "completed"
        : existing?.kind === "tool"
          ? existing.status
          : "running";

  if (existing?.kind === "tool") {
    existing.argumentsData = event.data?.arguments ?? existing.argumentsData;
    existing.argumentsText = parsedToolText?.argumentsText ?? existing.argumentsText;
    existing.count += 1;
    existing.errorText = errorText ?? existing.errorText;
    existing.resultData = resultData ?? existing.resultData;
    existing.resultText = resultText ?? existing.resultText;
    existing.sequenceEnd = event.sequence;
    existing.status = status;
    existing.timestamp = event.timestamp;
    return true;
  }

  appendBlock(
    target,
    {
      argumentsData: event.data?.arguments,
      argumentsText: parsedToolText?.argumentsText,
      count: 1,
      errorText,
      itemId: event.itemId,
      kind: "tool",
      resultData,
      resultText,
      server,
      sequenceEnd: event.sequence,
      sequenceStart: event.sequence,
      status,
      timestamp: event.timestamp,
      tool,
    },
  );
  return true;
}

export function appendBlocksForEvent(
  target: BlockTarget,
  event: AgentSessionEvent,
) {
  if (event.type === "codex-notification") {
    appendCodexNotificationToBlocks(
      {
        appendEntry: (entry) => {
          appendBlock(target, entry);
        },
        findEntryByItemId: (itemId) => findBlockByItemId(target, itemId),
      },
      event,
    );
    return;
  }

  if (event.type === "session") {
    appendBlock(
      target,
      {
        count: 1,
        kind: "lifecycle",
        phase: event.phase,
        sequenceEnd: event.sequence,
        sequenceStart: event.sequence,
        text: formatLifecycleText(event.phase, event.data, event.session),
        timestamp: event.timestamp,
      },
    );
    return;
  }

  if (event.type === "raw-line") {
    const lastEntry = target.blocks.at(-1);
    if (
      lastEntry?.kind === "raw" &&
      lastEntry.encoding === event.encoding &&
      lastEntry.stream === event.stream
    ) {
      lastEntry.count += 1;
      lastEntry.lines.push(event.line);
      lastEntry.sequenceEnd = event.sequence;
      lastEntry.timestamp = event.timestamp;
      return;
    }
    appendBlock(
      target,
      {
        count: 1,
        encoding: event.encoding,
        kind: "raw",
        lines: [event.line],
        sequenceEnd: event.sequence,
        sequenceStart: event.sequence,
        stream: event.stream,
        timestamp: event.timestamp,
      },
    );
    return;
  }

  if (event.format === "close") {
    return;
  }
  if (event.format === "chunk") {
    appendAgentMessageEntry(target, event);
    return;
  }
  if (event.code === "command" && appendCommandStatusEntry(target, event)) {
    return;
  }
  if (event.code === "command-output") {
    appendCommandOutputEntry(target, event);
    return;
  }
  if (event.code === "command-failed" && appendCommandFailureEntry(target, event)) {
    return;
  }
  if ((event.code === "tool" || event.code === "tool-failed") && appendToolStatusEntry(target, event)) {
    return;
  }

  appendBlock(
    target,
    {
      code: event.code,
      count: 1,
      data: event.data,
      format: event.format,
      itemId: event.itemId,
      kind: "status",
      sequenceEnd: event.sequence,
      sequenceStart: event.sequence,
      text: formatStatusEventText(event) ?? event.code,
      timestamp: event.timestamp,
    },
  );
}

export function summarizeAgentSessionEvent(event: AgentSessionEvent) {
  switch (event.type) {
    case "codex-notification": {
      const text = formatCodexNotificationSummary(event)?.trim();
      return text ? `${event.method}: ${text}` : event.method;
    }
    case "session":
      return formatLifecycleText(event.phase, event.data, event.session);
    case "status": {
      const text = formatStatusEventText(event)?.trim();
      if (text) {
        return `${event.code}: ${text}`;
      }
      if (event.itemId) {
        return `${event.code}: ${event.itemId}`;
      }
      return event.code;
    }
    case "raw-line":
      return `${event.stream} ${event.encoding}: ${event.line}`;
  }
}

export function shouldUpdateStatusSummary(event: AgentStatusEvent) {
  if (event.format === "close") {
    return false;
  }
  switch (event.code) {
    case "agent-message-delta":
    case "agent-message-completed":
    case "command-output":
      return false;
    default:
      return true;
  }
}

export function createStatusSummary(event: AgentStatusEvent): AgentTuiStatusSummary {
  return {
    code: event.code,
    data: event.data,
    format: event.format,
    itemId: event.itemId,
    text: formatStatusEventText(event),
    timestamp: event.timestamp,
  };
}

function formatLifecycleEntry(entry: Extract<AgentTuiBlock, { kind: "lifecycle" }>) {
  return [entry.text];
}

function normalizeBlockLines(text: string) {
  return text.replace(/\r\n/g, "\n").split("\n").map((line) => line.trimEnd());
}

function indentBlockLines(lines: string[], prefix = "  ") {
  return lines.map((line) => (line ? `${prefix}${line}` : prefix.trimEnd()));
}

function truncateInlineText(text: string, maxLength = 160) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatInlineValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return truncateInlineText(value.replace(/\s+/g, " ").trim());
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const inlineItems = value
      .map((item) => formatInlineValue(item))
      .filter((item): item is string => Boolean(item));
    if (!inlineItems.length) {
      return "[]";
    }
    return truncateInlineText(inlineItems.join(", "));
  }
  if (value && typeof value === "object") {
    return "{...}";
  }
  return undefined;
}

function formatJsonBlock(value: unknown, maxLines = 10) {
  const pretty = JSON.stringify(value, null, 2);
  if (!pretty) {
    return [];
  }
  const lines = pretty.split("\n");
  if (lines.length <= maxLines) {
    return lines;
  }
  return [...lines.slice(0, maxLines - 1), "..."];
}

function formatRecordSummaryLines(
  record: Record<string, unknown>,
  preferredKeys: readonly string[] = [],
  maxLines = 8,
) {
  const lines: string[] = [];
  const seen = new Set<string>();
  const keys = [...preferredKeys, ...Object.keys(record).sort()];

  for (const key of keys) {
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const value = record[key];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    const inlineValue = formatInlineValue(value);
    if (!inlineValue) {
      continue;
    }
    lines.push(`${key}: ${inlineValue}`);
    if (lines.length >= maxLines) {
      break;
    }
  }

  if (lines.length < Object.keys(record).length) {
    lines.push("...");
  }

  return lines;
}

function formatLinearToolArgumentLines(tool: string, record: Record<string, unknown>) {
  const preferredKeysByTool: Record<string, string[]> = {
    create_attachment: ["issue", "filename", "title", "subtitle"],
    create_document: ["issue", "project", "title", "icon"],
    save_comment: ["issueId", "id", "parentId", "body"],
    save_issue: ["id", "title", "state", "priority", "project", "assignee", "labels", "dueDate"],
    update_document: ["id", "project", "title", "icon"],
  };

  return formatRecordSummaryLines(record, preferredKeysByTool[tool] ?? []);
}

function getToolArgumentLines(
  server: string | undefined,
  tool: string | undefined,
  argumentsData: unknown,
  argumentsText: string | undefined,
) {
  const parsedArguments =
    argumentsData ??
    (() => {
      if (!argumentsText) {
        return undefined;
      }
      try {
        return JSON.parse(argumentsText);
      } catch {
        return undefined;
      }
    })();

  if (!parsedArguments) {
    return [];
  }
  if (server === "linear") {
    const record = asRecord(parsedArguments);
    if (record) {
      return formatLinearToolArgumentLines(tool ?? "", record);
    }
  }

  const record = asRecord(parsedArguments);
  if (record) {
    return formatRecordSummaryLines(record);
  }

  if (typeof parsedArguments === "string") {
    return normalizeBlockLines(parsedArguments);
  }

  return formatJsonBlock(parsedArguments);
}

function getToolResultLines(
  resultData: unknown,
  resultText: string | undefined,
) {
  if (resultData !== undefined) {
    const record = asRecord(resultData);
    if (record) {
      return formatRecordSummaryLines(record, ["id", "identifier", "title", "status", "state", "url"]);
    }
    if (typeof resultData === "string") {
      return normalizeBlockLines(resultData);
    }
    return formatJsonBlock(resultData);
  }

  if (!resultText) {
    return [];
  }

  try {
    const parsed = JSON.parse(resultText);
    return getToolResultLines(parsed, undefined);
  } catch {
    return normalizeBlockLines(resultText);
  }
}

function parseToolText(text: string | undefined) {
  if (!text) {
    return undefined;
  }
  const match = text.match(/^Tool:\s+([^. ]+)\.([^ ]+)(?:\s+(.+))?$/);
  if (!match) {
    return undefined;
  }
  const [, server, tool, argumentsText] = match;
  return {
    argumentsText,
    server,
    tool,
  };
}

function formatToolBlock(options: {
  argumentsData?: unknown;
  argumentsText?: string;
  errorText?: string;
  resultData?: unknown;
  resultText?: string;
  server?: string;
  status?: "completed" | "failed" | "running";
  tool?: string;
}) {
  const server = options.server;
  const tool = options.tool;
  if (!server || !tool) {
    return options.errorText ? [`Tool failed: ${options.errorText}`] : [];
  }

  if (server === "linear" && options.status && options.status !== "running") {
    const summary = summarizeLinearToolCall({
      argumentsData: options.argumentsData,
      resultData: options.resultData,
      status: options.status,
      tool,
    });
    if (summary) {
      const lines = [summary.summaryText];
      if (summary.detailLines.length) {
        lines.push(...indentBlockLines(summary.detailLines));
      }
      if (options.errorText) {
        lines.push("error:");
        lines.push(...indentBlockLines(normalizeBlockLines(options.errorText)));
      }
      return lines;
    }
  }

  const statusSuffix =
    options.status === "running" ? " [running]" : options.status === "failed" ? " [failed]" : "";
  const lines = [`Tool: ${server}.${tool}${statusSuffix}`];
  const argumentLines = getToolArgumentLines(
    server,
    tool,
    options.argumentsData,
    options.argumentsText,
  );
  if (argumentLines.length) {
    lines.push("args:");
    lines.push(...indentBlockLines(argumentLines));
  }
  if (options.errorText) {
    lines.push("error:");
    lines.push(...indentBlockLines(normalizeBlockLines(options.errorText)));
  }
  const resultLines = getToolResultLines(options.resultData, options.resultText);
  if (resultLines.length) {
    lines.push("result:");
    lines.push(...indentBlockLines(resultLines));
  }
  return lines;
}

function formatStatusEntry(entry: Extract<AgentTuiBlock, { kind: "status" }>) {
  if (entry.code === "tool") {
    const parsedToolText = parseToolText(entry.text);
    const toolLines = formatToolBlock({
      argumentsData: entry.data?.arguments,
      argumentsText: parsedToolText?.argumentsText,
      server: asString(entry.data?.server) ?? parsedToolText?.server,
      status: "running",
      tool: asString(entry.data?.tool) ?? parsedToolText?.tool,
    });
    if (toolLines.length) {
      return toolLines;
    }
  }
  return [entry.text];
}

function formatApprovalEntry(entry: Extract<AgentTuiBlock, { kind: "approval" }>) {
  return [entry.text];
}

function formatAgentMessageEntry(entry: Extract<AgentTuiBlock, { kind: "agent-message" }>) {
  const flattened = entry.text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flattened ? [flattened] : [];
}

function formatCommandEntry(entry: Extract<AgentTuiBlock, { kind: "command" }>) {
  const header = `$ ${entry.command}`;
  const lines = [header];
  if (entry.outputLines.length) {
    lines.push("output:");
    lines.push(...indentBlockLines(entry.outputLines));
  }
  if (entry.status === "failed") {
    lines.push(
      `Command failed${typeof entry.exitCode === "number" ? ` (exit ${entry.exitCode})` : ""}`,
    );
  }
  return lines;
}

function formatCommandOutputEntry(entry: Extract<AgentTuiBlock, { kind: "command-output" }>) {
  if (!entry.lines.length) {
    return [];
  }
  return ["output:", ...indentBlockLines(entry.lines)];
}

function formatRawEntry(entry: Extract<AgentTuiBlock, { kind: "raw" }>) {
  if (entry.stream === "stdout" && entry.encoding === "jsonl") {
    return [];
  }
  const prefix = entry.encoding === "jsonl" ? "jsonl" : entry.stream;
  return entry.lines.map((line) => `${prefix}: ${line}`);
}

function formatMirrorEntry(entry: Extract<AgentTuiBlock, { kind: "mirror" }>) {
  return [entry.text];
}

function formatPlanEntry(entry: Extract<AgentTuiBlock, { kind: "plan" }>) {
  if (!entry.text.trim()) {
    return [];
  }
  return [`Plan: ${entry.text.replace(/\r\n/g, "\n").replace(/\n+/g, " ").trim()}`];
}

function getReasoningSectionLines(parts: string[]) {
  return parts
    .filter(Boolean)
    .flatMap((part) => normalizeBlockLines(part))
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatReasoningEntry(entry: Extract<AgentTuiBlock, { kind: "reasoning" }>) {
  const header =
    entry.status === "streaming"
      ? `Reasoning [running ${REASONING_SPINNER_FRAMES[0]}]`
      : "Reasoning [completed]";
  const summaryLines = getReasoningSectionLines(entry.summary);
  const contentLines = getReasoningSectionLines(entry.content);
  const lines = [header];

  if (summaryLines.length) {
    lines.push("summary:");
    lines.push(...indentBlockLines(summaryLines));
  }
  if (contentLines.length) {
    lines.push("content:");
    lines.push(...indentBlockLines(contentLines));
  }

  return lines;
}

function formatToolEntry(entry: Extract<AgentTuiBlock, { kind: "tool" }>) {
  return formatToolBlock(entry);
}

export function hasStreamingReasoningBlocks(blocks: AgentTuiBlock[]) {
  return blocks.some((entry) => entry.kind === "reasoning" && entry.status === "streaming");
}

export function formatBlocks(
  blocks: AgentTuiBlock[],
  options: {
    animationFrame?: number;
  } = {},
) {
  if (!blocks.length) {
    return DEFAULT_TRANSCRIPT_WAITING_MESSAGE;
  }

  const lines = blocks.flatMap((entry) => {
    switch (entry.kind) {
      case "approval":
        return formatApprovalEntry(entry);
      case "command":
        return formatCommandEntry(entry);
      case "lifecycle":
        return formatLifecycleEntry(entry);
      case "status":
        return formatStatusEntry(entry);
      case "agent-message":
        return formatAgentMessageEntry(entry);
      case "command-output":
        return formatCommandOutputEntry(entry);
      case "mirror":
        return formatMirrorEntry(entry);
      case "plan":
        return formatPlanEntry(entry);
      case "raw":
        return formatRawEntry(entry);
      case "reasoning":
        return (() => {
          const formatted = formatReasoningEntry(entry);
          if (entry.status !== "streaming" || !formatted.length) {
            return formatted;
          }
          const frame =
            REASONING_SPINNER_FRAMES[
              Math.abs(options.animationFrame ?? 0) % REASONING_SPINNER_FRAMES.length
            ] ?? REASONING_SPINNER_FRAMES[0];
          formatted[0] = `Reasoning [running ${frame}]`;
          return formatted;
        })();
      case "tool":
        return formatToolEntry(entry);
    }
  });

  const filteredLines = lines.map((line) => line.trimEnd()).filter((line) => line.length > 0);
  return filteredLines.join("\n") || DEFAULT_TRANSCRIPT_WAITING_MESSAGE;
}
