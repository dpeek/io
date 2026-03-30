import type {
  AgentSessionAppendEvent,
  AgentSessionAppendRequest,
  AgentSessionAppendSessionCreate,
  AgentSessionAppendSessionKind,
  AgentSessionAppendSubject,
} from "@io/graph-module-workflow";

import type { AgentSessionEvent, AgentSessionRef } from "./tui/session-events.js";

export interface AgentSessionAppendLaunchContext {
  readonly kind: AgentSessionAppendSessionKind;
  readonly projectId: string;
  readonly repositoryId?: string;
  readonly sessionId?: string;
  readonly sessionKey: string;
  readonly startedAt?: string;
  readonly subject: AgentSessionAppendSubject;
}

function mapRetainedSessionRef(session: AgentSessionRef) {
  return {
    branchName: session.branchName,
    externalSessionId: session.id,
    issue: session.issue,
    parentSessionId: session.parentSessionId,
    retainedRole: session.kind,
    rootSessionId: session.rootSessionId,
    runtime: session.runtime,
    workflow: session.workflow,
    workspacePath: session.workspacePath,
  } satisfies AgentSessionAppendSessionCreate["retainedSession"];
}

export function mapRetainedAgentSessionEventToAppendEvent(
  event: AgentSessionEvent,
): AgentSessionAppendEvent {
  switch (event.type) {
    case "session":
      return {
        type: event.type,
        phase: event.phase,
        sequence: event.sequence,
        timestamp: event.timestamp,
        data: event.data,
      };
    case "status":
      return {
        type: event.type,
        code: event.code,
        data: event.data,
        format: event.format,
        itemId: event.itemId,
        sequence: event.sequence,
        text: event.text,
        timestamp: event.timestamp,
      };
    case "raw-line":
      return {
        type: event.type,
        encoding: event.encoding,
        line: event.line,
        sequence: event.sequence,
        stream: event.stream,
        timestamp: event.timestamp,
      };
    case "codex-notification":
      return {
        type: event.type,
        method: event.method,
        params: event.params,
        sequence: event.sequence,
        timestamp: event.timestamp,
      };
  }
}

export function createAgentSessionAppendRequestFromRetainedEvents(input: {
  readonly events: readonly AgentSessionEvent[];
  readonly launch: AgentSessionAppendLaunchContext;
}): AgentSessionAppendRequest {
  const firstEvent = input.events[0];
  if (!firstEvent) {
    throw new Error("Retained session append requests require at least one event.");
  }

  const latestSession = input.events[input.events.length - 1]!.session;
  for (const event of input.events) {
    if (event.session.id !== latestSession.id) {
      throw new Error("Retained session append batches must contain exactly one session id.");
    }
  }

  return {
    session:
      input.launch.sessionId === undefined
        ? {
            mode: "create",
            kind: input.launch.kind,
            projectId: input.launch.projectId,
            repositoryId: input.launch.repositoryId,
            retainedSession: mapRetainedSessionRef(latestSession),
            sessionKey: input.launch.sessionKey,
            startedAt: input.launch.startedAt ?? firstEvent.timestamp,
            subject: input.launch.subject,
            threadId: latestSession.threadId,
            title: latestSession.title,
            turnId: latestSession.turnId,
            workerId: latestSession.workerId,
          }
        : {
            mode: "existing",
            sessionId: input.launch.sessionId,
          },
    events: input.events.map(mapRetainedAgentSessionEventToAppendEvent),
  };
}
