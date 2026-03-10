export type AgentSessionKind = "supervisor" | "worker" | "child";

export interface AgentSessionIssueRef {
  id?: string;
  identifier: string;
  title: string;
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

export type AgentSessionEvent = AgentSessionLifecycleEvent | AgentStatusEvent | AgentRawLineEvent;

export type AgentSessionLifecycleEventInit = Omit<
  AgentSessionLifecycleEvent,
  "sequence" | "timestamp"
>;
export type AgentStatusEventInit = Omit<AgentStatusEvent, "sequence" | "timestamp">;
export type AgentRawLineEventInit = Omit<AgentRawLineEvent, "sequence" | "timestamp">;
export type AgentSessionEventInit =
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

export function createAgentSessionDisplayState(): AgentSessionDisplayState {
  return {
    headerPrinted: false,
    lineOpen: false,
  };
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
      renderSessionLine(event.text ?? "", state, writeDisplay);
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

    const issueIdentifier = event.session.issue?.identifier ?? event.session.workerId;
    const text = `[${issueIdentifier} ${event.stream}] ${event.line}\n`;
    if (event.stream === "stderr") {
      process.stderr.write(text);
      return;
    }
    process.stdout.write(text);
  };
}
