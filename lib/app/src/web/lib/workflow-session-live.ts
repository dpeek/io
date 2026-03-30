import type { AgentSessionAppendEvent } from "@io/graph-module-workflow";

export interface WorkflowSessionLiveEvent {
  readonly browserAgentSessionId: string;
  readonly event: AgentSessionAppendEvent;
  readonly fingerprint: string;
  readonly sessionId: string;
}

export interface WorkflowSessionTimelineEvent {
  readonly event: AgentSessionAppendEvent;
  readonly transient: boolean;
}

export interface WorkflowSessionLiveReconciliation {
  readonly conflictingEvents: readonly WorkflowSessionLiveEvent[];
  readonly pendingEvents: readonly WorkflowSessionLiveEvent[];
}

function compareLiveEvents(
  left: WorkflowSessionLiveEvent,
  right: WorkflowSessionLiveEvent,
): number {
  return (
    left.event.sequence - right.event.sequence ||
    left.fingerprint.localeCompare(right.fingerprint) ||
    left.sessionId.localeCompare(right.sessionId)
  );
}

function createSessionEventFingerprint(event: AgentSessionAppendEvent): string {
  switch (event.type) {
    case "session":
      return JSON.stringify({
        type: event.type,
        sequence: event.sequence,
        timestamp: event.timestamp,
        phase: event.phase,
        ...(event.data !== undefined ? { data: event.data } : {}),
      });
    case "status":
      return JSON.stringify({
        type: event.type,
        sequence: event.sequence,
        timestamp: event.timestamp,
        code: event.code,
        format: event.format,
        ...(event.itemId !== undefined ? { itemId: event.itemId } : {}),
        ...(event.text !== undefined ? { text: event.text } : {}),
        ...(event.data !== undefined ? { data: event.data } : {}),
      });
    case "raw-line":
      return JSON.stringify({
        type: event.type,
        sequence: event.sequence,
        timestamp: event.timestamp,
        encoding: event.encoding,
        line: event.line,
        stream: event.stream,
      });
    case "codex-notification":
      return JSON.stringify({
        type: event.type,
        sequence: event.sequence,
        timestamp: event.timestamp,
        method: event.method,
        params: event.params,
      });
  }
}

export function createWorkflowSessionLiveEvent(input: {
  readonly browserAgentSessionId: string;
  readonly event: AgentSessionAppendEvent;
  readonly sessionId: string;
}): WorkflowSessionLiveEvent {
  return {
    browserAgentSessionId: input.browserAgentSessionId,
    event: input.event,
    fingerprint: createSessionEventFingerprint(input.event),
    sessionId: input.sessionId,
  };
}

export function appendWorkflowSessionLiveEvent(
  events: readonly WorkflowSessionLiveEvent[],
  nextEvent: WorkflowSessionLiveEvent,
): readonly WorkflowSessionLiveEvent[] {
  const duplicate = events.find(
    (event) =>
      event.sessionId === nextEvent.sessionId &&
      event.event.sequence === nextEvent.event.sequence &&
      event.fingerprint === nextEvent.fingerprint,
  );
  if (duplicate) {
    return events;
  }

  return [
    ...events.filter((event) => event.event.sequence !== nextEvent.event.sequence),
    nextEvent,
  ].sort(compareLiveEvents);
}

export function reconcileWorkflowSessionLiveEvents(
  authoritativeEvents: readonly AgentSessionAppendEvent[],
  localEvents: readonly WorkflowSessionLiveEvent[],
): readonly WorkflowSessionLiveEvent[] {
  const { conflictingEvents, pendingEvents } = partitionWorkflowSessionLiveEvents(
    authoritativeEvents,
    localEvents,
  );
  return [...pendingEvents, ...conflictingEvents].sort(compareLiveEvents);
}

export function partitionWorkflowSessionLiveEvents(
  authoritativeEvents: readonly AgentSessionAppendEvent[],
  localEvents: readonly WorkflowSessionLiveEvent[],
): WorkflowSessionLiveReconciliation {
  const authoritativeFingerprints = new Map<number, string>();
  for (const event of authoritativeEvents) {
    authoritativeFingerprints.set(event.sequence, createSessionEventFingerprint(event));
  }

  const pendingEvents: WorkflowSessionLiveEvent[] = [];
  const conflictingEvents: WorkflowSessionLiveEvent[] = [];

  for (const event of localEvents) {
    const authoritativeFingerprint = authoritativeFingerprints.get(event.event.sequence);
    if (authoritativeFingerprint === undefined) {
      pendingEvents.push(event);
      continue;
    }

    if (authoritativeFingerprint !== event.fingerprint) {
      conflictingEvents.push(event);
    }
  }

  return {
    conflictingEvents: conflictingEvents.sort(compareLiveEvents),
    pendingEvents: pendingEvents.sort(compareLiveEvents),
  };
}

export function mergeWorkflowSessionTimelineEvents(input: {
  readonly authoritativeEvents: readonly AgentSessionAppendEvent[];
  readonly localEvents: readonly WorkflowSessionLiveEvent[];
}): readonly WorkflowSessionTimelineEvent[] {
  const remainingLocalEvents = reconcileWorkflowSessionLiveEvents(
    input.authoritativeEvents,
    input.localEvents,
  );

  return [
    ...input.authoritativeEvents.map((event) => ({
      event,
      transient: false,
    })),
    ...remainingLocalEvents.map((event) => ({
      event: event.event,
      transient: true,
    })),
  ].sort(
    (left, right) =>
      left.event.sequence - right.event.sequence ||
      Number(left.transient) - Number(right.transient),
  );
}
