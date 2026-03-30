import { type GraphStore } from "@io/app/graph";
import {
  type AgentSessionAppendEvent,
  type CommitQueueScopeSessionKind,
  type CommitQueueScopeSessionRuntimeState,
  type CommitQueueScopeSessionSummary,
  type ProjectBranchScopeRepositoryObservation,
  type RepositoryBranchSummary,
  type RepositoryCommitSummary,
  type WorkflowBranchSummary,
  type WorkflowCommitSummary,
  type WorkflowProjectSummary,
  type WorkflowRepositorySummary,
  workflow,
} from "@io/graph-module-workflow";

import type {
  WorkflowSessionFeedFinalizationState,
  WorkflowSessionFeedHistoryState,
  WorkflowSessionFeedReadQuery,
  WorkflowSessionFeedReadResult,
  WorkflowSessionFeedReadyResult,
} from "./workflow-session-feed-contract.js";
import { buildWorkflowArtifactRecord } from "./workflow-artifact.js";
import { requireBranch, requireProject } from "./workflow-authority-shared.js";
import { buildWorkflowDecisionRecord } from "./workflow-decision.js";
import { type ProductGraphClient } from "./workflow-mutation-helpers.js";
import { hydratePersistedAppendEvent } from "./workflow-session-history.js";

const workflowBranchStateKeysById = invertRecord({
  active: workflow.branchState.values.active.id as string,
  archived: workflow.branchState.values.archived.id as string,
  backlog: workflow.branchState.values.backlog.id as string,
  blocked: workflow.branchState.values.blocked.id as string,
  done: workflow.branchState.values.done.id as string,
  ready: workflow.branchState.values.ready.id as string,
} as const);

const workflowCommitStateKeysById = invertRecord({
  active: workflow.commitState.values.active.id as string,
  blocked: workflow.commitState.values.blocked.id as string,
  committed: workflow.commitState.values.committed.id as string,
  dropped: workflow.commitState.values.dropped.id as string,
  planned: workflow.commitState.values.planned.id as string,
  ready: workflow.commitState.values.ready.id as string,
} as const);

const repositoryCommitStateKeysById = invertRecord({
  attached: workflow.repositoryCommitState.values.attached.id as string,
  committed: workflow.repositoryCommitState.values.committed.id as string,
  observed: workflow.repositoryCommitState.values.observed.id as string,
  planned: workflow.repositoryCommitState.values.planned.id as string,
  reserved: workflow.repositoryCommitState.values.reserved.id as string,
} as const);

const repositoryCommitLeaseStateKeysById = invertRecord({
  attached: workflow.repositoryCommitLeaseState.values.attached.id as string,
  released: workflow.repositoryCommitLeaseState.values.released.id as string,
  reserved: workflow.repositoryCommitLeaseState.values.reserved.id as string,
  unassigned: workflow.repositoryCommitLeaseState.values.unassigned.id as string,
} as const);

const agentSessionKindKeysById = invertRecord({
  execution: workflow.agentSessionKind.values.execution.id as string,
  planning: workflow.agentSessionKind.values.planning.id as string,
  review: workflow.agentSessionKind.values.review.id as string,
} as const);

const agentSessionRuntimeStateKeysById = invertRecord({
  "awaiting-user-input": workflow.agentSessionRuntimeState.values["awaiting-user-input"]
    .id as string,
  blocked: workflow.agentSessionRuntimeState.values.blocked.id as string,
  cancelled: workflow.agentSessionRuntimeState.values.cancelled.id as string,
  completed: workflow.agentSessionRuntimeState.values.completed.id as string,
  failed: workflow.agentSessionRuntimeState.values.failed.id as string,
  running: workflow.agentSessionRuntimeState.values.running.id as string,
} as const);

const agentSessionSubjectKindKeysById = invertRecord({
  branch: workflow.agentSessionSubjectKind.values.branch.id as string,
  commit: workflow.agentSessionSubjectKind.values.commit.id as string,
} as const);

type AgentSessionEntity = ReturnType<ProductGraphClient["agentSession"]["get"]>;

function invertRecord<TValue extends string>(
  value: Record<TValue, string>,
): Record<string, TValue> {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [entry, key])) as Record<
    string,
    TValue
  >;
}

function compareAscending(left: string, right: string): number {
  return left.localeCompare(right);
}

function compareOptionalString(left: string | undefined, right: string | undefined): number {
  return (left ?? "").localeCompare(right ?? "");
}

function compareSessions(left: AgentSessionEntity, right: AgentSessionEntity): number {
  return (
    compareAscending(right.startedAt.toISOString(), left.startedAt.toISOString()) ||
    compareOptionalString(right.endedAt?.toISOString(), left.endedAt?.toISOString()) ||
    compareAscending(left.id, right.id)
  );
}

function compareRepositoryBranches(
  left: ReturnType<ProductGraphClient["repositoryBranch"]["get"]>,
  right: ReturnType<ProductGraphClient["repositoryBranch"]["get"]>,
): number {
  return (
    compareOptionalString(
      right.latestReconciledAt?.toISOString(),
      left.latestReconciledAt?.toISOString(),
    ) ||
    compareAscending(right.updatedAt.toISOString(), left.updatedAt.toISOString()) ||
    compareAscending(left.id, right.id)
  );
}

function compareRepositoryCommits(
  left: ReturnType<ProductGraphClient["repositoryCommit"]["get"]>,
  right: ReturnType<ProductGraphClient["repositoryCommit"]["get"]>,
): number {
  return (
    compareOptionalString(right.committedAt?.toISOString(), left.committedAt?.toISOString()) ||
    compareAscending(right.updatedAt.toISOString(), left.updatedAt.toISOString()) ||
    compareAscending(left.id, right.id)
  );
}

function compareCreatedAscending(
  left: { readonly createdAt: string; readonly id: string },
  right: { readonly createdAt: string; readonly id: string },
): number {
  return compareAscending(left.createdAt, right.createdAt) || compareAscending(left.id, right.id);
}

function trimOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function decodeWorkflowBranchState(value: string): WorkflowBranchSummary["state"] {
  const state = workflowBranchStateKeysById[value];
  if (!state) {
    throw new Error(`Unknown workflow branch state id "${value}".`);
  }
  return state;
}

function decodeWorkflowCommitState(value: string): WorkflowCommitSummary["state"] {
  const state = workflowCommitStateKeysById[value];
  if (!state) {
    throw new Error(`Unknown workflow commit state id "${value}".`);
  }
  return state;
}

function decodeRepositoryCommitState(value: string): RepositoryCommitSummary["state"] {
  const state = repositoryCommitStateKeysById[value];
  if (!state) {
    throw new Error(`Unknown repository commit state id "${value}".`);
  }
  return state;
}

function decodeRepositoryCommitLeaseState(
  value: string,
): RepositoryCommitSummary["worktree"]["leaseState"] {
  const state = repositoryCommitLeaseStateKeysById[value];
  if (!state) {
    throw new Error(`Unknown repository commit lease state id "${value}".`);
  }
  return state;
}

function decodeAgentSessionKind(value: string): CommitQueueScopeSessionKind {
  const kind = agentSessionKindKeysById[value];
  if (!kind) {
    throw new Error(`Unknown agent session kind id "${value}".`);
  }
  return kind;
}

function decodeAgentSessionRuntimeState(value: string): CommitQueueScopeSessionRuntimeState {
  const runtimeState = agentSessionRuntimeStateKeysById[value];
  if (!runtimeState) {
    throw new Error(`Unknown agent session runtime state id "${value}".`);
  }
  return runtimeState;
}

function decodeAgentSessionSubjectKind(value: string): "branch" | "commit" {
  const subjectKind = agentSessionSubjectKindKeysById[value];
  if (!subjectKind) {
    throw new Error(`Unknown agent session subject kind id "${value}".`);
  }
  return subjectKind;
}

function buildWorkflowProjectSummary(
  entity: ReturnType<ProductGraphClient["project"]["get"]>,
): WorkflowProjectSummary {
  return {
    createdAt: entity.createdAt.toISOString(),
    entity: "project",
    id: entity.id,
    inferred: entity.inferred,
    projectKey: entity.projectKey,
    title: entity.name,
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function buildWorkflowRepositorySummary(
  entity: ReturnType<ProductGraphClient["repository"]["get"]>,
): WorkflowRepositorySummary {
  return {
    createdAt: entity.createdAt.toISOString(),
    defaultBaseBranch: entity.defaultBaseBranch,
    entity: "repository",
    id: entity.id,
    ...(entity.mainRemoteName ? { mainRemoteName: entity.mainRemoteName } : {}),
    projectId: entity.project,
    repoRoot: entity.repoRoot,
    repositoryKey: entity.repositoryKey,
    title: entity.name,
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function buildWorkflowBranchSummary(
  entity: ReturnType<ProductGraphClient["branch"]["get"]>,
  graph: Pick<ProductGraphClient, "document">,
): WorkflowBranchSummary {
  const goalSummary = entity.goalDocument
    ? trimOptionalString(graph.document.get(entity.goalDocument).description)
    : undefined;

  return {
    createdAt: entity.createdAt.toISOString(),
    entity: "branch",
    id: entity.id,
    ...(entity.activeCommit ? { activeCommitId: entity.activeCommit } : {}),
    branchKey: entity.branchKey,
    ...(entity.contextDocument ? { contextDocumentId: entity.contextDocument } : {}),
    ...(entity.goalDocument ? { goalDocumentId: entity.goalDocument } : {}),
    projectId: entity.project,
    ...(entity.queueRank !== undefined ? { queueRank: entity.queueRank } : {}),
    ...(goalSummary ? { goalSummary } : {}),
    state: decodeWorkflowBranchState(entity.state),
    title: entity.name,
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function buildWorkflowCommitSummary(
  entity: ReturnType<ProductGraphClient["commit"]["get"]>,
): WorkflowCommitSummary {
  return {
    branchId: entity.branch,
    commitKey: entity.commitKey,
    createdAt: entity.createdAt.toISOString(),
    ...(entity.contextDocument ? { contextDocumentId: entity.contextDocument } : {}),
    entity: "commit",
    id: entity.id,
    order: entity.order,
    ...(entity.parentCommit ? { parentCommitId: entity.parentCommit } : {}),
    state: decodeWorkflowCommitState(entity.state),
    title: entity.name,
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function buildRepositoryBranchSummary(
  entity: ReturnType<ProductGraphClient["repositoryBranch"]["get"]>,
): RepositoryBranchSummary {
  return {
    baseBranchName: entity.baseBranchName,
    branchName: entity.branchName,
    createdAt: entity.createdAt.toISOString(),
    entity: "repository-branch",
    id: entity.id,
    ...(entity.headSha ? { headSha: entity.headSha } : {}),
    ...(entity.latestReconciledAt
      ? { latestReconciledAt: entity.latestReconciledAt.toISOString() }
      : {}),
    managed: entity.managed,
    projectId: entity.project,
    repositoryId: entity.repository,
    title: entity.name,
    ...(entity.upstreamName ? { upstreamName: entity.upstreamName } : {}),
    updatedAt: entity.updatedAt.toISOString(),
    ...(entity.branch ? { branchId: entity.branch } : {}),
    ...(entity.worktreePath ? { worktreePath: entity.worktreePath } : {}),
  };
}

function buildRepositoryCommitSummary(
  entity: ReturnType<ProductGraphClient["repositoryCommit"]["get"]>,
): RepositoryCommitSummary {
  return {
    committedAt: entity.committedAt?.toISOString(),
    createdAt: entity.createdAt.toISOString(),
    entity: "repository-commit",
    id: entity.id,
    ...(entity.commit ? { commitId: entity.commit } : {}),
    ...(entity.repositoryBranch ? { repositoryBranchId: entity.repositoryBranch } : {}),
    repositoryId: entity.repository,
    ...(entity.sha ? { sha: entity.sha } : {}),
    state: decodeRepositoryCommitState(entity.state),
    title: entity.name,
    updatedAt: entity.updatedAt.toISOString(),
    worktree: {
      ...(entity.worktree.branchName ? { branchName: entity.worktree.branchName } : {}),
      leaseState: decodeRepositoryCommitLeaseState(entity.worktree.leaseState),
      ...(entity.worktree.path ? { path: entity.worktree.path } : {}),
    },
  };
}

function buildCommitQueueScopeSessionSummary(
  entity: AgentSessionEntity,
): (CommitQueueScopeSessionSummary & { readonly branchId: string }) | undefined {
  const subjectKind = decodeAgentSessionSubjectKind(entity.subjectKind);
  if (subjectKind === "commit" && !entity.commit) {
    return undefined;
  }

  return {
    branchId: entity.branch,
    ...(entity.endedAt ? { endedAt: entity.endedAt.toISOString() } : {}),
    id: entity.id,
    kind: decodeAgentSessionKind(entity.kind),
    runtimeState: decodeAgentSessionRuntimeState(entity.runtimeState),
    sessionKey: entity.sessionKey,
    startedAt: entity.startedAt.toISOString(),
    subject:
      subjectKind === "commit"
        ? {
            commitId: entity.commit!,
            kind: "commit",
          }
        : {
            kind: "branch",
          },
  };
}

function stripBranchId(
  session: CommitQueueScopeSessionSummary & { readonly branchId: string },
): CommitQueueScopeSessionSummary {
  const { branchId: _branchId, ...summary } = session;
  return summary;
}

function resolveBranchLatestSession(
  graph: ProductGraphClient,
  branchId: string,
): CommitQueueScopeSessionSummary | undefined {
  const [latest] = graph.agentSession
    .list()
    .filter((session) => session.branch === branchId)
    .sort(compareSessions)
    .map(buildCommitQueueScopeSessionSummary)
    .filter((summary): summary is CommitQueueScopeSessionSummary & { readonly branchId: string } =>
      Boolean(summary),
    );

  return latest ? stripBranchId(latest) : undefined;
}

function matchesSelectedSubject(
  session: AgentSessionEntity,
  query: WorkflowSessionFeedReadQuery,
): boolean {
  if (session.project !== query.projectId || session.branch !== query.subject.branchId) {
    return false;
  }

  const subjectKind = decodeAgentSessionSubjectKind(session.subjectKind);
  if (query.subject.kind === "branch") {
    return subjectKind === "branch";
  }

  return subjectKind === "commit" && session.commit === query.subject.commitId;
}

function resolveSelectedSession(
  graph: ProductGraphClient,
  query: WorkflowSessionFeedReadQuery,
): AgentSessionEntity | undefined {
  const sessionSelection = query.session;
  if (sessionSelection.kind === "session-id") {
    return graph.agentSession.list().find((session) => session.id === sessionSelection.sessionId);
  }

  return graph.agentSession
    .list()
    .filter((session) => matchesSelectedSubject(session, query))
    .sort(compareSessions)[0];
}

function resolveManagedRepositoryObservation(
  graph: ProductGraphClient,
  branchId: string,
): ProjectBranchScopeRepositoryObservation | undefined {
  const [selected] = graph.repositoryBranch
    .list()
    .filter((repositoryBranch) => repositoryBranch.managed && repositoryBranch.branch === branchId)
    .sort(compareRepositoryBranches);

  if (!selected) {
    return undefined;
  }

  return {
    freshness: selected.latestReconciledAt ? "fresh" : "stale",
    repositoryBranch: buildRepositoryBranchSummary(selected),
  };
}

function resolveRepositorySummary(
  graph: ProductGraphClient,
  query: WorkflowSessionFeedReadQuery,
  session: AgentSessionEntity,
  repositoryBranch: ProjectBranchScopeRepositoryObservation | undefined,
): WorkflowRepositorySummary | undefined {
  const repositoryId =
    session.repository ??
    repositoryBranch?.repositoryBranch.repositoryId ??
    graph.repository.list().find((repository) => repository.project === query.projectId)?.id;

  return repositoryId
    ? buildWorkflowRepositorySummary(graph.repository.get(repositoryId))
    : undefined;
}

function resolveRepositoryCommitSummary(
  graph: ProductGraphClient,
  commitId: string | undefined,
  repositoryId: string | undefined,
): RepositoryCommitSummary | undefined {
  if (!commitId) {
    return undefined;
  }

  const [selected] = graph.repositoryCommit
    .list()
    .filter(
      (repositoryCommit) =>
        repositoryCommit.commit === commitId &&
        (repositoryId === undefined || repositoryCommit.repository === repositoryId),
    )
    .sort(compareRepositoryCommits);

  return selected ? buildRepositoryCommitSummary(selected) : undefined;
}

function readPersistedSessionEvents(
  graph: ProductGraphClient,
  sessionId: string,
): {
  readonly events: readonly AgentSessionAppendEvent[];
  readonly lastPersistedSequence?: number;
  readonly transcriptTruncated: boolean;
} {
  const persistedEntities = graph.agentSessionEvent
    .list()
    .filter((event) => event.session === sessionId)
    .sort((left, right) => left.sequence - right.sequence);
  const events: AgentSessionAppendEvent[] = [];
  let lastPersistedSequence: number | undefined;
  let transcriptTruncated = false;

  for (const event of persistedEntities) {
    lastPersistedSequence = event.sequence;
    try {
      events.push(hydratePersistedAppendEvent(graph.agentSessionEvent.get(event.id)));
    } catch (error) {
      if (event.type === workflow.agentSessionEventType.values["raw-line"].id) {
        transcriptTruncated = true;
        continue;
      }
      throw error;
    }
  }

  return {
    events,
    ...(lastPersistedSequence !== undefined ? { lastPersistedSequence } : {}),
    transcriptTruncated,
  };
}

function buildHistoryState(input: {
  readonly events: WorkflowSessionFeedReadyResult["events"];
  readonly lastPersistedSequence?: number;
  readonly runtimeState: WorkflowSessionFeedReadyResult["runtime"]["state"];
  readonly transcriptTruncated?: boolean;
}): WorkflowSessionFeedHistoryState {
  if (input.transcriptTruncated) {
    return {
      ...(input.lastPersistedSequence !== undefined
        ? { lastSequence: input.lastPersistedSequence }
        : {}),
      persistedEventCount: input.events.length,
      reason: "transcript-truncated",
      status: "partial",
    };
  }

  const { events, runtimeState } = input;
  if (events.length === 0) {
    return {
      status: "empty",
    };
  }

  const persistedEventCount = events.length;
  const lastSequence = events[events.length - 1]!.sequence;
  let expectedSequence = 1;
  for (const event of events) {
    if (event.sequence !== expectedSequence) {
      return {
        lastSequence,
        persistedEventCount,
        reason: "event-gap",
        status: "partial",
      };
    }
    expectedSequence = event.sequence + 1;
  }

  if (runtimeState === "completed" || runtimeState === "failed" || runtimeState === "cancelled") {
    return {
      lastSequence,
      persistedEventCount,
      status: "complete",
    };
  }

  return {
    lastSequence,
    persistedEventCount,
    reason: "history-pending-append",
    status: "partial",
  };
}

function resolveFinalizationState(
  query: WorkflowSessionFeedReadQuery,
  events: WorkflowSessionFeedReadyResult["events"],
): WorkflowSessionFeedFinalizationState {
  if (query.subject.kind === "branch") {
    return {
      status: "not-applicable",
    };
  }

  let pendingCommitSeen = false;
  let pendingCommitSha: string | undefined;

  for (const event of events) {
    if (event.type === "status") {
      if (event.code === "issue-committed") {
        pendingCommitSeen = true;
        if (typeof event.data?.commitSha === "string") {
          pendingCommitSha = event.data.commitSha;
        }
      }
      if (event.code === "commit-finalized") {
        return {
          ...(typeof event.data?.commitSha === "string" ? { commitSha: event.data.commitSha } : {}),
          ...(typeof event.data?.finalizedAt === "string"
            ? { finalizedAt: event.data.finalizedAt }
            : {}),
          ...(typeof event.data?.landedAt === "string" ? { landedAt: event.data.landedAt } : {}),
          ...(typeof event.data?.linearState === "string"
            ? { linearState: event.data.linearState }
            : {}),
          status: "finalized",
        };
      }
      continue;
    }

    if (event.type !== "session" || event.phase !== "completed") {
      continue;
    }

    const commitSha =
      typeof event.data?.commitSha === "string" ? event.data.commitSha : pendingCommitSha;
    const finalizedAt =
      typeof event.data?.finalizedAt === "string" ? event.data.finalizedAt : undefined;
    const landedAt = typeof event.data?.landedAt === "string" ? event.data.landedAt : undefined;
    const linearState =
      typeof event.data?.linearState === "string" ? event.data.linearState : undefined;

    if (finalizedAt || landedAt || linearState) {
      return {
        ...(commitSha ? { commitSha } : {}),
        ...(finalizedAt ? { finalizedAt } : {}),
        ...(landedAt ? { landedAt } : {}),
        ...(linearState ? { linearState } : {}),
        status: "finalized",
      };
    }

    if (commitSha) {
      pendingCommitSeen = true;
      pendingCommitSha = commitSha;
    }
  }

  if (pendingCommitSeen) {
    return {
      status: "pending",
    };
  }

  return {
    reason: "graph-finalization-unavailable",
    status: "unknown",
  };
}

function buildReadyResult(
  graph: ProductGraphClient,
  query: WorkflowSessionFeedReadQuery,
  session: AgentSessionEntity,
): WorkflowSessionFeedReadyResult {
  const project = buildWorkflowProjectSummary(graph.project.get(query.projectId));
  const branch = buildWorkflowBranchSummary(graph.branch.get(query.subject.branchId), graph);
  const commitId = query.subject.kind === "commit" ? query.subject.commitId : undefined;
  const commit = commitId
    ? graph.commit
        .list()
        .find(
          (candidate) => candidate.id === commitId && candidate.branch === query.subject.branchId,
        )
    : undefined;
  const repositoryBranch = resolveManagedRepositoryObservation(graph, query.subject.branchId);
  const repository = resolveRepositorySummary(graph, query, session, repositoryBranch);
  const repositoryCommit = resolveRepositoryCommitSummary(graph, commitId, repository?.id);
  const persistedEvents = readPersistedSessionEvents(graph, session.id);
  const runtime = {
    ...(session.endedAt ? { endedAt: session.endedAt.toISOString() } : {}),
    startedAt: session.startedAt.toISOString(),
    state: decodeAgentSessionRuntimeState(session.runtimeState),
  } as const;

  return {
    artifacts: graph.artifact
      .list()
      .filter((artifact) => artifact.session === session.id)
      .map((artifact) => buildWorkflowArtifactRecord(graph.artifact.get(artifact.id)))
      .sort(compareCreatedAscending),
    decisions: graph.decision
      .list()
      .filter((decision) => decision.session === session.id)
      .map((decision) => buildWorkflowDecisionRecord(graph.decision.get(decision.id)))
      .sort(compareCreatedAscending),
    events: persistedEvents.events,
    finalization: resolveFinalizationState(query, persistedEvents.events),
    header: {
      id: session.id,
      kind: decodeAgentSessionKind(session.kind),
      sessionKey: session.sessionKey,
      title: session.name,
    },
    history: buildHistoryState({
      events: persistedEvents.events,
      ...(persistedEvents.lastPersistedSequence !== undefined
        ? { lastPersistedSequence: persistedEvents.lastPersistedSequence }
        : {}),
      runtimeState: runtime.state,
      transcriptTruncated: persistedEvents.transcriptTruncated,
    }),
    query,
    runtime,
    status: "ready",
    subject: {
      branch,
      ...(commit ? { commit: buildWorkflowCommitSummary(commit) } : {}),
      projectId: project.id,
      ...(repository ? { repository } : {}),
      ...(repositoryBranch ? { repositoryBranch } : {}),
      ...(repositoryCommit ? { repositoryCommit } : {}),
    },
  };
}

export function readWorkflowSessionFeed(
  graph: ProductGraphClient,
  store: GraphStore,
  query: WorkflowSessionFeedReadQuery,
): WorkflowSessionFeedReadResult {
  requireProject(graph, store, query.projectId);
  const branch = requireBranch(graph, store, query.subject.branchId);
  if (branch.project !== query.projectId) {
    throw new Error(
      `Workflow branch "${query.subject.branchId}" does not belong to project "${query.projectId}".`,
    );
  }

  const branchLatestSession = resolveBranchLatestSession(graph, query.subject.branchId);
  const selectedSession = resolveSelectedSession(graph, query);

  if (query.session.kind === "session-id") {
    const sessionSelection = {
      kind: "session-id" as const,
      sessionId: query.session.sessionId,
    };
    if (!selectedSession) {
      return {
        ...(branchLatestSession ? { branchLatestSession } : {}),
        query: {
          ...query,
          session: sessionSelection,
        },
        reason: "session-not-found",
        status: "stale-selection",
      };
    }

    if (selectedSession.branch !== query.subject.branchId) {
      return {
        ...(branchLatestSession ? { branchLatestSession } : {}),
        query: {
          ...query,
          session: sessionSelection,
        },
        reason: "session-branch-mismatch",
        status: "stale-selection",
      };
    }

    if (!matchesSelectedSubject(selectedSession, query)) {
      return {
        ...(branchLatestSession ? { branchLatestSession } : {}),
        query: {
          ...query,
          session: sessionSelection,
        },
        reason: "session-subject-mismatch",
        status: "stale-selection",
      };
    }
  }

  if (!selectedSession) {
    return {
      ...(branchLatestSession ? { branchLatestSession } : {}),
      query: {
        ...query,
        session: {
          kind: "latest-for-subject",
        },
      },
      status: "no-session",
    };
  }

  return buildReadyResult(graph, query, selectedSession);
}
