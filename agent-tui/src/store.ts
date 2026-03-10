import type {
  AgentRawLineEvent,
  AgentSessionEvent,
  AgentSessionEventObserver,
  AgentSessionIssueRef,
  AgentSessionPhase,
  AgentSessionRef,
  AgentStatusCode,
  AgentStatusFormat,
} from "./session-events.js";
import {
  createAgentSessionDisplayState,
  renderAgentStatusEvent,
  type AgentSessionDisplayState,
} from "./session-events.js";

const DEFAULT_MAX_EVENT_HISTORY = 128;
const DEFAULT_MAX_TRANSCRIPT_CHARS = 24_000;

type AgentTuiInternalColumnState = {
  body: string;
  displayState: AgentSessionDisplayState;
  eventHistory: AgentTuiEventRecord[];
  firstSequence: number;
  lastSequence: number;
  phase: AgentSessionPhase | "pending";
  session: AgentSessionRef;
  status?: AgentTuiStatusSummary;
  transcriptEntries: AgentTuiTranscriptEntry[];
};

export interface AgentTuiEventRecord {
  sequence: number;
  summary: string;
  timestamp: string;
  type: AgentSessionEvent["type"];
}

export interface AgentTuiStatusSummary {
  code: AgentStatusCode;
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

export interface AgentTuiColumnSnapshot {
  body: string;
  childSessionIds: string[];
  depth: number;
  eventHistory: AgentTuiEventRecord[];
  firstSequence: number;
  lastSequence: number;
  parentSessionId?: string;
  phase: AgentSessionPhase | "pending";
  session: AgentSessionRef;
  status?: AgentTuiStatusSummary;
  transcriptEntries: AgentTuiTranscriptEntry[];
}

export type AgentTuiSessionSnapshot = AgentTuiColumnSnapshot;

export interface AgentTuiSnapshot {
  columns: AgentTuiColumnSnapshot[];
  sessions: AgentTuiSessionSnapshot[];
  updatedAt?: string;
}

export interface AgentTuiStore {
  getSnapshot(): AgentTuiSnapshot;
  observe: AgentSessionEventObserver;
  subscribe(listener: () => void): () => void;
}

export interface AgentTuiStoreOptions {
  maxEventHistory?: number;
  maxTranscriptChars?: number;
  retainTerminalSessions?: boolean;
}

function mergeSessionRef(current: AgentSessionRef, next: AgentSessionRef): AgentSessionRef {
  let issue: AgentSessionIssueRef | undefined;
  if (current.issue || next.issue) {
    issue = {
      ...current.issue,
      ...next.issue,
    } as AgentSessionIssueRef;
  }
  return {
    ...current,
    ...next,
    issue,
  };
}

function createSessionState(
  session: AgentSessionRef,
  sequence: number,
): AgentTuiInternalColumnState {
  const displayState = createAgentSessionDisplayState();
  displayState.headerPrinted = true;
  return {
    body: "",
    displayState,
    eventHistory: [],
    firstSequence: sequence,
    lastSequence: sequence,
    phase: "pending",
    session,
    transcriptEntries: [],
  };
}

function trimTranscript(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return text;
  }
  const trimmed = text.slice(text.length - maxChars);
  const firstNewline = trimmed.indexOf("\n");
  if (firstNewline === -1) {
    return trimmed;
  }
  return trimmed.slice(firstNewline + 1);
}

function appendTranscript(
  state: AgentTuiInternalColumnState,
  text: string,
  maxTranscriptChars: number,
) {
  if (!text) {
    return;
  }
  state.body = trimTranscript(`${state.body}${text}`, maxTranscriptChars);
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

function trimTranscriptEntries(
  state: AgentTuiInternalColumnState,
  maxTranscriptChars: number,
) {
  let totalChars = state.transcriptEntries.reduce(
    (total, entry) => total + estimateTranscriptEntryChars(entry),
    0,
  );
  while (totalChars > maxTranscriptChars && state.transcriptEntries.length) {
    const removed = state.transcriptEntries.shift();
    totalChars -= removed ? estimateTranscriptEntryChars(removed) : 0;
  }
}

function pushTranscriptEntry(
  state: AgentTuiInternalColumnState,
  entry: AgentTuiTranscriptEntry,
  maxTranscriptChars: number,
) {
  state.transcriptEntries.push(entry);
  trimTranscriptEntries(state, maxTranscriptChars);
}

function closeOpenLine(state: AgentTuiInternalColumnState, maxTranscriptChars: number) {
  if (!state.displayState.lineOpen) {
    return;
  }
  appendTranscript(state, "\n", maxTranscriptChars);
  state.displayState.lineOpen = false;
  state.displayState.activeAgentMessageId = undefined;
}

function formatLifecycleText(
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
    (typeof data?.workspacePath === "string" ? data.workspacePath : undefined) ??
    session.workspacePath;
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
  return `${text}\n`;
}

function formatRawLineEvent(event: AgentRawLineEvent) {
  const prefix = event.encoding === "jsonl" ? "jsonl" : event.stream;
  return `${prefix}: ${event.line}\n`;
}

function appendLifecycleEntry(
  state: AgentTuiInternalColumnState,
  event: Extract<AgentSessionEvent, { type: "session" }>,
  maxTranscriptChars: number,
) {
  pushTranscriptEntry(
    state,
    {
      count: 1,
      kind: "lifecycle",
      phase: event.phase,
      sequenceEnd: event.sequence,
      sequenceStart: event.sequence,
      text: formatLifecycleText(event.phase, event.data, state.session).trimEnd(),
      timestamp: event.timestamp,
    },
    maxTranscriptChars,
  );
}

function appendAgentMessageEntry(
  state: AgentTuiInternalColumnState,
  event: Extract<AgentSessionEvent, { type: "status" }>,
  maxTranscriptChars: number,
) {
  const text = event.text ?? "";
  if (!text) {
    return;
  }
  const lastEntry = state.transcriptEntries.at(-1);
  if (lastEntry?.kind === "agent-message" && lastEntry.itemId === event.itemId) {
    lastEntry.count += 1;
    lastEntry.sequenceEnd = event.sequence;
    lastEntry.segments.push(text);
    lastEntry.text += text;
    lastEntry.timestamp = event.timestamp;
    trimTranscriptEntries(state, maxTranscriptChars);
    return;
  }
  pushTranscriptEntry(
    state,
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
  state: AgentTuiInternalColumnState,
  event: Extract<AgentSessionEvent, { type: "status" }>,
  maxTranscriptChars: number,
) {
  const text = event.text?.replace(/^\|\s?/, "") ?? "";
  if (!text) {
    return;
  }
  const lastEntry = state.transcriptEntries.at(-1);
  if (lastEntry?.kind === "command-output") {
    lastEntry.count += 1;
    lastEntry.lines.push(text);
    lastEntry.sequenceEnd = event.sequence;
    lastEntry.timestamp = event.timestamp;
    trimTranscriptEntries(state, maxTranscriptChars);
    return;
  }
  pushTranscriptEntry(
    state,
    {
      count: 1,
      kind: "command-output",
      lines: [text],
      sequenceEnd: event.sequence,
      sequenceStart: event.sequence,
      timestamp: event.timestamp,
    },
    maxTranscriptChars,
  );
}

function appendStatusEntry(
  state: AgentTuiInternalColumnState,
  event: Extract<AgentSessionEvent, { type: "status" }>,
  maxTranscriptChars: number,
) {
  const text = event.text?.trim();
  if (!text && event.format === "close") {
    return;
  }
  if (event.format === "chunk") {
    appendAgentMessageEntry(state, event, maxTranscriptChars);
    return;
  }
  if (event.code === "command-output") {
    appendCommandOutputEntry(state, event, maxTranscriptChars);
    return;
  }
  pushTranscriptEntry(
    state,
    {
      code: event.code,
      count: 1,
      format: event.format,
      itemId: event.itemId,
      kind: "status",
      sequenceEnd: event.sequence,
      sequenceStart: event.sequence,
      text: text ?? event.code,
      timestamp: event.timestamp,
    },
    maxTranscriptChars,
  );
}

function appendRawEntry(
  state: AgentTuiInternalColumnState,
  event: Extract<AgentSessionEvent, { type: "raw-line" }>,
  maxTranscriptChars: number,
) {
  const lastEntry = state.transcriptEntries.at(-1);
  if (
    lastEntry?.kind === "raw" &&
    lastEntry.encoding === event.encoding &&
    lastEntry.stream === event.stream
  ) {
    lastEntry.count += 1;
    lastEntry.lines.push(event.line);
    lastEntry.sequenceEnd = event.sequence;
    lastEntry.timestamp = event.timestamp;
    trimTranscriptEntries(state, maxTranscriptChars);
    return;
  }
  pushTranscriptEntry(
    state,
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
}

function formatSessionLabel(session: AgentSessionRef) {
  return session.issue?.identifier ?? session.workerId ?? session.title;
}

function shouldMirrorEventToSupervisor(event: AgentSessionEvent) {
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

function formatMirroredEvent(event: AgentSessionEvent) {
  const prefix = `[${formatSessionLabel(event.session)}]`;
  if (event.type === "session") {
    return `${prefix} ${formatLifecycleText(event.phase, event.data, event.session).trimEnd()}`;
  }
  if (event.type === "status") {
    const text = event.text?.trim();
    if (text) {
      return `${prefix} ${text}`;
    }
    if (event.itemId) {
      return `${prefix} ${event.code}: ${event.itemId}`;
    }
    return `${prefix} ${event.code}`;
  }
  return undefined;
}

function appendSupervisorMirrorEntry(
  state: AgentTuiInternalColumnState,
  event: AgentSessionEvent,
  maxTranscriptChars: number,
) {
  const text = formatMirroredEvent(event);
  if (!text) {
    return;
  }
  appendTranscript(state, `${text}\n`, maxTranscriptChars);
  pushTranscriptEntry(
    state,
    {
      count: 1,
      kind: "mirror",
      sequenceEnd: event.sequence,
      sequenceStart: event.sequence,
      text,
      timestamp: event.timestamp,
    },
    maxTranscriptChars,
  );
}

function summarizeEvent(event: AgentSessionEvent) {
  switch (event.type) {
    case "session":
      return formatLifecycleText(event.phase, event.data, event.session).trimEnd();
    case "status": {
      const text = event.text?.trim();
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

function pushEventHistory(
  state: AgentTuiInternalColumnState,
  event: AgentSessionEvent,
  maxEventHistory: number,
) {
  state.eventHistory.push({
    sequence: event.sequence,
    summary: summarizeEvent(event),
    timestamp: event.timestamp,
    type: event.type,
  });
  if (state.eventHistory.length > maxEventHistory) {
    state.eventHistory.splice(0, state.eventHistory.length - maxEventHistory);
  }
}

function shouldUpdateStatusSummary(event: Extract<AgentSessionEvent, { type: "status" }>) {
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

function compareColumnOrder(left: AgentTuiInternalColumnState, right: AgentTuiInternalColumnState) {
  if (left.session.kind === "supervisor" && right.session.kind !== "supervisor") {
    return -1;
  }
  if (left.session.kind !== "supervisor" && right.session.kind === "supervisor") {
    return 1;
  }
  if (left.firstSequence !== right.firstSequence) {
    return left.firstSequence - right.firstSequence;
  }
  return left.session.id.localeCompare(right.session.id);
}

function buildColumnSnapshots(
  sessions: Map<string, AgentTuiInternalColumnState>,
): AgentTuiColumnSnapshot[] {
  const states = Array.from(sessions.values());
  const statesById = new Map(states.map((state) => [state.session.id, state]));
  const childrenByParent = new Map<string, AgentTuiInternalColumnState[]>();
  const roots: AgentTuiInternalColumnState[] = [];

  for (const state of states) {
    const parentId = state.session.parentSessionId;
    if (!parentId || parentId === state.session.id || !statesById.has(parentId)) {
      roots.push(state);
      continue;
    }
    const children = childrenByParent.get(parentId) ?? [];
    children.push(state);
    childrenByParent.set(parentId, children);
  }

  roots.sort(compareColumnOrder);
  for (const children of childrenByParent.values()) {
    children.sort(compareColumnOrder);
  }

  const columns: AgentTuiColumnSnapshot[] = [];
  const visited = new Set<string>();

  const visit = (state: AgentTuiInternalColumnState, depth: number) => {
    if (visited.has(state.session.id)) {
      return;
    }
    visited.add(state.session.id);
    const childStates = childrenByParent.get(state.session.id) ?? [];
    columns.push({
      body: state.body,
      childSessionIds: childStates.map((child) => child.session.id),
      depth,
      eventHistory: [...state.eventHistory],
      firstSequence: state.firstSequence,
      lastSequence: state.lastSequence,
      parentSessionId: state.session.parentSessionId,
      phase: state.phase,
      session: state.session,
      status: state.status,
      transcriptEntries: [...state.transcriptEntries],
    });
    for (const child of childStates) {
      visit(child, depth + 1);
    }
  };

  for (const root of roots) {
    visit(root, 0);
  }

  const orphaned = states.filter((state) => !visited.has(state.session.id)).sort(compareColumnOrder);
  for (const state of orphaned) {
    visit(state, 0);
  }

  return columns;
}

export function createAgentTuiStore(options: AgentTuiStoreOptions = {}): AgentTuiStore {
  const listeners = new Set<() => void>();
  const maxEventHistory = options.maxEventHistory ?? DEFAULT_MAX_EVENT_HISTORY;
  const maxTranscriptChars = options.maxTranscriptChars ?? DEFAULT_MAX_TRANSCRIPT_CHARS;
  const retainTerminalSessions = options.retainTerminalSessions ?? true;
  const sessions = new Map<string, AgentTuiInternalColumnState>();
  let updatedAt: string | undefined;

  const deleteSessionTree = (sessionId: string) => {
    const childIds = Array.from(sessions.values())
      .filter((candidate) => candidate.session.parentSessionId === sessionId)
      .map((candidate) => candidate.session.id);
    for (const childId of childIds) {
      deleteSessionTree(childId);
    }
    sessions.delete(sessionId);
  };

  const getSessionState = (event: AgentSessionEvent) => {
    const existing = sessions.get(event.session.id);
    if (existing) {
      existing.session = mergeSessionRef(existing.session, event.session);
      existing.lastSequence = event.sequence;
      return existing;
    }
    const created = createSessionState(event.session, event.sequence);
    sessions.set(event.session.id, created);
    return created;
  };

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    getSnapshot() {
      const columns = buildColumnSnapshots(sessions);
      return {
        columns,
        sessions: columns,
        updatedAt,
      };
    },
    observe(event) {
      const state = getSessionState(event);
      updatedAt = event.timestamp;
      const supervisorState = sessions.get("supervisor");

      if (event.type === "session") {
        state.phase = event.phase;
        closeOpenLine(state, maxTranscriptChars);
        appendTranscript(
          state,
          formatLifecycleText(event.phase, event.data, state.session),
          maxTranscriptChars,
        );
        appendLifecycleEntry(state, event, maxTranscriptChars);
        pushEventHistory(state, event, maxEventHistory);
        if (supervisorState && shouldMirrorEventToSupervisor(event)) {
          appendSupervisorMirrorEntry(supervisorState, event, maxTranscriptChars);
        }
        if (
          !retainTerminalSessions &&
          event.session.kind !== "supervisor" &&
          (event.phase === "completed" || event.phase === "failed" || event.phase === "stopped")
        ) {
          deleteSessionTree(event.session.id);
        }
        notify();
        return;
      }

      if (event.type === "status") {
        if (shouldUpdateStatusSummary(event)) {
          state.status = {
            code: event.code,
            format: event.format,
            itemId: event.itemId,
            text: event.text,
            timestamp: event.timestamp,
          };
        }
        renderAgentStatusEvent({
          event,
          state: state.displayState,
          writeDisplay: (text) => {
            appendTranscript(state, text, maxTranscriptChars);
          },
        });
        appendStatusEntry(state, event, maxTranscriptChars);
        pushEventHistory(state, event, maxEventHistory);
        if (supervisorState && shouldMirrorEventToSupervisor(event)) {
          appendSupervisorMirrorEntry(supervisorState, event, maxTranscriptChars);
        }
        notify();
        return;
      }

      closeOpenLine(state, maxTranscriptChars);
      appendTranscript(state, formatRawLineEvent(event), maxTranscriptChars);
      appendRawEntry(state, event, maxTranscriptChars);
      pushEventHistory(state, event, maxEventHistory);
      if (supervisorState && shouldMirrorEventToSupervisor(event)) {
        appendSupervisorMirrorEntry(supervisorState, event, maxTranscriptChars);
      }
      notify();
      return;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
