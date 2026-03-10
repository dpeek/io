import type {
  AgentRawLineEvent,
  AgentSessionEvent,
  AgentSessionEventObserver,
  AgentSessionIssueRef,
  AgentSessionPhase,
  AgentSessionRef,
} from "./session-events.js";
import {
  createAgentSessionDisplayState,
  renderAgentStatusEvent,
  type AgentSessionDisplayState,
} from "./session-events.js";

const DEFAULT_FRAME_COLUMNS = 120;
const DEFAULT_FRAME_ROWS = 32;
const DEFAULT_MAX_TRANSCRIPT_CHARS = 24_000;

type AgentTuiInternalSessionState = {
  body: string;
  displayState: AgentSessionDisplayState;
  firstSequence: number;
  lastSequence: number;
  phase: AgentSessionPhase | "pending";
  session: AgentSessionRef;
};

export interface AgentTuiSessionSnapshot {
  body: string;
  firstSequence: number;
  lastSequence: number;
  phase: AgentSessionPhase | "pending";
  session: AgentSessionRef;
}

export interface AgentTuiSnapshot {
  sessions: AgentTuiSessionSnapshot[];
  updatedAt?: string;
}

export interface AgentTuiStore {
  getSnapshot(): AgentTuiSnapshot;
  observe: AgentSessionEventObserver;
  subscribe(listener: () => void): () => void;
}

export interface AgentTuiFrameSize {
  columns?: number;
  rows?: number;
}

export interface AgentTuiTerminal {
  columns?: number;
  isTTY?: boolean;
  off?: (event: "resize", listener: () => void) => void;
  on?: (event: "resize", listener: () => void) => void;
  rows?: number;
  write: (text: string) => void;
}

export interface AgentTuiOptions {
  maxTranscriptChars?: number;
  output?: AgentTuiTerminal;
  requireTty?: boolean;
  store?: AgentTuiStore;
}

export interface AgentTui {
  getSnapshot(): AgentTuiSnapshot;
  observe: AgentSessionEventObserver;
  start(): void;
  stop(): void;
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
): AgentTuiInternalSessionState {
  const displayState = createAgentSessionDisplayState();
  displayState.headerPrinted = true;
  return {
    body: "",
    displayState,
    firstSequence: sequence,
    lastSequence: sequence,
    phase: "pending",
    session,
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
  state: AgentTuiInternalSessionState,
  text: string,
  maxTranscriptChars: number,
) {
  if (!text) {
    return;
  }
  state.body = trimTranscript(`${state.body}${text}`, maxTranscriptChars);
}

function closeOpenLine(state: AgentTuiInternalSessionState, maxTranscriptChars: number) {
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

function truncateEnd(text: string, width: number) {
  if (width <= 0) {
    return "";
  }
  if (text.length <= width) {
    return text;
  }
  if (width <= 3) {
    return text.slice(0, width);
  }
  return `${text.slice(0, width - 3)}...`;
}

function truncateStart(text: string, width: number) {
  if (width <= 0) {
    return "";
  }
  if (text.length <= width) {
    return text;
  }
  if (width <= 3) {
    return text.slice(text.length - width);
  }
  return `...${text.slice(text.length - (width - 3))}`;
}

function padCell(text: string, width: number) {
  return truncateEnd(text, width).padEnd(Math.max(width, 0), " ");
}

function wrapLine(text: string, width: number) {
  if (width <= 0) {
    return [];
  }
  if (!text.length) {
    return [""];
  }
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += width) {
    chunks.push(text.slice(index, index + width));
  }
  return chunks;
}

function wrapBody(text: string, width: number) {
  if (width <= 0) {
    return [];
  }
  const sourceLines = text.split("\n");
  if (text.endsWith("\n")) {
    sourceLines.pop();
  }
  return sourceLines.flatMap((line) => wrapLine(line, width));
}

function sortSessions(left: AgentTuiInternalSessionState, right: AgentTuiInternalSessionState) {
  if (left.session.kind === "supervisor" && right.session.kind !== "supervisor") {
    return -1;
  }
  if (left.session.kind !== "supervisor" && right.session.kind === "supervisor") {
    return 1;
  }
  return left.firstSequence - right.firstSequence;
}

function formatTitle(session: AgentSessionRef) {
  if (session.kind === "supervisor") {
    return "Supervisor";
  }
  const identifier = session.issue?.identifier ?? session.workerId;
  return `${identifier} ${session.title}`;
}

function formatMetaLine(snapshot: AgentTuiSessionSnapshot) {
  const parts: string[] = [snapshot.phase];
  if (snapshot.session.kind !== "supervisor") {
    parts.unshift(snapshot.session.workerId);
  }
  if (snapshot.session.branchName) {
    parts.push(snapshot.session.branchName);
  }
  return parts.join(" | ");
}

function formatLocationLine(snapshot: AgentTuiSessionSnapshot, width: number) {
  if (!snapshot.session.workspacePath) {
    return "";
  }
  return truncateStart(snapshot.session.workspacePath, width);
}

function distributeColumnWidths(totalWidth: number, columnCount: number) {
  if (columnCount <= 0) {
    return [];
  }
  const separatorWidth = Math.max(0, columnCount - 1);
  const availableWidth = Math.max(columnCount, totalWidth - separatorWidth);
  const baseWidth = Math.floor(availableWidth / columnCount);
  let remainder = availableWidth % columnCount;
  return Array.from({ length: columnCount }, () => {
    const width = baseWidth + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    return width;
  });
}

function renderEmptyFrame(columns: number, rows: number) {
  const safeColumns = Math.max(1, columns);
  const safeRows = Math.max(1, rows);
  const lines = Array.from({ length: safeRows }, (_, index) =>
    index === 0
      ? padCell("Waiting for agent session events...", safeColumns)
      : "".padEnd(safeColumns, " "),
  );
  return lines.join("\n");
}

function renderColumn(snapshot: AgentTuiSessionSnapshot, width: number, rows: number) {
  const headerLines = [
    padCell(formatTitle(snapshot.session), width),
    padCell(formatMetaLine(snapshot), width),
    padCell(formatLocationLine(snapshot, width), width),
    "".padEnd(Math.max(width, 0), "-"),
  ];
  const bodyHeight = Math.max(0, rows - headerLines.length);
  const wrappedBody = wrapBody(snapshot.body, width);
  const visibleBody = wrappedBody.slice(-bodyHeight);
  const paddedBody = visibleBody
    .map((line) => padCell(line, width))
    .concat(Array.from({ length: Math.max(0, bodyHeight - visibleBody.length) }, () => "".padEnd(width, " ")));
  return headerLines.concat(paddedBody);
}

export function createAgentTuiStore(options: { maxTranscriptChars?: number } = {}): AgentTuiStore {
  const listeners = new Set<() => void>();
  const maxTranscriptChars = options.maxTranscriptChars ?? DEFAULT_MAX_TRANSCRIPT_CHARS;
  const sessions = new Map<string, AgentTuiInternalSessionState>();
  let updatedAt: string | undefined;

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
      return {
        sessions: Array.from(sessions.values())
          .sort(sortSessions)
          .map((state) => ({
            body: state.body,
            firstSequence: state.firstSequence,
            lastSequence: state.lastSequence,
            phase: state.phase,
            session: state.session,
          })),
        updatedAt,
      };
    },
    observe(event) {
      const state = getSessionState(event);
      updatedAt = event.timestamp;

      if (event.type === "session") {
        state.phase = event.phase;
        closeOpenLine(state, maxTranscriptChars);
        appendTranscript(
          state,
          formatLifecycleText(event.phase, event.data, state.session),
          maxTranscriptChars,
        );
        notify();
        return;
      }

      if (event.type === "status") {
        renderAgentStatusEvent({
          event,
          state: state.displayState,
          writeDisplay: (text) => {
            appendTranscript(state, text, maxTranscriptChars);
          },
        });
        notify();
        return;
      }

      closeOpenLine(state, maxTranscriptChars);
      appendTranscript(state, formatRawLineEvent(event), maxTranscriptChars);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function renderAgentTuiFrame(snapshot: AgentTuiSnapshot, size: AgentTuiFrameSize = {}) {
  const columns = Math.max(1, size.columns ?? DEFAULT_FRAME_COLUMNS);
  const rows = Math.max(1, size.rows ?? DEFAULT_FRAME_ROWS);
  if (!snapshot.sessions.length) {
    return renderEmptyFrame(columns, rows);
  }

  const widths = distributeColumnWidths(columns, snapshot.sessions.length);
  const columnsBySession = snapshot.sessions.map((session, index) =>
    renderColumn(session, widths[index] ?? 1, rows),
  );
  const lines = Array.from({ length: rows }, (_, rowIndex) =>
    columnsBySession.map((column, index) => column[rowIndex] ?? "".padEnd(widths[index] ?? 1, " ")).join("|"),
  );
  return lines.join("\n");
}

export function createAgentTui(options: AgentTuiOptions = {}): AgentTui {
  const output = options.output ?? process.stdout;
  const requireTty = options.requireTty ?? true;
  const store = options.store ?? createAgentTuiStore();
  let active = false;
  let renderScheduled = false;
  let unsubscribe: () => void = () => undefined;

  const render = () => {
    renderScheduled = false;
    const frame = renderAgentTuiFrame(store.getSnapshot(), {
      columns: output.columns,
      rows: output.rows,
    });
    output.write(`\x1b[H\x1b[2J${frame}`);
  };

  const scheduleRender = () => {
    if (!active || renderScheduled) {
      return;
    }
    renderScheduled = true;
    queueMicrotask(render);
  };

  const handleResize = () => {
    if (!active) {
      return;
    }
    render();
  };

  return {
    getSnapshot() {
      return store.getSnapshot();
    },
    observe(event) {
      store.observe(event);
    },
    start() {
      if (active) {
        return;
      }
      if (requireTty && !output.isTTY) {
        throw new Error("io agent tui requires a TTY");
      }
      active = true;
      unsubscribe = store.subscribe(scheduleRender);
      output.write("\x1b[?1049h\x1b[?25l");
      output.on?.("resize", handleResize);
      render();
    },
    stop() {
      if (!active) {
        return;
      }
      active = false;
      renderScheduled = false;
      unsubscribe();
      unsubscribe = () => undefined;
      output.off?.("resize", handleResize);
      output.write("\x1b[?25h\x1b[?1049l");
    },
  };
}
