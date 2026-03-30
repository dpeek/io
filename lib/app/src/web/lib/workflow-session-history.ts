import { type GraphStore } from "@io/app/graph";
import { type AuthoritativeGraphWriteResult, type GraphWriteTransaction } from "@io/graph-kernel";
import {
  createAgentSessionAppendEventFingerprint,
  evaluateAgentSessionAppendRequest,
  type AgentSessionAppendEvent,
  type AgentSessionAppendRequest,
  type AgentSessionAppendResult,
  type AgentSessionAppendSessionCreate,
  type AgentSessionAppendSuccess,
  workflow,
} from "@io/graph-module-workflow";

import type {
  WebAppAuthorityCommandOptions,
  WebAppAuthorityTransactionOptions,
} from "./authority.js";
import {
  WorkflowMutationError,
  parseOptionalDate,
  planWorkflowMutation,
  trimOptionalString,
  type ProductGraphClient,
} from "./workflow-mutation-helpers.js";
import {
  requireBranch,
  requireCommit,
  requireProject,
  requireRepository,
} from "./workflow-authority-shared.js";

type AgentSessionAppendAuthority = {
  readonly store: GraphStore;
  applyTransaction(
    transaction: GraphWriteTransaction,
    options: WebAppAuthorityTransactionOptions,
  ): Promise<AuthoritativeGraphWriteResult>;
};

type GraphAgentSessionRuntimeState =
  | "awaiting-user-input"
  | "blocked"
  | "cancelled"
  | "completed"
  | "failed"
  | "running";

type SessionRuntimeProjection = {
  readonly endedAt?: Date;
  readonly runtimeState: GraphAgentSessionRuntimeState;
};

type AgentSessionAppendFailure = Extract<AgentSessionAppendResult, { readonly ok: false }>;
type ResolvedAppendSubject = {
  readonly branchId: string;
  readonly commitId?: string;
};
type AgentSessionCreateValues = Parameters<ProductGraphClient["agentSession"]["create"]>[0];
type AgentSessionEventCreateValues = Parameters<
  ProductGraphClient["agentSessionEvent"]["create"]
>[0];

const maxAgentSessionEventBytes = 64 * 1024;

const agentSessionSubjectKindIds = {
  branch: workflow.agentSessionSubjectKind.values.branch.id as string,
  commit: workflow.agentSessionSubjectKind.values.commit.id as string,
} as const;

const agentSessionKindIds = {
  execution: workflow.agentSessionKind.values.execution.id as string,
  planning: workflow.agentSessionKind.values.planning.id as string,
  review: workflow.agentSessionKind.values.review.id as string,
} as const;

const agentSessionRuntimeStateIds = {
  "awaiting-user-input": workflow.agentSessionRuntimeState.values["awaiting-user-input"]
    .id as string,
  blocked: workflow.agentSessionRuntimeState.values.blocked.id as string,
  cancelled: workflow.agentSessionRuntimeState.values.cancelled.id as string,
  completed: workflow.agentSessionRuntimeState.values.completed.id as string,
  failed: workflow.agentSessionRuntimeState.values.failed.id as string,
  running: workflow.agentSessionRuntimeState.values.running.id as string,
} as const;

const agentSessionRuntimeStatesById = invertRecord(agentSessionRuntimeStateIds);

const agentSessionEventTypeIds = {
  "codex-notification": workflow.agentSessionEventType.values["codex-notification"].id as string,
  "raw-line": workflow.agentSessionEventType.values["raw-line"].id as string,
  session: workflow.agentSessionEventType.values.session.id as string,
  status: workflow.agentSessionEventType.values.status.id as string,
} as const;

const agentSessionEventPhasesById = invertRecord({
  completed: workflow.agentSessionEventPhase.values.completed.id as string,
  failed: workflow.agentSessionEventPhase.values.failed.id as string,
  scheduled: workflow.agentSessionEventPhase.values.scheduled.id as string,
  started: workflow.agentSessionEventPhase.values.started.id as string,
  stopped: workflow.agentSessionEventPhase.values.stopped.id as string,
} as const);

const agentSessionStatusCodesById = invertRecord({
  "agent-message-completed": workflow.agentSessionStatusCode.values["agent-message-completed"]
    .id as string,
  "agent-message-delta": workflow.agentSessionStatusCode.values["agent-message-delta"].id as string,
  "approval-required": workflow.agentSessionStatusCode.values["approval-required"].id as string,
  command: workflow.agentSessionStatusCode.values.command.id as string,
  "command-failed": workflow.agentSessionStatusCode.values["command-failed"].id as string,
  "command-output": workflow.agentSessionStatusCode.values["command-output"].id as string,
  error: workflow.agentSessionStatusCode.values.error.id as string,
  idle: workflow.agentSessionStatusCode.values.idle.id as string,
  "issue-assigned": workflow.agentSessionStatusCode.values["issue-assigned"].id as string,
  "issue-blocked": workflow.agentSessionStatusCode.values["issue-blocked"].id as string,
  "issue-committed": workflow.agentSessionStatusCode.values["issue-committed"].id as string,
  ready: workflow.agentSessionStatusCode.values.ready.id as string,
  "thread-started": workflow.agentSessionStatusCode.values["thread-started"].id as string,
  tool: workflow.agentSessionStatusCode.values.tool.id as string,
  "tool-failed": workflow.agentSessionStatusCode.values["tool-failed"].id as string,
  "turn-cancelled": workflow.agentSessionStatusCode.values["turn-cancelled"].id as string,
  "turn-completed": workflow.agentSessionStatusCode.values["turn-completed"].id as string,
  "turn-failed": workflow.agentSessionStatusCode.values["turn-failed"].id as string,
  "turn-started": workflow.agentSessionStatusCode.values["turn-started"].id as string,
  "waiting-on-user-input": workflow.agentSessionStatusCode.values["waiting-on-user-input"]
    .id as string,
  "workflow-diagnostic": workflow.agentSessionStatusCode.values["workflow-diagnostic"].id as string,
  "branch-blocked": workflow.agentSessionStatusCode.values["branch-blocked"].id as string,
  "branch-selected": workflow.agentSessionStatusCode.values["branch-selected"].id as string,
  "commit-blocked": workflow.agentSessionStatusCode.values["commit-blocked"].id as string,
  "commit-created": workflow.agentSessionStatusCode.values["commit-created"].id as string,
  "commit-finalized": workflow.agentSessionStatusCode.values["commit-finalized"].id as string,
  "commit-selected": workflow.agentSessionStatusCode.values["commit-selected"].id as string,
} as const);

const agentSessionStatusFormatIds = {
  chunk: workflow.agentSessionStatusFormat.values.chunk.id as string,
  close: workflow.agentSessionStatusFormat.values.close.id as string,
  line: workflow.agentSessionStatusFormat.values.line.id as string,
} as const;

const agentSessionStatusFormatsById = invertRecord(agentSessionStatusFormatIds);

const agentSessionStreamIds = {
  stderr: workflow.agentSessionStream.values.stderr.id as string,
  stdout: workflow.agentSessionStream.values.stdout.id as string,
} as const;

const agentSessionStreamsById = invertRecord(agentSessionStreamIds);

const agentSessionRawLineEncodingIds = {
  jsonl: workflow.agentSessionRawLineEncoding.values.jsonl.id as string,
  text: workflow.agentSessionRawLineEncoding.values.text.id as string,
} as const;

const agentSessionRawLineEncodingsById = invertRecord(agentSessionRawLineEncodingIds);

function invertRecord<TValue extends string>(
  value: Record<TValue, string>,
): Record<string, TValue> {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [entry, key])) as Record<
    string,
    TValue
  >;
}

function requireAgentSessionRuntimeState(value: string): GraphAgentSessionRuntimeState {
  const runtimeState = agentSessionRuntimeStatesById[value];
  if (!runtimeState) {
    throw new Error(`Unknown agent session runtime state id "${value}".`);
  }
  return runtimeState;
}

function asSubjectMissingFailure(error: unknown): AgentSessionAppendFailure | undefined {
  if (!(error instanceof WorkflowMutationError) || error.code !== "subject-not-found") {
    return undefined;
  }
  return {
    ok: false,
    code: "subject-missing",
    message: error.message,
  };
}

function isAppendFailure(
  value: ResolvedAppendSubject | AgentSessionAppendFailure,
): value is AgentSessionAppendFailure {
  return "ok" in value;
}

function parseJsonRecord(value: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must decode to a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function requireRequiredDate(value: string, label: string): Date {
  const parsed = parseOptionalDate(value, label);
  if (!parsed) {
    throw new WorkflowMutationError(400, `${label} must be a valid ISO timestamp.`);
  }
  return parsed;
}

function findSessionByProjectAndKey(
  graph: ProductGraphClient,
  projectId: string,
  sessionKey: string,
) {
  return graph.agentSession
    .list()
    .find((session) => session.project === projectId && session.sessionKey === sessionKey);
}

function resolveCreateSubjectContext(
  graph: ProductGraphClient,
  store: GraphStore,
  input: AgentSessionAppendSessionCreate,
): ResolvedAppendSubject | AgentSessionAppendFailure {
  requireProject(graph, store, input.projectId);

  if (input.repositoryId) {
    const repository = requireRepository(graph, store, input.repositoryId);
    if (repository.project !== input.projectId) {
      throw new WorkflowMutationError(
        409,
        `Workflow repository "${input.repositoryId}" does not belong to project "${input.projectId}".`,
        "invalid-transition",
      );
    }
  }

  let branch: ReturnType<ProductGraphClient["branch"]["get"]>;
  try {
    branch = requireBranch(graph, store, input.subject.branchId);
  } catch (error) {
    const subjectMissing = asSubjectMissingFailure(error);
    if (subjectMissing) {
      return subjectMissing;
    }
    throw error;
  }
  if (branch.project !== input.projectId) {
    return {
      ok: false,
      code: "subject-missing",
      message: `Workflow branch "${input.subject.branchId}" does not belong to project "${input.projectId}".`,
    };
  }

  if (input.subject.kind === "branch") {
    return {
      branchId: branch.id,
    };
  }

  let commit: ReturnType<ProductGraphClient["commit"]["get"]>;
  try {
    commit = requireCommit(graph, store, input.subject.commitId);
  } catch (error) {
    const subjectMissing = asSubjectMissingFailure(error);
    if (subjectMissing) {
      return subjectMissing;
    }
    throw error;
  }
  if (commit.branch !== input.subject.branchId) {
    return {
      ok: false,
      code: "subject-missing",
      message: `Workflow commit "${input.subject.commitId}" does not belong to branch "${input.subject.branchId}".`,
    };
  }

  return {
    branchId: branch.id,
    commitId: commit.id,
  };
}

function mapRetainedRuntimeState(
  input: AgentSessionAppendSessionCreate["retainedSession"]["runtime"],
): GraphAgentSessionRuntimeState | undefined {
  switch (input?.state) {
    case "blocked":
      return "blocked";
    case "finalized":
    case "pending-finalization":
      return "completed";
    case "interrupted":
      return "cancelled";
    case "running":
      return "running";
    default:
      return undefined;
  }
}

function applyEventToRuntimeProjection(
  current: SessionRuntimeProjection,
  event: AgentSessionAppendEvent,
): SessionRuntimeProjection {
  const timestamp = requireRequiredDate(event.timestamp, "Agent session event timestamp");

  if (event.type === "session") {
    switch (event.phase) {
      case "scheduled":
      case "started":
        return {
          runtimeState: "running",
        };
      case "completed":
        return {
          endedAt: timestamp,
          runtimeState: "completed",
        };
      case "failed":
        return {
          endedAt: timestamp,
          runtimeState: "failed",
        };
      case "stopped":
        if (
          current.runtimeState === "cancelled" ||
          current.runtimeState === "completed" ||
          current.runtimeState === "failed"
        ) {
          return {
            endedAt: current.endedAt ?? timestamp,
            runtimeState: current.runtimeState,
          };
        }
        return {
          endedAt: timestamp,
          runtimeState: "completed",
        };
    }
  }

  if (event.type !== "status") {
    return current;
  }

  switch (event.code) {
    case "waiting-on-user-input":
      return {
        runtimeState: "awaiting-user-input",
      };
    case "issue-blocked":
    case "branch-blocked":
    case "commit-blocked":
      return {
        runtimeState: "blocked",
      };
    case "turn-completed":
      return {
        endedAt: timestamp,
        runtimeState: "completed",
      };
    case "turn-cancelled":
      return {
        endedAt: timestamp,
        runtimeState: "cancelled",
      };
    case "turn-failed":
      return {
        endedAt: timestamp,
        runtimeState: "failed",
      };
    default:
      return current;
  }
}

function projectSessionRuntime(
  current: SessionRuntimeProjection,
  acceptedEvents: readonly AgentSessionAppendEvent[],
): SessionRuntimeProjection {
  let projected = current;
  for (const event of acceptedEvents) {
    projected = applyEventToRuntimeProjection(projected, event);
  }
  return projected;
}

function buildSessionName(input: AgentSessionAppendSessionCreate): string {
  return trimOptionalString(input.title) ?? "Workflow session";
}

function createSessionValues(
  input: AgentSessionAppendSessionCreate,
  subject: ResolvedAppendSubject,
  projection: SessionRuntimeProjection,
  startedAt: string,
): AgentSessionCreateValues {
  return {
    name: buildSessionName(input),
    project: input.projectId,
    ...(input.repositoryId ? { repository: input.repositoryId } : {}),
    subjectKind: agentSessionSubjectKindIds[input.subject.kind],
    branch: subject.branchId,
    ...(subject.commitId ? { commit: subject.commitId } : {}),
    sessionKey: input.sessionKey,
    kind: agentSessionKindIds[input.kind],
    workerId: input.workerId,
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    runtimeState: agentSessionRuntimeStateIds[projection.runtimeState],
    startedAt: requireRequiredDate(startedAt, "Agent session startedAt"),
    ...(projection.endedAt ? { endedAt: projection.endedAt } : {}),
  };
}

function validateExistingCreateSession(
  existingSession: ReturnType<ProductGraphClient["agentSession"]["get"]>,
  input: AgentSessionAppendSessionCreate,
): void {
  const expectedKind = agentSessionKindIds[input.kind];
  const expectedSubjectKind = agentSessionSubjectKindIds[input.subject.kind];
  if (existingSession.subjectKind !== expectedSubjectKind) {
    throw new WorkflowMutationError(
      409,
      `Workflow session key "${input.sessionKey}" already belongs to a different subject kind.`,
      "invalid-transition",
    );
  }

  if (existingSession.kind !== expectedKind) {
    throw new WorkflowMutationError(
      409,
      `Workflow session key "${input.sessionKey}" already belongs to a different session kind.`,
      "invalid-transition",
    );
  }

  if (existingSession.repository !== input.repositoryId) {
    throw new WorkflowMutationError(
      409,
      `Workflow session key "${input.sessionKey}" already belongs to a different repository.`,
      "invalid-transition",
    );
  }

  if (existingSession.branch !== input.subject.branchId) {
    throw new WorkflowMutationError(
      409,
      `Workflow session key "${input.sessionKey}" already belongs to a different branch.`,
      "invalid-transition",
    );
  }

  if (input.subject.kind === "commit" && existingSession.commit !== input.subject.commitId) {
    throw new WorkflowMutationError(
      409,
      `Workflow session key "${input.sessionKey}" already belongs to a different commit.`,
      "invalid-transition",
    );
  }
}

function buildSessionUpdateValues(
  input: AgentSessionAppendSessionCreate,
  projection: SessionRuntimeProjection,
  current: ReturnType<ProductGraphClient["agentSession"]["get"]>,
) {
  const updates: Record<string, unknown> = {};
  const title = buildSessionName(input);

  if (current.name !== title) {
    updates.name = title;
  }
  if (input.threadId && current.threadId !== input.threadId) {
    updates.threadId = input.threadId;
  }
  if (input.turnId && current.turnId !== input.turnId) {
    updates.turnId = input.turnId;
  }
  const runtimeStateId = agentSessionRuntimeStateIds[projection.runtimeState];
  if (current.runtimeState !== runtimeStateId) {
    updates.runtimeState = runtimeStateId;
  }
  if (projection.endedAt && current.endedAt?.toISOString() !== projection.endedAt.toISOString()) {
    updates.endedAt = projection.endedAt;
  }
  return updates;
}

function buildAgentSessionEventName(event: AgentSessionAppendEvent): string {
  switch (event.type) {
    case "session":
      return `Session ${event.phase}`;
    case "status":
      return trimOptionalString(event.text) ?? `Status ${event.code}`;
    case "raw-line":
      return `${event.stream} line ${event.sequence}`;
    case "codex-notification":
      return trimOptionalString(event.method) ?? `Notification ${event.sequence}`;
  }
}

function createAgentSessionEventValues(
  sessionId: string,
  event: AgentSessionAppendEvent,
): AgentSessionEventCreateValues {
  const baseValues = {
    name: buildAgentSessionEventName(event),
    session: sessionId,
    type: agentSessionEventTypeIds[event.type],
    sequence: event.sequence,
    timestamp: requireRequiredDate(event.timestamp, "Agent session event timestamp"),
  };
  switch (event.type) {
    case "session":
      return {
        ...baseValues,
        phase: workflow.agentSessionEventPhase.values[event.phase].id as string,
        ...(event.data !== undefined ? { data: JSON.stringify(event.data) } : {}),
      } as AgentSessionEventCreateValues;
    case "status":
      return {
        ...baseValues,
        statusCode: workflow.agentSessionStatusCode.values[event.code].id as string,
        format: agentSessionStatusFormatIds[event.format],
        ...(event.itemId !== undefined ? { itemId: event.itemId } : {}),
        ...(event.text !== undefined ? { text: event.text } : {}),
        ...(event.data !== undefined ? { data: JSON.stringify(event.data) } : {}),
      } as AgentSessionEventCreateValues;
    case "raw-line":
      return {
        ...baseValues,
        stream: agentSessionStreamIds[event.stream],
        encoding: agentSessionRawLineEncodingIds[event.encoding],
        line: event.line,
      } as AgentSessionEventCreateValues;
    case "codex-notification":
      return {
        ...baseValues,
        method: event.method,
        params: JSON.stringify(event.params),
      } as AgentSessionEventCreateValues;
  }
}

function hydratePersistedAppendEvent(
  entity: ReturnType<ProductGraphClient["agentSessionEvent"]["get"]>,
): AgentSessionAppendEvent {
  const type =
    agentSessionEventTypeIds.session === entity.type
      ? "session"
      : agentSessionEventTypeIds.status === entity.type
        ? "status"
        : agentSessionEventTypeIds["raw-line"] === entity.type
          ? "raw-line"
          : "codex-notification";
  const timestamp = entity.timestamp.toISOString();

  switch (type) {
    case "session": {
      const phase = entity.phase ? agentSessionEventPhasesById[entity.phase] : undefined;
      if (!phase) {
        throw new Error(`Persisted session event "${entity.id}" is missing its phase.`);
      }
      return {
        type,
        phase,
        sequence: entity.sequence,
        timestamp,
        ...(entity.data !== undefined
          ? { data: parseJsonRecord(entity.data, "Session event data") }
          : {}),
      };
    }
    case "status": {
      const code = entity.statusCode ? agentSessionStatusCodesById[entity.statusCode] : undefined;
      const format = entity.format ? agentSessionStatusFormatsById[entity.format] : undefined;
      if (!code || !format) {
        throw new Error(`Persisted status event "${entity.id}" is missing status metadata.`);
      }
      return {
        type,
        code,
        format,
        sequence: entity.sequence,
        timestamp,
        ...(entity.itemId ? { itemId: entity.itemId } : {}),
        ...(entity.text ? { text: entity.text } : {}),
        ...(entity.data !== undefined
          ? { data: parseJsonRecord(entity.data, "Status event data") }
          : {}),
      };
    }
    case "raw-line": {
      const stream = entity.stream ? agentSessionStreamsById[entity.stream] : undefined;
      const encoding = entity.encoding
        ? agentSessionRawLineEncodingsById[entity.encoding]
        : undefined;
      if (!stream || !encoding || entity.line === undefined) {
        throw new Error(`Persisted raw-line event "${entity.id}" is missing line metadata.`);
      }
      return {
        type,
        encoding,
        line: entity.line,
        sequence: entity.sequence,
        stream,
        timestamp,
      };
    }
    case "codex-notification":
      if (!entity.method || entity.params === undefined) {
        throw new Error(
          `Persisted codex-notification event "${entity.id}" is missing notification metadata.`,
        );
      }
      return {
        type,
        method: entity.method,
        params: parseJsonRecord(entity.params, "Notification params"),
        sequence: entity.sequence,
        timestamp,
      };
  }
}

function buildPersistedEventFingerprints(
  graph: ProductGraphClient,
  sessionId: string,
): {
  readonly nextExpectedSequence: number;
  readonly persistedEventFingerprints: ReadonlyMap<number, string>;
} {
  const eventEntities = graph.agentSessionEvent
    .list()
    .filter((entity) => entity.session === sessionId)
    .sort((left, right) => left.sequence - right.sequence);
  const persisted = new Map<number, string>();
  let nextExpectedSequence = 1;

  for (const eventEntity of eventEntities) {
    const appendEvent = hydratePersistedAppendEvent(graph.agentSessionEvent.get(eventEntity.id));
    persisted.set(eventEntity.sequence, createAgentSessionAppendEventFingerprint(appendEvent));
    nextExpectedSequence = Math.max(nextExpectedSequence, eventEntity.sequence + 1);
  }

  return {
    nextExpectedSequence,
    persistedEventFingerprints: persisted,
  };
}

function materializeAgentSessionAppend(
  graph: ProductGraphClient,
  store: GraphStore,
  input: AgentSessionAppendRequest,
): AgentSessionAppendResult {
  let sessionId: string;
  let sessionEntity: ReturnType<ProductGraphClient["agentSession"]["get"]> | undefined;
  let createInput: AgentSessionAppendSessionCreate | undefined;

  if (input.session.mode === "existing") {
    const existingSessionId = input.session.sessionId;
    sessionEntity = graph.agentSession.list().find((session) => session.id === existingSessionId);
    if (!sessionEntity) {
      throw new WorkflowMutationError(
        404,
        `Workflow session "${existingSessionId}" was not found.`,
        "subject-not-found",
      );
    }
    sessionId = sessionEntity.id;
  } else {
    createInput = input.session;
    const subject = resolveCreateSubjectContext(graph, store, input.session);
    if (isAppendFailure(subject)) {
      return subject;
    }
    sessionEntity = findSessionByProjectAndKey(
      graph,
      input.session.projectId,
      input.session.sessionKey,
    );
    if (sessionEntity) {
      validateExistingCreateSession(sessionEntity, input.session);
      sessionId = sessionEntity.id;
    } else {
      sessionId = "__pending-session__";
    }
  }

  const persistedState =
    sessionId === "__pending-session__"
      ? {
          nextExpectedSequence: 1,
          persistedEventFingerprints: new Map<number, string>(),
        }
      : buildPersistedEventFingerprints(graph, sessionId);

  const evaluated = evaluateAgentSessionAppendRequest({
    maxEventBytes: maxAgentSessionEventBytes,
    nextExpectedSequence: persistedState.nextExpectedSequence,
    persistedEventFingerprints: persistedState.persistedEventFingerprints,
    request: input,
    session: {
      sessionId,
      status: createInput && sessionId === "__pending-session__" ? "created" : "existing",
    },
  });
  if (!evaluated.ok) {
    return evaluated;
  }

  const acceptedEvents = input.events.filter(
    (_, index) => evaluated.events[index]?.status === "accepted",
  );
  let projectedRuntime: SessionRuntimeProjection = {
    runtimeState:
      sessionEntity?.runtimeState !== undefined
        ? requireAgentSessionRuntimeState(sessionEntity.runtimeState)
        : (mapRetainedRuntimeState(createInput?.retainedSession.runtime) ?? "running"),
    ...(sessionEntity?.endedAt ? { endedAt: sessionEntity.endedAt } : {}),
  };
  projectedRuntime = projectSessionRuntime(projectedRuntime, acceptedEvents);

  if (createInput) {
    const subject = resolveCreateSubjectContext(graph, store, createInput);
    if (isAppendFailure(subject)) {
      return subject;
    }

    if (!sessionEntity) {
      sessionId = graph.agentSession.create(
        createSessionValues(
          createInput,
          subject,
          projectedRuntime,
          createInput.startedAt ?? input.events[0]?.timestamp ?? new Date().toISOString(),
        ),
      );
      sessionEntity = graph.agentSession.get(sessionId);
    } else {
      const sessionUpdateValues = buildSessionUpdateValues(
        createInput,
        projectedRuntime,
        sessionEntity,
      );
      if (Object.keys(sessionUpdateValues).length > 0) {
        graph.agentSession.update(sessionEntity.id, sessionUpdateValues);
        sessionEntity = graph.agentSession.get(sessionEntity.id);
      }
      sessionId = sessionEntity.id;
    }
  } else if (sessionEntity) {
    const currentRuntimeState = requireAgentSessionRuntimeState(sessionEntity.runtimeState);
    const runtimeStateId = agentSessionRuntimeStateIds[projectedRuntime.runtimeState];
    const updates: Record<string, unknown> = {};
    if (currentRuntimeState !== projectedRuntime.runtimeState) {
      updates.runtimeState = runtimeStateId;
    }
    if (
      projectedRuntime.endedAt &&
      sessionEntity.endedAt?.toISOString() !== projectedRuntime.endedAt.toISOString()
    ) {
      updates.endedAt = projectedRuntime.endedAt;
    }
    if (Object.keys(updates).length > 0) {
      graph.agentSession.update(sessionEntity.id, updates);
    }
  }

  for (const [index, event] of input.events.entries()) {
    if (evaluated.events[index]?.status !== "accepted") {
      continue;
    }
    graph.agentSessionEvent.create(createAgentSessionEventValues(sessionId, event));
  }

  return {
    ...evaluated,
    session: {
      sessionId,
      status: evaluated.session.status,
    },
  } satisfies AgentSessionAppendSuccess;
}

export async function runAgentSessionAppendCommand(
  input: AgentSessionAppendRequest,
  authority: AgentSessionAppendAuthority,
  options: WebAppAuthorityCommandOptions,
): Promise<AgentSessionAppendResult> {
  const planned = planWorkflowMutation(
    authority.store.snapshot(),
    `agent-session-append:${Date.now()}`,
    (graph, store) => materializeAgentSessionAppend(graph, store, input),
  );

  if (!planned.changed) {
    return planned.result;
  }

  await authority.applyTransaction(planned.transaction, {
    authorization: options.authorization,
    writeScope: "server-command",
  });
  return planned.result;
}
