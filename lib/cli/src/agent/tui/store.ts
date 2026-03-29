import type {
  AgentSessionEvent,
  AgentSessionEventObserver,
  AgentSessionIssueRef,
  AgentSessionPhase,
  AgentSessionRef,
  AgentSessionRuntimeRef,
  AgentSessionWorkflowIssueRef,
  AgentSessionWorkflowRef,
  AgentWorkflowDiagnostics,
} from "./session-events.js";
import {
  appendBlocksForEvent,
  createStatusSummaryFromCodexNotification,
  createStatusSummary,
  formatBlocks,
  summarizeAgentSessionEvent,
  type AgentTuiApprovalEntry,
  type AgentTuiAgentMessageEntry,
  type AgentTuiCommandEntry,
  type AgentTuiCommandOutputEntry,
  type AgentTuiLifecycleEntry,
  type AgentTuiMirrorEntry,
  type AgentTuiPlanEntry,
  type AgentTuiRawEntry,
  type AgentTuiReasoningEntry,
  type AgentTuiStatusEntry,
  type AgentTuiStatusSummary,
  type AgentTuiBlock,
  type AgentTuiToolEntry,
} from "./transcript.js";

const DEFAULT_MAX_EVENT_HISTORY = 128;

type AgentTuiInternalColumnState = {
  eventHistory: AgentTuiEventRecord[];
  firstSequence: number;
  lastSequence: number;
  phase: AgentSessionPhase | "pending";
  session: AgentSessionRef;
  status?: AgentTuiStatusSummary;
  terminalSequence?: number;
  blocks: AgentTuiBlock[];
};

export type {
  AgentTuiApprovalEntry,
  AgentTuiAgentMessageEntry,
  AgentTuiCommandEntry,
  AgentTuiCommandOutputEntry,
  AgentTuiLifecycleEntry,
  AgentTuiMirrorEntry,
  AgentTuiPlanEntry,
  AgentTuiRawEntry,
  AgentTuiReasoningEntry,
  AgentTuiStatusEntry,
  AgentTuiStatusSummary,
  AgentTuiBlock,
  AgentTuiToolEntry,
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
  blocks: AgentTuiBlock[];
}

export type AgentTuiSessionSnapshot = AgentTuiColumnSnapshot;

export interface AgentTuiSnapshot {
  columns: AgentTuiColumnSnapshot[];
  sessions: AgentTuiSessionSnapshot[];
  updatedAt?: string;
  workflowDiagnostics?: AgentWorkflowDiagnostics;
}

export interface AgentTuiStore {
  getSnapshot(): AgentTuiSnapshot;
  observe: AgentSessionEventObserver;
  subscribe(listener: () => void): () => void;
}

export interface AgentTuiStoreOptions {
  maxEventHistory?: number;
  maxRetainedTerminalWorkers?: number;
  removeFinalizedSessions?: boolean;
  retainTerminalSessions?: boolean;
}

function isTerminalPhase(phase: AgentSessionPhase | "pending") {
  return phase === "completed" || phase === "failed" || phase === "stopped";
}

function isRetainedTerminalWorker(state: AgentTuiInternalColumnState) {
  return (
    state.session.kind === "worker" &&
    (state.phase === "completed" || state.phase === "failed" || state.phase === "stopped")
  );
}

function mergeFinalizationRef(
  current: AgentSessionRuntimeRef["finalization"],
  next: AgentSessionRuntimeRef["finalization"],
) {
  if (!current && !next) {
    return undefined;
  }
  return {
    ...current,
    ...next,
    state: next?.state ?? current?.state ?? "pending",
  };
}

function mergeWorkflowIssueRef(
  current: AgentSessionWorkflowIssueRef | undefined,
  next: AgentSessionWorkflowIssueRef | undefined,
) {
  const merged = current || next ? { ...current, ...next } : undefined;
  return merged?.identifier ? (merged as AgentSessionWorkflowIssueRef) : undefined;
}

function mergeRuntimeRef(
  current: AgentSessionRuntimeRef | undefined,
  next: AgentSessionRuntimeRef | undefined,
): AgentSessionRuntimeRef | undefined {
  if (!current && !next) {
    return undefined;
  }
  return {
    ...current,
    ...next,
    blocker:
      current?.blocker || next?.blocker
        ? {
            ...current?.blocker,
            ...next?.blocker,
          }
        : undefined,
    finalization: mergeFinalizationRef(current?.finalization, next?.finalization),
  };
}

function mergeSessionRef(current: AgentSessionRef, next: AgentSessionRef): AgentSessionRef {
  let issue: AgentSessionIssueRef | undefined;
  if (current.issue || next.issue) {
    issue = {
      ...current.issue,
      ...next.issue,
    } as AgentSessionIssueRef;
  }
  let workflow: AgentSessionWorkflowRef | undefined;
  if (current.workflow || next.workflow) {
    workflow = {
      feature: mergeWorkflowIssueRef(current.workflow?.feature, next.workflow?.feature),
      stream: mergeWorkflowIssueRef(current.workflow?.stream, next.workflow?.stream),
      task: mergeWorkflowIssueRef(current.workflow?.task, next.workflow?.task),
    };
  }
  return {
    ...current,
    ...next,
    issue,
    runtime: mergeRuntimeRef(current.runtime, next.runtime),
    workflow,
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
    blocks: [],
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

function compareColumnOrder(left: AgentTuiInternalColumnState, right: AgentTuiInternalColumnState) {
  if (left.session.kind === "supervisor" && right.session.kind !== "supervisor") {
    return -1;
  }
  if (left.session.kind !== "supervisor" && right.session.kind === "supervisor") {
    return 1;
  }

  const leftIsTerminal = isTerminalPhase(left.phase);
  const rightIsTerminal = isTerminalPhase(right.phase);
  if (leftIsTerminal !== rightIsTerminal) {
    return leftIsTerminal ? 1 : -1;
  }

  if (leftIsTerminal && rightIsTerminal) {
    const leftTerminalSequence = left.terminalSequence ?? left.lastSequence;
    const rightTerminalSequence = right.terminalSequence ?? right.lastSequence;
    if (leftTerminalSequence !== rightTerminalSequence) {
      return rightTerminalSequence - leftTerminalSequence;
    }
  } else if (left.firstSequence !== right.firstSequence) {
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
      body: formatBlocks(state.blocks),
      childSessionIds: childStates.map((child) => child.session.id),
      depth,
      eventHistory: [...state.eventHistory],
      firstSequence: state.firstSequence,
      lastSequence: state.lastSequence,
      parentSessionId: state.session.parentSessionId,
      phase: state.phase,
      session: state.session,
      status: state.status,
      blocks: [...state.blocks],
    });
    for (const child of childStates) {
      visit(child, depth + 1);
    }
  };

  for (const root of roots) {
    visit(root, 0);
  }

  const orphaned = states
    .filter((state) => !visited.has(state.session.id))
    .sort(compareColumnOrder);
  for (const state of orphaned) {
    visit(state, 0);
  }

  return columns;
}

export function createAgentTuiStore(options: AgentTuiStoreOptions = {}): AgentTuiStore {
  const listeners = new Set<() => void>();
  const maxEventHistory = options.maxEventHistory ?? DEFAULT_MAX_EVENT_HISTORY;
  const maxRetainedTerminalWorkers = options.maxRetainedTerminalWorkers;
  const removeFinalizedSessions = options.removeFinalizedSessions ?? false;
  const retainTerminalSessions = options.retainTerminalSessions ?? true;
  const sessions = new Map<string, AgentTuiInternalColumnState>();
  let updatedAt: string | undefined;
  let workflowDiagnostics: AgentWorkflowDiagnostics | undefined;

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

  const pruneRetainedTerminalWorkers = () => {
    if (
      !retainTerminalSessions ||
      !Number.isFinite(maxRetainedTerminalWorkers) ||
      (maxRetainedTerminalWorkers ?? 0) < 0
    ) {
      return;
    }

    const terminalWorkers = Array.from(sessions.values())
      .filter(isRetainedTerminalWorker)
      .sort((left, right) => {
        const leftTerminalSequence = left.terminalSequence ?? left.lastSequence;
        const rightTerminalSequence = right.terminalSequence ?? right.lastSequence;
        if (leftTerminalSequence !== rightTerminalSequence) {
          return leftTerminalSequence - rightTerminalSequence;
        }
        return left.session.id.localeCompare(right.session.id);
      });

    const overflow = terminalWorkers.length - (maxRetainedTerminalWorkers ?? 0);
    if (overflow <= 0) {
      return;
    }

    for (const worker of terminalWorkers.slice(0, overflow)) {
      deleteSessionTree(worker.session.id);
    }
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
        workflowDiagnostics,
      };
    },
    observe(event) {
      const state = getSessionState(event);
      updatedAt = event.timestamp;
      if (event.type === "session") {
        state.phase = event.phase;
        state.terminalSequence = isTerminalPhase(event.phase) ? event.sequence : undefined;
        appendBlocksForEvent(state, event);
        pushEventHistory(state, event, maxEventHistory);
        if (
          event.session.kind !== "supervisor" &&
          ((removeFinalizedSessions && event.session.runtime?.state === "finalized") ||
            (!retainTerminalSessions && isTerminalPhase(event.phase)))
        ) {
          deleteSessionTree(event.session.id);
        } else {
          pruneRetainedTerminalWorkers();
        }
        notify();
        return;
      }

      if (event.type === "codex-notification") {
        const summary = createStatusSummaryFromCodexNotification(event);
        if (summary) {
          state.status = summary;
        }
      } else if (event.type === "status" && event.format !== "close") {
        if (event.code === "workflow-diagnostic" && event.data?.workflowDiagnostics) {
          workflowDiagnostics = event.data.workflowDiagnostics;
        }
        switch (event.code) {
          case "agent-message-delta":
          case "agent-message-completed":
          case "command-output":
            break;
          default:
            state.status = createStatusSummary(event);
            break;
        }
      }

      appendBlocksForEvent(state, event);
      pushEventHistory(state, event, maxEventHistory);
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
