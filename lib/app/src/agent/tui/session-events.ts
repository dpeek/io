export {
  closeAgentSessionDisplayLine,
  createAgentSessionDisplayState,
  createAgentSessionStdoutObserver,
  renderCodexNotificationEvent,
  renderAgentStatusEvent,
} from "./transcript.js";

export type AgentSessionKind = "supervisor" | "worker" | "child";

export interface AgentSessionIssueRef {
  id?: string;
  identifier: string;
  title: string;
}

export interface AgentSessionWorkflowIssueRef {
  id?: string;
  identifier: string;
  state?: string;
  title?: string;
}

export interface AgentSessionWorkflowRef {
  feature?: AgentSessionWorkflowIssueRef;
  stream?: AgentSessionWorkflowIssueRef;
  task?: AgentSessionWorkflowIssueRef;
}

export type AgentSessionRuntimeState =
  | "blocked"
  | "finalized"
  | "interrupted"
  | "pending-finalization"
  | "running";

export interface AgentSessionBlockerRef {
  kind?: "blocked" | "interrupted";
  reason?: string;
}

export interface AgentSessionFinalizationRef {
  commitSha?: string;
  finalizedAt?: string;
  landedAt?: string;
  linearState?: string;
  state: "finalized" | "pending";
}

export interface AgentSessionRuntimeRef {
  blocker?: AgentSessionBlockerRef;
  finalization?: AgentSessionFinalizationRef;
  state?: AgentSessionRuntimeState;
}

export type AgentWorkflowDiagnosticCategory =
  | "active"
  | "blocked"
  | "blocked-by-dependency"
  | "interrupted"
  | "occupied"
  | "pending-finalization"
  | "runnable"
  | "waiting-for-agent-slot"
  | "waiting-for-workflow-release";

export interface AgentWorkflowDiagnosticHeldByRef {
  identifier: string;
  status?: string;
}

export interface AgentWorkflowDiagnosticIssue {
  blockedBy?: string[];
  branchName?: string;
  current: AgentSessionWorkflowIssueRef;
  heldBy?: AgentWorkflowDiagnosticHeldByRef;
  waitingOn?: string[];
  workflow: AgentSessionWorkflowRef;
}

export interface AgentWorkflowDiagnostics {
  counts?: Partial<Record<AgentWorkflowDiagnosticCategory, number>>;
  items?: Partial<Record<AgentWorkflowDiagnosticCategory, AgentWorkflowDiagnosticIssue[]>>;
  summaryText?: string;
}

export interface AgentSessionEventData extends Record<string, unknown> {
  workflowDiagnostics?: AgentWorkflowDiagnostics;
}

export interface AgentSessionRef {
  branchName?: string;
  id: string;
  issue?: AgentSessionIssueRef;
  kind: AgentSessionKind;
  parentSessionId?: string;
  rootSessionId: string;
  runtime?: AgentSessionRuntimeRef;
  threadId?: string;
  title: string;
  turnId?: string;
  workerId: string;
  workflow?: AgentSessionWorkflowRef;
  workspacePath?: string;
}

export type AgentSessionPhase = "scheduled" | "started" | "completed" | "failed" | "stopped";

export type AgentStatusCode =
  | "ready"
  | "idle"
  | "workflow-diagnostic"
  | "issue-assigned"
  | "issue-blocked"
  | "issue-committed"
  | "thread-started"
  | "turn-started"
  | "turn-completed"
  | "turn-cancelled"
  | "turn-failed"
  | "waiting-on-user-input"
  | "agent-message-delta"
  | "agent-message-completed"
  | "command"
  | "command-output"
  | "command-failed"
  | "approval-required"
  | "tool"
  | "tool-failed"
  | "error";

export type AgentStatusFormat = "line" | "chunk" | "close";

interface AgentSessionEventBase {
  sequence: number;
  session: AgentSessionRef;
  timestamp: string;
}

export interface AgentSessionLifecycleEvent extends AgentSessionEventBase {
  data?: AgentSessionEventData;
  phase: AgentSessionPhase;
  type: "session";
}

export interface AgentStatusEvent extends AgentSessionEventBase {
  code: AgentStatusCode;
  data?: AgentSessionEventData;
  format: AgentStatusFormat;
  itemId?: string;
  text?: string;
  type: "status";
}

export interface AgentRawLineEvent extends AgentSessionEventBase {
  encoding: "jsonl" | "text";
  line: string;
  stream: "stdout" | "stderr";
  type: "raw-line";
}

export interface AgentCodexNotificationEvent extends AgentSessionEventBase {
  method: string;
  params: Record<string, unknown>;
  type: "codex-notification";
}

export type AgentSessionEvent =
  | AgentCodexNotificationEvent
  | AgentSessionLifecycleEvent
  | AgentStatusEvent
  | AgentRawLineEvent;

export type AgentSessionLifecycleEventInit = Omit<
  AgentSessionLifecycleEvent,
  "sequence" | "timestamp"
>;
export type AgentStatusEventInit = Omit<AgentStatusEvent, "sequence" | "timestamp">;
export type AgentRawLineEventInit = Omit<AgentRawLineEvent, "sequence" | "timestamp">;
export type AgentCodexNotificationEventInit = Omit<
  AgentCodexNotificationEvent,
  "sequence" | "timestamp"
>;
export type AgentSessionEventInit =
  | AgentCodexNotificationEventInit
  | AgentSessionLifecycleEventInit
  | AgentStatusEventInit
  | AgentRawLineEventInit;

export type AgentSessionEventObserver = (event: AgentSessionEvent) => void;

export interface AgentSessionEventBus {
  publish(event: AgentSessionEventInit): AgentSessionEvent;
  subscribe(observer: AgentSessionEventObserver): () => void;
}

export interface AgentSessionDisplayState {
  activeAgentMessageId?: string;
  headerPrinted: boolean;
  lineOpen: boolean;
}

export function createAgentSessionEventBus(): AgentSessionEventBus {
  let sequence = 0;
  const observers = new Set<AgentSessionEventObserver>();

  return {
    publish(event) {
      const stampedEvent = {
        ...event,
        sequence: ++sequence,
        timestamp: new Date().toISOString(),
      } as AgentSessionEvent;
      for (const observer of observers) {
        observer(stampedEvent);
      }
      return stampedEvent;
    },
    subscribe(observer) {
      observers.add(observer);
      return () => {
        observers.delete(observer);
      };
    },
  };
}
