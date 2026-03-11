import type {
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

const DEFAULT_TRANSCRIPT_WAITING_MESSAGE = "Waiting for session transcript...";

type TranscriptRenderMode = "plain" | "raw" | "status";

type TranscriptEntryTarget = {
  transcriptEntries: AgentTuiTranscriptEntry[];
};

export interface AgentTuiStatusSummary {
  code: AgentStatusCode;
  data?: Record<string, unknown>;
  format: AgentStatusFormat;
  itemId?: string;
  text?: string;
  timestamp: string;
}

interface AgentTuiTranscriptEntryBase {
  count: number;
  sequenceEnd: number;
  sequenceStart: number;
  timestamp: string;
}

export interface AgentTuiLifecycleEntry extends AgentTuiTranscriptEntryBase {
  kind: "lifecycle";
  phase: AgentSessionPhase;
  text: string;
}

export interface AgentTuiStatusEntry extends AgentTuiTranscriptEntryBase {
  code: AgentStatusCode;
  data?: Record<string, unknown>;
  format: AgentStatusFormat;
  itemId?: string;
  kind: "status";
  text: string;
}

export interface AgentTuiAgentMessageEntry extends AgentTuiTranscriptEntryBase {
  itemId?: string;
  kind: "agent-message";
  segments: string[];
  text: string;
}

export interface AgentTuiCommandOutputEntry extends AgentTuiTranscriptEntryBase {
  kind: "command-output";
  lines: string[];
}

export interface AgentTuiRawEntry extends AgentTuiTranscriptEntryBase {
  encoding: AgentRawLineEvent["encoding"];
  kind: "raw";
  lines: string[];
  stream: AgentRawLineEvent["stream"];
}

export interface AgentTuiMirrorEntry extends AgentTuiTranscriptEntryBase {
  kind: "mirror";
  text: string;
}

export type AgentTuiTranscriptEntry =
  | AgentTuiAgentMessageEntry
  | AgentTuiCommandOutputEntry
  | AgentTuiLifecycleEntry
  | AgentTuiMirrorEntry
  | AgentTuiRawEntry
  | AgentTuiStatusEntry;

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

function estimateTranscriptEntryChars(entry: AgentTuiTranscriptEntry) {
  switch (entry.kind) {
    case "lifecycle":
    case "mirror":
    case "status":
      return entry.text.length + 1;
    case "agent-message":
      return entry.segments.reduce((total, segment) => total + segment.length + 1, 0);
    case "command-output":
      return entry.lines.reduce((total, line) => total + line.length + 1, 12);
    case "raw":
      return entry.lines.reduce((total, line) => total + line.length + 1, 20);
  }
}

function trimTranscriptEntries(target: TranscriptEntryTarget, maxTranscriptChars: number) {
  let totalChars = target.transcriptEntries.reduce(
    (total, entry) => total + estimateTranscriptEntryChars(entry),
    0,
  );
  while (totalChars > maxTranscriptChars && target.transcriptEntries.length) {
    const removed = target.transcriptEntries.shift();
    totalChars -= removed ? estimateTranscriptEntryChars(removed) : 0;
  }
}

export function appendTranscriptEntry(
  target: TranscriptEntryTarget,
  entry: AgentTuiTranscriptEntry,
  maxTranscriptChars: number,
) {
  target.transcriptEntries.push(entry);
  trimTranscriptEntries(target, maxTranscriptChars);
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
  target: TranscriptEntryTarget,
  event: AgentStatusEvent,
  maxTranscriptChars: number,
) {
  const text = event.text ?? "";
  if (!text) {
    return;
  }
  const lastEntry = target.transcriptEntries.at(-1);
  if (lastEntry?.kind === "agent-message" && lastEntry.itemId === event.itemId) {
    lastEntry.count += 1;
    lastEntry.sequenceEnd = event.sequence;
    lastEntry.segments.push(text);
    lastEntry.text += text;
    lastEntry.timestamp = event.timestamp;
    trimTranscriptEntries(target, maxTranscriptChars);
    return;
  }
  appendTranscriptEntry(
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
    maxTranscriptChars,
  );
}

function appendCommandOutputEntry(
  target: TranscriptEntryTarget,
  event: AgentStatusEvent,
  maxTranscriptChars: number,
) {
  const lines = getCommandOutputLines(event);
  if (!lines.length) {
    return;
  }
  const lastEntry = target.transcriptEntries.at(-1);
  if (lastEntry?.kind === "command-output") {
    lastEntry.count += lines.length;
    lastEntry.lines.push(...lines);
    lastEntry.sequenceEnd = event.sequence;
    lastEntry.timestamp = event.timestamp;
    trimTranscriptEntries(target, maxTranscriptChars);
    return;
  }
  appendTranscriptEntry(
    target,
    {
      count: lines.length,
      kind: "command-output",
      lines,
      sequenceEnd: event.sequence,
      sequenceStart: event.sequence,
      timestamp: event.timestamp,
    },
    maxTranscriptChars,
  );
}

export function appendTranscriptEntriesForEvent(
  target: TranscriptEntryTarget,
  event: AgentSessionEvent,
  maxTranscriptChars: number,
) {
  if (event.type === "session") {
    appendTranscriptEntry(
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
      maxTranscriptChars,
    );
    return;
  }

  if (event.type === "raw-line") {
    const lastEntry = target.transcriptEntries.at(-1);
    if (
      lastEntry?.kind === "raw" &&
      lastEntry.encoding === event.encoding &&
      lastEntry.stream === event.stream
    ) {
      lastEntry.count += 1;
      lastEntry.lines.push(event.line);
      lastEntry.sequenceEnd = event.sequence;
      lastEntry.timestamp = event.timestamp;
      trimTranscriptEntries(target, maxTranscriptChars);
      return;
    }
    appendTranscriptEntry(
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
      maxTranscriptChars,
    );
    return;
  }

  if (event.format === "close") {
    return;
  }
  if (event.format === "chunk") {
    appendAgentMessageEntry(target, event, maxTranscriptChars);
    return;
  }
  if (event.code === "command-output") {
    appendCommandOutputEntry(target, event, maxTranscriptChars);
    return;
  }

  appendTranscriptEntry(
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
    maxTranscriptChars,
  );
}

function formatSessionLabel(session: AgentSessionRef) {
  return session.issue?.identifier ?? session.workerId ?? session.title;
}

export function shouldMirrorEventToSupervisor(event: AgentSessionEvent) {
  if (event.session.kind === "supervisor") {
    return false;
  }
  if (event.type === "raw-line") {
    return false;
  }
  if (event.type === "status") {
    switch (event.code) {
      case "agent-message-completed":
      case "agent-message-delta":
      case "command-output":
        return false;
    }
  }
  return true;
}

export function createSupervisorMirrorEntry(
  event: AgentSessionEvent,
): AgentTuiMirrorEntry | undefined {
  const prefix = `[${formatSessionLabel(event.session)}]`;
  let text: string | undefined;

  if (event.type === "session") {
    text = `${prefix} ${formatLifecycleText(event.phase, event.data, event.session)}`;
  } else if (event.type === "status") {
    const rendered = formatStatusEventText(event)?.trim();
    if (rendered) {
      text = `${prefix} ${rendered}`;
    } else if (event.itemId) {
      text = `${prefix} ${event.code}: ${event.itemId}`;
    } else {
      text = `${prefix} ${event.code}`;
    }
  }

  if (!text) {
    return undefined;
  }

  return {
    count: 1,
    kind: "mirror",
    sequenceEnd: event.sequence,
    sequenceStart: event.sequence,
    text,
    timestamp: event.timestamp,
  };
}

export function summarizeAgentSessionEvent(event: AgentSessionEvent) {
  switch (event.type) {
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

function truncateSummary(text: string, maxChars = 120) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxChars - 3))}...`;
}

function summarizeJsonLine(line: string) {
  try {
    const parsed = JSON.parse(line) as {
      method?: unknown;
      params?: unknown;
    };
    if (!parsed || typeof parsed !== "object" || typeof parsed.method !== "string") {
      return undefined;
    }
    if (parsed.method === "item/started") {
      const params =
        parsed.params && typeof parsed.params === "object"
          ? (parsed.params as { item?: { type?: unknown } })
          : undefined;
      const itemType = params?.item?.type;
      return typeof itemType === "string" ? `${parsed.method} ${itemType}` : parsed.method;
    }
    if (parsed.method === "item/completed") {
      const params =
        parsed.params && typeof parsed.params === "object"
          ? (parsed.params as {
              item?: { exitCode?: unknown; status?: unknown; type?: unknown };
            })
          : undefined;
      const itemType = params?.item?.type;
      const status = params?.item?.status;
      const exitCode = params?.item?.exitCode;
      const parts = [parsed.method];
      if (typeof itemType === "string") {
        parts.push(itemType);
      }
      if (typeof status === "string") {
        parts.push(status);
      }
      if (typeof exitCode === "number") {
        parts.push(`exit=${exitCode}`);
      }
      return parts.join(" ");
    }
    return parsed.method;
  } catch {
    return undefined;
  }
}

function formatLifecycleEntry(
  entry: Extract<AgentTuiTranscriptEntry, { kind: "lifecycle" }>,
  mode: TranscriptRenderMode,
) {
  if (mode === "plain") {
    return [entry.text];
  }
  return [`[SESSION ${entry.phase.toUpperCase()}] ${entry.text}`];
}

function formatStatusEntry(
  entry: Extract<AgentTuiTranscriptEntry, { kind: "status" }>,
  mode: TranscriptRenderMode,
) {
  if (mode === "plain") {
    return [entry.text];
  }

  let label = "STATUS";
  switch (entry.code) {
    case "approval-required":
      label = "APPROVAL";
      break;
    case "command":
      label = "COMMAND";
      break;
    case "command-failed":
      label = "COMMAND FAIL";
      break;
    case "error":
      label = "ERROR";
      break;
    case "tool":
      label = "TOOL";
      break;
    case "tool-failed":
      label = "TOOL FAIL";
      break;
    case "waiting-on-user-input":
      label = "WAIT";
      break;
    case "thread-started":
    case "turn-started":
    case "turn-completed":
    case "turn-cancelled":
    case "turn-failed":
      label = "TURN";
      break;
  }
  return [`[${label}] ${entry.text}`];
}

function formatAgentMessageEntry(
  entry: Extract<AgentTuiTranscriptEntry, { kind: "agent-message" }>,
  mode: TranscriptRenderMode,
) {
  if (mode === "status") {
    return entry.segments
      .flatMap((segment) => segment.trimEnd().split("\n"))
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
  return entry.text.trimEnd().split("\n");
}

function formatCommandOutputEntry(
  entry: Extract<AgentTuiTranscriptEntry, { kind: "command-output" }>,
  mode: TranscriptRenderMode,
) {
  if (!entry.lines.length) {
    return [];
  }
  if (mode === "status") {
    const preview = entry.lines.at(-1) ?? entry.lines[0] ?? "";
    return [`[CMD OUT x${entry.count}] ${truncateSummary(preview)}`];
  }
  if (mode === "plain") {
    return entry.lines.map((line) => `| ${line}`);
  }
  return [`[CMD OUT x${entry.count}]`, ...entry.lines.map((line) => `| ${line}`)];
}

function formatRawEntry(entry: Extract<AgentTuiTranscriptEntry, { kind: "raw" }>, mode: TranscriptRenderMode) {
  if (mode === "plain") {
    const prefix = entry.encoding === "jsonl" ? "jsonl" : entry.stream;
    return entry.lines.map((line) => `${prefix}: ${line}`);
  }
  if (mode === "status" && entry.stream === "stdout" && entry.encoding === "jsonl") {
    return [];
  }
  const label = `RAW ${entry.stream}/${entry.encoding} x${entry.count}`;
  if (mode === "status") {
    const preview = entry.lines.at(-1) ?? entry.lines[0] ?? "";
    const summarized =
      entry.encoding === "jsonl" ? summarizeJsonLine(preview) ?? truncateSummary(preview) : truncateSummary(preview);
    return summarized ? [`[${label}] ${summarized}`] : [`[${label}]`];
  }
  const prefix = entry.encoding === "jsonl" ? "jsonl" : entry.stream;
  return [`[${label}]`, ...entry.lines.map((line) => `${prefix}: ${line}`)];
}

function formatMirrorEntry(entry: Extract<AgentTuiTranscriptEntry, { kind: "mirror" }>) {
  return [entry.text];
}

export function formatTranscriptEntries(
  transcriptEntries: AgentTuiTranscriptEntry[],
  mode: TranscriptRenderMode,
) {
  if (!transcriptEntries.length) {
    return mode === "plain" ? "" : DEFAULT_TRANSCRIPT_WAITING_MESSAGE;
  }

  const lines = transcriptEntries.flatMap((entry) => {
    switch (entry.kind) {
      case "lifecycle":
        return formatLifecycleEntry(entry, mode);
      case "status":
        return formatStatusEntry(entry, mode);
      case "agent-message":
        return formatAgentMessageEntry(entry, mode);
      case "command-output":
        return formatCommandOutputEntry(entry, mode);
      case "mirror":
        return formatMirrorEntry(entry);
      case "raw":
        return formatRawEntry(entry, mode);
    }
  });

  const filteredLines = lines.map((line) => line.trimEnd()).filter((line) => line.length > 0);
  if (mode === "plain") {
    return filteredLines.length ? `${filteredLines.join("\n")}\n` : "";
  }
  return filteredLines.join("\n") || DEFAULT_TRANSCRIPT_WAITING_MESSAGE;
}
