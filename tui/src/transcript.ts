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
export { createStatusSummaryFromCodexNotification } from "./codex-event-stream.js";

const DEFAULT_TRANSCRIPT_WAITING_MESSAGE = "Waiting for session transcript...";

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
  argumentsText?: string;
  errorText?: string;
  itemId?: string;
  kind: "tool";
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
    ? event.data.lines.map((line) => asString(line)).filter((line): line is string => Boolean(line))
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
  if (event.code === "command-output") {
    appendCommandOutputEntry(target, event);
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

function formatStatusEntry(entry: Extract<AgentTuiBlock, { kind: "status" }>) {
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
  if (entry.status === "failed") {
    lines.push(
      `Command failed${typeof entry.exitCode === "number" ? ` (exit ${entry.exitCode})` : ""}`,
    );
  }
  if (entry.outputLines.length) {
    lines.push(...entry.outputLines.map((line) => `| ${line}`));
  }
  return lines;
}

function formatCommandOutputEntry(entry: Extract<AgentTuiBlock, { kind: "command-output" }>) {
  if (!entry.lines.length) {
    return [];
  }
  return entry.lines.map((line) => `| ${line}`);
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

function formatReasoningEntry(entry: Extract<AgentTuiBlock, { kind: "reasoning" }>) {
  const combined = [...entry.summary, ...entry.content].filter(Boolean);
  if (!combined.length) {
    return [];
  }
  return [
    `Reasoning: ${(combined.at(-1) ?? combined[0] ?? "").replace(/\r\n/g, "\n").replace(/\n+/g, " ").trim()}`,
  ];
}

function formatToolEntry(entry: Extract<AgentTuiBlock, { kind: "tool" }>) {
  const header = `Tool: ${entry.server}.${entry.tool}${entry.argumentsText ? ` ${entry.argumentsText}` : ""}`;
  const lines = [header];
  if (entry.errorText) {
    lines.push(`Tool failed: ${entry.errorText}`);
  }
  return lines;
}

export function formatBlocks(blocks: AgentTuiBlock[]) {
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
        return formatReasoningEntry(entry);
      case "tool":
        return formatToolEntry(entry);
    }
  });

  const filteredLines = lines.map((line) => line.trimEnd()).filter((line) => line.length > 0);
  return filteredLines.join("\n") || DEFAULT_TRANSCRIPT_WAITING_MESSAGE;
}
