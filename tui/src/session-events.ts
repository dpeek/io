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

export interface AgentSessionRef {
  branchName?: string;
  id: string;
  issue?: AgentSessionIssueRef;
  kind: AgentSessionKind;
  parentSessionId?: string;
  rootSessionId: string;
  threadId?: string;
  title: string;
  turnId?: string;
  workerId: string;
  workflow?: AgentSessionWorkflowRef;
  workspacePath?: string;
}

export type AgentSessionPhase =
  | "scheduled"
  | "started"
  | "completed"
  | "failed"
  | "stopped";

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
  data?: Record<string, unknown>;
  phase: AgentSessionPhase;
  type: "session";
}

export interface AgentStatusEvent extends AgentSessionEventBase {
  code: AgentStatusCode;
  data?: Record<string, unknown>;
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
