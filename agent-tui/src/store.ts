import type {
  AgentSessionEvent,
  AgentSessionEventObserver,
  AgentSessionIssueRef,
  AgentSessionPhase,
  AgentSessionRef,
} from "./session-events.js";
import {
  appendTranscriptEntriesForEvent,
  appendTranscriptEntry,
  createStatusSummary,
  createSupervisorMirrorEntry,
  formatTranscriptEntries,
  shouldMirrorEventToSupervisor,
  shouldUpdateStatusSummary,
  summarizeAgentSessionEvent,
  type AgentTuiAgentMessageEntry,
  type AgentTuiCommandOutputEntry,
  type AgentTuiLifecycleEntry,
  type AgentTuiMirrorEntry,
  type AgentTuiRawEntry,
  type AgentTuiStatusEntry,
  type AgentTuiStatusSummary,
  type AgentTuiTranscriptEntry,
} from "./transcript.js";

const DEFAULT_MAX_EVENT_HISTORY = 128;
const DEFAULT_MAX_TRANSCRIPT_CHARS = 24_000;

type AgentTuiInternalColumnState = {
  eventHistory: AgentTuiEventRecord[];
  firstSequence: number;
  lastSequence: number;
  phase: AgentSessionPhase | "pending";
  session: AgentSessionRef;
  status?: AgentTuiStatusSummary;
  transcriptEntries: AgentTuiTranscriptEntry[];
};

export type {
  AgentTuiAgentMessageEntry,
  AgentTuiCommandOutputEntry,
  AgentTuiLifecycleEntry,
  AgentTuiMirrorEntry,
  AgentTuiRawEntry,
  AgentTuiStatusEntry,
  AgentTuiStatusSummary,
  AgentTuiTranscriptEntry,
};

export interface AgentTuiEventRecord {
  sequence: number;
  summary: string;
  timestamp: string;
  type: AgentSessionEvent["type"];
}

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
  return {
    eventHistory: [],
    firstSequence: sequence,
    lastSequence: sequence,
    phase: "pending",
    session,
    transcriptEntries: [],
  };
}

function pushEventHistory(
  state: AgentTuiInternalColumnState,
  event: AgentSessionEvent,
  maxEventHistory: number,
) {
  state.eventHistory.push({
    sequence: event.sequence,
    summary: summarizeAgentSessionEvent(event),
    timestamp: event.timestamp,
    type: event.type,
  });
  if (state.eventHistory.length > maxEventHistory) {
    state.eventHistory.splice(0, state.eventHistory.length - maxEventHistory);
  }
}

function appendSupervisorMirrorEntry(
  state: AgentTuiInternalColumnState,
  event: AgentSessionEvent,
  maxTranscriptChars: number,
) {
  const mirrorEntry = createSupervisorMirrorEntry(event);
  if (!mirrorEntry) {
    return;
  }
  appendTranscriptEntry(state, mirrorEntry, maxTranscriptChars);
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
      body: formatTranscriptEntries(state.transcriptEntries, "plain"),
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
        appendTranscriptEntriesForEvent(state, event, maxTranscriptChars);
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

      if (event.type === "status" && shouldUpdateStatusSummary(event)) {
        state.status = createStatusSummary(event);
      }

      appendTranscriptEntriesForEvent(state, event, maxTranscriptChars);
      pushEventHistory(state, event, maxEventHistory);
      if (supervisorState && shouldMirrorEventToSupervisor(event)) {
        appendSupervisorMirrorEntry(supervisorState, event, maxTranscriptChars);
      }
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
