import {
  edgeId,
  type GraphWriteTransaction,
  type NamespaceClient,
  type Store,
  type StoreSnapshot,
} from "@io/core/graph";
import { core } from "@io/core/graph/modules";
import { ops } from "@io/core/graph/modules/ops";
import {
  type RepositoryCommitLeaseStateValue,
  type RepositoryCommitStateValue,
  repositoryCommitLeaseStateValues,
  repositoryCommitStateValues,
  type WorkflowBranchStateValue,
  workflowBranchStateValues,
  workflowCommitStateValues,
  type WorkflowCommitStateValue,
  type WorkflowMutationFailureCode,
  type WorkflowMutationSummary,
} from "@io/core/graph/modules/ops/workflow";
import { pkm } from "@io/core/graph/modules/pkm";

import { planRecordedMutation } from "./mutation-planning.js";

export const productGraph = { ...core, ...pkm, ...ops } as const;

export type ProductGraph = typeof productGraph;
export type ProductGraphClient = NamespaceClient<ProductGraph>;

const workflowBranchStateIds = Object.fromEntries(
  workflowBranchStateValues.map((value) => [
    value,
    resolvedEnumValue(ops.workflowBranchState.values[value]),
  ]),
) as Record<WorkflowBranchStateValue, string>;

const workflowCommitStateIds = Object.fromEntries(
  workflowCommitStateValues.map((value) => [
    value,
    resolvedEnumValue(ops.workflowCommitState.values[value]),
  ]),
) as Record<WorkflowCommitStateValue, string>;

const repositoryCommitStateIds = Object.fromEntries(
  repositoryCommitStateValues.map((value) => [
    value,
    resolvedEnumValue(ops.repositoryCommitState.values[value]),
  ]),
) as Record<RepositoryCommitStateValue, string>;

const repositoryCommitLeaseStateIds = Object.fromEntries(
  repositoryCommitLeaseStateValues.map((value) => [
    value,
    resolvedEnumValue(ops.repositoryCommitLeaseState.values[value]),
  ]),
) as Record<RepositoryCommitLeaseStateValue, string>;

const workflowBranchStateKeysById = invertRecord(workflowBranchStateIds);
const workflowCommitStateKeysById = invertRecord(workflowCommitStateIds);
const repositoryCommitStateKeysById = invertRecord(repositoryCommitStateIds);
const repositoryCommitLeaseStateKeysById = invertRecord(repositoryCommitLeaseStateIds);

export const workflowBranchTransitions: Record<
  WorkflowBranchStateValue,
  readonly WorkflowBranchStateValue[]
> = {
  backlog: ["ready", "active", "archived"],
  ready: ["backlog", "active", "blocked", "archived"],
  active: ["ready", "blocked", "done"],
  blocked: ["ready", "active", "archived"],
  done: ["archived"],
  archived: [],
};

export const workflowCommitTransitions: Record<
  WorkflowCommitStateValue,
  readonly WorkflowCommitStateValue[]
> = {
  planned: ["ready", "dropped"],
  ready: ["planned", "active", "blocked", "dropped"],
  active: ["ready", "blocked", "committed", "dropped"],
  blocked: ["ready", "active", "dropped"],
  committed: [],
  dropped: [],
};

export class WorkflowMutationError extends Error {
  readonly code?: WorkflowMutationFailureCode;
  readonly status: number;

  constructor(status: number, message: string, code?: WorkflowMutationFailureCode) {
    super(message);
    this.name = "WorkflowMutationError";
    this.status = status;
    this.code = code;
  }
}

function resolvedEnumValue(value: { key: string; id?: string }): string {
  return value.id ?? value.key;
}

function invertRecord<T extends string>(value: Record<T, string>): Record<string, T> {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [entry, key])) as Record<
    string,
    T
  >;
}

export function trimOptionalString(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function requireString(value: string | undefined | null, label: string): string {
  const trimmed = trimOptionalString(value);
  if (trimmed) return trimmed;
  throw new WorkflowMutationError(400, `${label} must be a non-empty string.`);
}

export function requireAllowedValue<TValue extends string>(
  value: string,
  allowed: readonly TValue[],
  label: string,
): TValue {
  if ((allowed as readonly string[]).includes(value)) {
    return value as TValue;
  }
  throw new WorkflowMutationError(400, `${label} must be one of: ${allowed.join(", ")}.`);
}

export function parseOptionalDate(
  value: string | undefined | null,
  label: string,
): Date | undefined | null {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = requireString(value, label);
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new WorkflowMutationError(400, `${label} must be a valid ISO timestamp.`);
  }
  return parsed;
}

export function hasEntityOfType(store: Store, entityId: string, typeId: string): boolean {
  return store.facts(entityId, edgeId(core.node.fields.type), typeId).length > 0;
}

export function clearSingleValue(store: Store, subjectId: string, predicateId: string): void {
  store.batch(() => {
    for (const edge of store.facts(subjectId, predicateId)) {
      store.retract(edge.id);
    }
  });
}

export function setSingleValue(
  store: Store,
  subjectId: string,
  predicateId: string,
  objectId: string,
): void {
  const current = store.facts(subjectId, predicateId);
  if (current.length === 1 && current[0]?.o === objectId) return;

  store.batch(() => {
    for (const edge of current) {
      store.retract(edge.id);
    }
    store.assert(subjectId, predicateId, objectId);
  });
}

export function planWorkflowMutation<TResult>(
  snapshot: StoreSnapshot,
  txId: string,
  mutate: (graph: ProductGraphClient, store: Store) => TResult,
): {
  readonly changed: boolean;
  readonly result: TResult;
  readonly transaction: GraphWriteTransaction;
} {
  return planRecordedMutation(snapshot, productGraph, txId, mutate);
}

export function decodeWorkflowBranchState(value: string): WorkflowBranchStateValue {
  const state = workflowBranchStateKeysById[value];
  if (!state) {
    throw new Error(`Unknown workflow branch state id "${value}".`);
  }
  return state;
}

export function decodeWorkflowCommitState(value: string): WorkflowCommitStateValue {
  const state = workflowCommitStateKeysById[value];
  if (!state) {
    throw new Error(`Unknown workflow commit state id "${value}".`);
  }
  return state;
}

export function decodeRepositoryCommitState(value: string): RepositoryCommitStateValue {
  const state = repositoryCommitStateKeysById[value];
  if (!state) {
    throw new Error(`Unknown repository commit state id "${value}".`);
  }
  return state;
}

export function decodeRepositoryCommitLeaseState(value: string): RepositoryCommitLeaseStateValue {
  const state = repositoryCommitLeaseStateKeysById[value];
  if (!state) {
    throw new Error(`Unknown repository commit lease state id "${value}".`);
  }
  return state;
}

export function isWorkflowCommitTerminal(state: WorkflowCommitStateValue): boolean {
  return state === "committed" || state === "dropped";
}

export function requireWorkflowTransition<TState extends string>(
  current: TState,
  next: TState,
  allowed: Record<TState, readonly TState[]>,
  label: string,
): void {
  if (current === next) return;
  if (allowed[current].includes(next)) return;
  throw new WorkflowMutationError(
    409,
    `${label} cannot transition from "${current}" to "${next}".`,
    "invalid-transition",
  );
}

function appendTimestampSummary<TSummary extends Record<string, unknown>>(
  entity: {
    readonly createdAt: Date;
    readonly updatedAt: Date;
  },
  summary: TSummary,
): TSummary & Pick<WorkflowMutationSummary, "createdAt" | "updatedAt"> {
  return {
    ...summary,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export function buildProjectSummary(
  entity: ReturnType<ProductGraphClient["workflowProject"]["get"]>,
) {
  return appendTimestampSummary(entity, {
    entity: "project",
    id: entity.id,
    title: entity.name,
    projectKey: entity.projectKey,
    inferred: entity.inferred,
  }) satisfies WorkflowMutationSummary;
}

export function buildRepositorySummary(
  entity: ReturnType<ProductGraphClient["workflowRepository"]["get"]>,
) {
  return appendTimestampSummary(entity, {
    entity: "repository",
    id: entity.id,
    title: entity.name,
    projectId: entity.project,
    repositoryKey: entity.repositoryKey,
    repoRoot: entity.repoRoot,
    defaultBaseBranch: entity.defaultBaseBranch,
    ...(entity.mainRemoteName ? { mainRemoteName: entity.mainRemoteName } : {}),
  }) satisfies WorkflowMutationSummary;
}

function readGoalSummary(
  graph: Pick<ProductGraphClient, "document">,
  goalDocumentId: string | undefined,
): string | undefined {
  if (!goalDocumentId) return undefined;
  return trimOptionalString(graph.document.get(goalDocumentId).description);
}

export function buildBranchSummary(
  graph: Pick<ProductGraphClient, "document">,
  entity: ReturnType<ProductGraphClient["workflowBranch"]["get"]>,
) {
  const goalSummary = readGoalSummary(graph, entity.goalDocument);
  return appendTimestampSummary(entity, {
    entity: "branch",
    id: entity.id,
    title: entity.name,
    projectId: entity.project,
    branchKey: entity.branchKey,
    state: decodeWorkflowBranchState(entity.state),
    ...(goalSummary ? { goalSummary } : {}),
    ...(entity.goalDocument ? { goalDocumentId: entity.goalDocument } : {}),
    ...(entity.contextDocument ? { contextDocumentId: entity.contextDocument } : {}),
    ...(entity.queueRank !== undefined ? { queueRank: entity.queueRank } : {}),
    ...(entity.activeCommit ? { activeCommitId: entity.activeCommit } : {}),
  }) satisfies WorkflowMutationSummary;
}

export function buildCommitSummary(
  entity: ReturnType<ProductGraphClient["workflowCommit"]["get"]>,
) {
  return appendTimestampSummary(entity, {
    entity: "commit",
    id: entity.id,
    title: entity.name,
    branchId: entity.branch,
    commitKey: entity.commitKey,
    state: decodeWorkflowCommitState(entity.state),
    order: entity.order,
    ...(entity.parentCommit ? { parentCommitId: entity.parentCommit } : {}),
    ...(entity.contextDocument ? { contextDocumentId: entity.contextDocument } : {}),
  }) satisfies WorkflowMutationSummary;
}

export function buildRepositoryBranchSummary(
  entity: ReturnType<ProductGraphClient["repositoryBranch"]["get"]>,
) {
  return appendTimestampSummary(entity, {
    entity: "repository-branch",
    id: entity.id,
    title: entity.name,
    projectId: entity.project,
    repositoryId: entity.repository,
    ...(entity.workflowBranch ? { workflowBranchId: entity.workflowBranch } : {}),
    managed: entity.managed,
    branchName: entity.branchName,
    baseBranchName: entity.baseBranchName,
    ...(entity.upstreamName ? { upstreamName: entity.upstreamName } : {}),
    ...(entity.headSha ? { headSha: entity.headSha } : {}),
    ...(entity.worktreePath ? { worktreePath: entity.worktreePath } : {}),
    ...(entity.latestReconciledAt
      ? { latestReconciledAt: entity.latestReconciledAt.toISOString() }
      : {}),
  }) satisfies WorkflowMutationSummary;
}

export function buildRepositoryCommitSummary(
  entity: ReturnType<ProductGraphClient["repositoryCommit"]["get"]>,
) {
  return appendTimestampSummary(entity, {
    entity: "repository-commit",
    id: entity.id,
    title: entity.name,
    repositoryId: entity.repository,
    ...(entity.repositoryBranch ? { repositoryBranchId: entity.repositoryBranch } : {}),
    ...(entity.workflowCommit ? { workflowCommitId: entity.workflowCommit } : {}),
    state: decodeRepositoryCommitState(entity.state),
    worktree: {
      ...(entity.worktree.path ? { path: entity.worktree.path } : {}),
      ...(entity.worktree.branchName ? { branchName: entity.worktree.branchName } : {}),
      leaseState: decodeRepositoryCommitLeaseState(entity.worktree.leaseState),
    },
    ...(entity.sha ? { sha: entity.sha } : {}),
    ...(entity.committedAt ? { committedAt: entity.committedAt.toISOString() } : {}),
  }) satisfies WorkflowMutationSummary;
}

export function normalizeRepositoryCommitLeaseState(
  state: RepositoryCommitStateValue,
  leaseState: RepositoryCommitLeaseStateValue | undefined,
): RepositoryCommitLeaseStateValue {
  if (leaseState) return leaseState;
  if (state === "reserved") return "reserved";
  if (state === "attached") return "attached";
  return "unassigned";
}

export {
  repositoryCommitLeaseStateIds,
  repositoryCommitStateIds,
  workflowBranchStateIds,
  workflowCommitStateIds,
};
