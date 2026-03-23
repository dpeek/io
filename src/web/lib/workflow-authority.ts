import {
  edgeId,
  type AuthoritativeGraphWriteResult,
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
  type WorkflowMutationAction,
  type WorkflowMutationFailureCode,
  type WorkflowMutationResult,
  type WorkflowMutationSummary,
} from "@io/core/graph/modules/ops/workflow";
import { pkm } from "@io/core/graph/modules/pkm";

import type {
  WebAppAuthorityCommandOptions,
  WebAppAuthorityTransactionOptions,
} from "./authority.js";
import { planRecordedMutation } from "./mutation-planning.js";

const productGraph = { ...core, ...pkm, ...ops } as const;

type ProductGraph = typeof productGraph;
type ProductGraphClient = NamespaceClient<ProductGraph>;

const typePredicateId = edgeId(core.node.fields.type);
const workflowProjectTypeId = ops.workflowProject.values.id as string;
const workflowRepositoryTypeId = ops.workflowRepository.values.id as string;
const workflowBranchTypeId = ops.workflowBranch.values.id as string;
const workflowCommitTypeId = ops.workflowCommit.values.id as string;
const repositoryBranchTypeId = ops.repositoryBranch.values.id as string;
const repositoryCommitTypeId = ops.repositoryCommit.values.id as string;

const inferredProjectLimitMessage =
  "Branch 6 v1 supports exactly one inferred workflow project per graph.";
const attachedRepositoryLimitMessage =
  "Branch 6 v1 supports exactly one attached workflow repository per graph.";

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

const workflowBranchTransitions: Record<
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

const workflowCommitTransitions: Record<
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

class WorkflowMutationError extends Error {
  readonly code?: WorkflowMutationFailureCode;
  readonly status: number;

  constructor(status: number, message: string, code?: WorkflowMutationFailureCode) {
    super(message);
    this.name = "WorkflowMutationError";
    this.status = status;
    this.code = code;
  }
}

type WorkflowMutationAuthority = {
  readonly store: Store;
  applyTransaction(
    transaction: GraphWriteTransaction,
    options: WebAppAuthorityTransactionOptions,
  ): Promise<AuthoritativeGraphWriteResult>;
};

export async function runWorkflowMutationCommand(
  input: WorkflowMutationAction,
  authority: WorkflowMutationAuthority,
  options: WebAppAuthorityCommandOptions,
): Promise<WorkflowMutationResult> {
  const planned = planWorkflowMutation(
    authority.store.snapshot(),
    `workflow-mutation:${input.action}:${Date.now()}`,
    (graph, store) => mutateWorkflow(graph, store, input),
  );

  if (!planned.changed) return planned.result;

  const write = await authority.applyTransaction(planned.transaction, {
    authorization: options.authorization,
    writeScope: "server-command",
  });
  planned.result.cursor = write.cursor;
  planned.result.replayed = write.replayed;
  return planned.result;
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

function trimOptionalString(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function requireString(value: string | undefined | null, label: string): string {
  const trimmed = trimOptionalString(value);
  if (trimmed) return trimmed;
  throw new WorkflowMutationError(400, `${label} must be a non-empty string.`);
}

function requireAllowedValue<TValue extends string>(
  value: string,
  allowed: readonly TValue[],
  label: string,
): TValue {
  if ((allowed as readonly string[]).includes(value)) {
    return value as TValue;
  }
  throw new WorkflowMutationError(400, `${label} must be one of: ${allowed.join(", ")}.`);
}

function parseOptionalDate(
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

function hasEntityOfType(store: Store, entityId: string, typeId: string): boolean {
  return store.facts(entityId, typePredicateId, typeId).length > 0;
}

function clearSingleValue(store: Store, subjectId: string, predicateId: string): void {
  store.batch(() => {
    for (const edge of store.facts(subjectId, predicateId)) {
      store.retract(edge.id);
    }
  });
}

function setSingleValue(
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

function planWorkflowMutation<TResult>(
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

function decodeWorkflowBranchState(value: string): WorkflowBranchStateValue {
  const state = workflowBranchStateKeysById[value];
  if (!state) {
    throw new Error(`Unknown workflow branch state id "${value}".`);
  }
  return state;
}

function decodeWorkflowCommitState(value: string): WorkflowCommitStateValue {
  const state = workflowCommitStateKeysById[value];
  if (!state) {
    throw new Error(`Unknown workflow commit state id "${value}".`);
  }
  return state;
}

function decodeRepositoryCommitState(value: string): RepositoryCommitStateValue {
  const state = repositoryCommitStateKeysById[value];
  if (!state) {
    throw new Error(`Unknown repository commit state id "${value}".`);
  }
  return state;
}

function decodeRepositoryCommitLeaseState(value: string): RepositoryCommitLeaseStateValue {
  const state = repositoryCommitLeaseStateKeysById[value];
  if (!state) {
    throw new Error(`Unknown repository commit lease state id "${value}".`);
  }
  return state;
}

function isWorkflowCommitTerminal(state: WorkflowCommitStateValue): boolean {
  return state === "committed" || state === "dropped";
}

function requireProject(graph: ProductGraphClient, store: Store, projectId: string) {
  if (!hasEntityOfType(store, projectId, workflowProjectTypeId)) {
    throw new WorkflowMutationError(
      404,
      `Workflow project "${projectId}" was not found.`,
      "subject-not-found",
    );
  }
  return graph.workflowProject.get(projectId);
}

function requireRepository(graph: ProductGraphClient, store: Store, repositoryId: string) {
  if (!hasEntityOfType(store, repositoryId, workflowRepositoryTypeId)) {
    throw new WorkflowMutationError(
      409,
      `Workflow repository "${repositoryId}" was not found.`,
      "repository-missing",
    );
  }
  return graph.workflowRepository.get(repositoryId);
}

function requireBranch(graph: ProductGraphClient, store: Store, branchId: string) {
  if (!hasEntityOfType(store, branchId, workflowBranchTypeId)) {
    throw new WorkflowMutationError(
      404,
      `Workflow branch "${branchId}" was not found.`,
      "subject-not-found",
    );
  }
  return graph.workflowBranch.get(branchId);
}

function requireCommit(graph: ProductGraphClient, store: Store, commitId: string) {
  if (!hasEntityOfType(store, commitId, workflowCommitTypeId)) {
    throw new WorkflowMutationError(
      404,
      `Workflow commit "${commitId}" was not found.`,
      "subject-not-found",
    );
  }
  return graph.workflowCommit.get(commitId);
}

function requireRepositoryBranch(
  graph: ProductGraphClient,
  store: Store,
  repositoryBranchId: string,
) {
  if (!hasEntityOfType(store, repositoryBranchId, repositoryBranchTypeId)) {
    throw new WorkflowMutationError(
      409,
      `Repository branch "${repositoryBranchId}" was not found.`,
      "repository-missing",
    );
  }
  return graph.repositoryBranch.get(repositoryBranchId);
}

function requireRepositoryCommit(
  graph: ProductGraphClient,
  store: Store,
  repositoryCommitId: string,
) {
  if (!hasEntityOfType(store, repositoryCommitId, repositoryCommitTypeId)) {
    throw new WorkflowMutationError(
      404,
      `Repository commit "${repositoryCommitId}" was not found.`,
      "subject-not-found",
    );
  }
  return graph.repositoryCommit.get(repositoryCommitId);
}

function requireUniqueProjectKey(
  graph: ProductGraphClient,
  projectKey: string,
  exceptProjectId?: string,
): void {
  const existing = graph.workflowProject
    .list()
    .find((project) => project.projectKey === projectKey && project.id !== exceptProjectId);
  if (existing) {
    throw new WorkflowMutationError(
      409,
      `Project key "${projectKey}" is already in use by "${existing.id}".`,
      "invalid-transition",
    );
  }
}

function requireUniqueRepositoryKey(
  graph: ProductGraphClient,
  repositoryKey: string,
  exceptRepositoryId?: string,
): void {
  const existing = graph.workflowRepository
    .list()
    .find(
      (repository) =>
        repository.repositoryKey === repositoryKey && repository.id !== exceptRepositoryId,
    );
  if (existing) {
    throw new WorkflowMutationError(
      409,
      `Repository key "${repositoryKey}" is already in use by "${existing.id}".`,
      "invalid-transition",
    );
  }
}

function requireUniqueBranchKey(
  graph: ProductGraphClient,
  branchKey: string,
  exceptBranchId?: string,
): void {
  const existing = graph.workflowBranch
    .list()
    .find((branch) => branch.branchKey === branchKey && branch.id !== exceptBranchId);
  if (existing) {
    throw new WorkflowMutationError(
      409,
      `Branch key "${branchKey}" is already in use by "${existing.id}".`,
      "invalid-transition",
    );
  }
}

function requireUniqueCommitKey(
  graph: ProductGraphClient,
  commitKey: string,
  exceptCommitId?: string,
): void {
  const existing = graph.workflowCommit
    .list()
    .find((commit) => commit.commitKey === commitKey && commit.id !== exceptCommitId);
  if (existing) {
    throw new WorkflowMutationError(
      409,
      `Commit key "${commitKey}" is already in use by "${existing.id}".`,
      "invalid-transition",
    );
  }
}

function requireSingleInferredProject(graph: ProductGraphClient, exceptProjectId?: string): void {
  const inferredProject = graph.workflowProject
    .list()
    .find((project) => project.inferred && project.id !== exceptProjectId);
  if (inferredProject) {
    throw new WorkflowMutationError(409, inferredProjectLimitMessage, "invalid-transition");
  }
}

function requireSingleAttachedRepository(
  graph: ProductGraphClient,
  exceptRepositoryId?: string,
): void {
  const attachedRepository = graph.workflowRepository
    .list()
    .find((repository) => repository.id !== exceptRepositoryId);
  if (attachedRepository) {
    throw new WorkflowMutationError(409, attachedRepositoryLimitMessage, "invalid-transition");
  }
}

function findManagedRepositoryBranchForBranch(graph: ProductGraphClient, branchId: string) {
  return graph.repositoryBranch
    .list()
    .find(
      (repositoryBranch) =>
        repositoryBranch.workflowBranch === branchId && repositoryBranch.managed,
    );
}

function findRepositoryCommitForWorkflowCommit(
  graph: ProductGraphClient,
  workflowCommitId: string,
  exceptRepositoryCommitId?: string,
) {
  return graph.repositoryCommit
    .list()
    .find(
      (repositoryCommit) =>
        repositoryCommit.workflowCommit === workflowCommitId &&
        repositoryCommit.id !== exceptRepositoryCommitId,
    );
}

function listBranchCommits(graph: ProductGraphClient, branchId: string) {
  return graph.workflowCommit.list().filter((commit) => commit.branch === branchId);
}

function deriveBranchStateAfterCommitLifecycle(
  graph: ProductGraphClient,
  branchId: string,
): WorkflowBranchStateValue {
  const commits = listBranchCommits(graph, branchId);
  if (commits.some((commit) => decodeWorkflowCommitState(commit.state) === "active")) {
    return "active";
  }
  if (commits.some((commit) => decodeWorkflowCommitState(commit.state) === "blocked")) {
    return "blocked";
  }
  return commits.length > 0 &&
    commits.every((commit) => isWorkflowCommitTerminal(decodeWorkflowCommitState(commit.state)))
    ? "done"
    : "ready";
}

function requireBranchRepositoryTarget(graph: ProductGraphClient, branchId: string) {
  const repositoryBranch = findManagedRepositoryBranchForBranch(graph, branchId);
  if (!repositoryBranch) {
    throw new WorkflowMutationError(
      409,
      `Workflow branch "${branchId}" does not have a managed repository branch target.`,
      "repository-missing",
    );
  }
  return repositoryBranch;
}

function requireWorkflowTransition<TState extends string>(
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

function buildProjectSummary(entity: ReturnType<ProductGraphClient["workflowProject"]["get"]>) {
  return {
    entity: "project",
    id: entity.id,
    title: entity.name,
    projectKey: entity.projectKey,
    inferred: entity.inferred,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  } satisfies WorkflowMutationSummary;
}

function buildRepositorySummary(
  entity: ReturnType<ProductGraphClient["workflowRepository"]["get"]>,
) {
  return {
    entity: "repository",
    id: entity.id,
    title: entity.name,
    projectId: entity.project,
    repositoryKey: entity.repositoryKey,
    repoRoot: entity.repoRoot,
    defaultBaseBranch: entity.defaultBaseBranch,
    ...(entity.mainRemoteName ? { mainRemoteName: entity.mainRemoteName } : {}),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  } satisfies WorkflowMutationSummary;
}

function buildBranchSummary(entity: ReturnType<ProductGraphClient["workflowBranch"]["get"]>) {
  return {
    entity: "branch",
    id: entity.id,
    title: entity.name,
    projectId: entity.project,
    branchKey: entity.branchKey,
    state: decodeWorkflowBranchState(entity.state),
    goalSummary: entity.goalSummary,
    ...(entity.goalDocumentPath ? { goalDocumentPath: entity.goalDocumentPath } : {}),
    ...(entity.queueRank !== undefined ? { queueRank: entity.queueRank } : {}),
    ...(entity.activeCommit ? { activeCommitId: entity.activeCommit } : {}),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  } satisfies WorkflowMutationSummary;
}

function buildCommitSummary(entity: ReturnType<ProductGraphClient["workflowCommit"]["get"]>) {
  return {
    entity: "commit",
    id: entity.id,
    title: entity.name,
    branchId: entity.branch,
    commitKey: entity.commitKey,
    state: decodeWorkflowCommitState(entity.state),
    order: entity.order,
    ...(entity.parentCommit ? { parentCommitId: entity.parentCommit } : {}),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  } satisfies WorkflowMutationSummary;
}

function buildRepositoryBranchSummary(
  entity: ReturnType<ProductGraphClient["repositoryBranch"]["get"]>,
) {
  return {
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
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  } satisfies WorkflowMutationSummary;
}

function buildRepositoryCommitSummary(
  entity: ReturnType<ProductGraphClient["repositoryCommit"]["get"]>,
) {
  return {
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
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  } satisfies WorkflowMutationSummary;
}

function normalizeRepositoryCommitLeaseState(
  state: RepositoryCommitStateValue,
  leaseState: RepositoryCommitLeaseStateValue | undefined,
): RepositoryCommitLeaseStateValue {
  if (leaseState) return leaseState;
  if (state === "reserved") return "reserved";
  if (state === "attached") return "attached";
  return "unassigned";
}

function reconcileBranchAfterCommitChange(
  graph: ProductGraphClient,
  store: Store,
  branchId: string,
  commitId: string,
): void {
  const branch = graph.workflowBranch.get(branchId);
  if (branch.activeCommit === commitId) {
    clearSingleValue(store, branchId, edgeId(ops.workflowBranch.fields.activeCommit));
  }
  const nextState = deriveBranchStateAfterCommitLifecycle(graph, branchId);
  graph.workflowBranch.update(branchId, {
    state: workflowBranchStateIds[nextState],
  });
}

function mutateWorkflow(
  graph: ProductGraphClient,
  store: Store,
  input: WorkflowMutationAction,
): WorkflowMutationResult {
  switch (input.action) {
    case "createProject": {
      const projectKey = requireString(input.projectKey, "Project key");
      const title = requireString(input.title, "Project title");
      const inferred = input.inferred ?? true;
      if (inferred) requireSingleInferredProject(graph);
      requireUniqueProjectKey(graph, projectKey);
      const projectId = graph.workflowProject.create({
        name: title,
        projectKey,
        inferred,
      });
      return {
        action: input.action,
        created: true,
        summary: buildProjectSummary(graph.workflowProject.get(projectId)),
      };
    }
    case "updateProject": {
      const project = requireProject(graph, store, requireString(input.projectId, "Project id"));
      const patch: Partial<typeof project> & Record<string, unknown> = {};
      if (input.title !== undefined) patch.name = input.title;
      if (input.projectKey !== undefined) {
        const projectKey = requireString(input.projectKey, "Project key");
        requireUniqueProjectKey(graph, projectKey, project.id);
        patch.projectKey = projectKey;
      }
      if (input.inferred !== undefined) {
        if (input.inferred) requireSingleInferredProject(graph, project.id);
        patch.inferred = input.inferred;
      }
      if (Object.keys(patch).length > 0) {
        graph.workflowProject.update(project.id, patch);
      }
      return {
        action: input.action,
        created: false,
        summary: buildProjectSummary(graph.workflowProject.get(project.id)),
      };
    }
    case "createRepository": {
      const project = requireProject(graph, store, requireString(input.projectId, "Project id"));
      requireSingleAttachedRepository(graph);
      const repositoryKey = requireString(input.repositoryKey, "Repository key");
      requireUniqueRepositoryKey(graph, repositoryKey);
      const repositoryId = graph.workflowRepository.create({
        name: requireString(input.title, "Repository title"),
        project: project.id,
        repositoryKey,
        repoRoot: requireString(input.repoRoot, "Repository root"),
        defaultBaseBranch: requireString(input.defaultBaseBranch, "Default base branch"),
        mainRemoteName: trimOptionalString(input.mainRemoteName),
      });
      return {
        action: input.action,
        created: true,
        summary: buildRepositorySummary(graph.workflowRepository.get(repositoryId)),
      };
    }
    case "updateRepository": {
      const repository = requireRepository(
        graph,
        store,
        requireString(input.repositoryId, "Repository id"),
      );
      const patch: Record<string, unknown> = {};
      if (input.title !== undefined) patch.name = input.title;
      if (input.repositoryKey !== undefined) {
        const repositoryKey = requireString(input.repositoryKey, "Repository key");
        requireUniqueRepositoryKey(graph, repositoryKey, repository.id);
        patch.repositoryKey = repositoryKey;
      }
      if (input.repoRoot !== undefined)
        patch.repoRoot = requireString(input.repoRoot, "Repository root");
      if (input.defaultBaseBranch !== undefined) {
        patch.defaultBaseBranch = requireString(input.defaultBaseBranch, "Default base branch");
      }
      if (input.mainRemoteName !== undefined) {
        if (input.mainRemoteName === null) {
          clearSingleValue(
            store,
            repository.id,
            edgeId(ops.workflowRepository.fields.mainRemoteName),
          );
        } else {
          patch.mainRemoteName = requireString(input.mainRemoteName, "Main remote name");
        }
      }
      if (Object.keys(patch).length > 0) {
        graph.workflowRepository.update(repository.id, patch);
      }
      return {
        action: input.action,
        created: false,
        summary: buildRepositorySummary(graph.workflowRepository.get(repository.id)),
      };
    }
    case "createBranch": {
      const project = requireProject(graph, store, requireString(input.projectId, "Project id"));
      const branchKey = requireString(input.branchKey, "Branch key");
      requireUniqueBranchKey(graph, branchKey);
      const requestedState =
        input.state === undefined
          ? "backlog"
          : requireAllowedValue(
              input.state,
              ["backlog", "ready"] as const,
              "Workflow branch state",
            );
      const branchId = graph.workflowBranch.create({
        name: requireString(input.title, "Branch title"),
        project: project.id,
        branchKey,
        state: workflowBranchStateIds[requestedState],
        goalSummary: requireString(input.goalSummary, "Goal summary"),
        goalDocumentPath: trimOptionalString(input.goalDocumentPath),
        ...(input.queueRank !== undefined && input.queueRank !== null
          ? { queueRank: input.queueRank }
          : {}),
      });
      return {
        action: input.action,
        created: true,
        summary: buildBranchSummary(graph.workflowBranch.get(branchId)),
      };
    }
    case "updateBranch": {
      const branch = requireBranch(graph, store, requireString(input.branchId, "Branch id"));
      const patch: Record<string, unknown> = {};
      if (input.title !== undefined) patch.name = input.title;
      if (input.branchKey !== undefined) {
        const branchKey = requireString(input.branchKey, "Branch key");
        requireUniqueBranchKey(graph, branchKey, branch.id);
        patch.branchKey = branchKey;
      }
      if (input.goalSummary !== undefined) {
        patch.goalSummary = requireString(input.goalSummary, "Goal summary");
      }
      if (input.goalDocumentPath !== undefined) {
        if (input.goalDocumentPath === null) {
          clearSingleValue(store, branch.id, edgeId(ops.workflowBranch.fields.goalDocumentPath));
        } else {
          patch.goalDocumentPath = requireString(input.goalDocumentPath, "Goal document path");
        }
      }
      if (input.queueRank !== undefined) {
        if (input.queueRank === null) {
          clearSingleValue(store, branch.id, edgeId(ops.workflowBranch.fields.queueRank));
        } else {
          patch.queueRank = input.queueRank;
        }
      }
      if (Object.keys(patch).length > 0) {
        graph.workflowBranch.update(branch.id, patch);
      }
      return {
        action: input.action,
        created: false,
        summary: buildBranchSummary(graph.workflowBranch.get(branch.id)),
      };
    }
    case "setBranchState": {
      const branch = requireBranch(graph, store, requireString(input.branchId, "Branch id"));
      const currentState = decodeWorkflowBranchState(branch.state);
      const targetState = requireAllowedValue(
        input.state,
        workflowBranchStateValues,
        "Workflow branch state",
      );
      requireWorkflowTransition(
        currentState,
        targetState,
        workflowBranchTransitions,
        "Workflow branch",
      );
      if (targetState === "active") {
        requireBranchRepositoryTarget(graph, branch.id);
      }
      if (targetState !== "active" && branch.activeCommit) {
        throw new WorkflowMutationError(
          409,
          `Workflow branch "${branch.id}" still has active commit "${branch.activeCommit}".`,
          "invalid-transition",
        );
      }
      if (targetState === "done") {
        const commits = listBranchCommits(graph, branch.id);
        if (
          !commits.every((commit) =>
            isWorkflowCommitTerminal(decodeWorkflowCommitState(commit.state)),
          )
        ) {
          throw new WorkflowMutationError(
            409,
            `Workflow branch "${branch.id}" cannot be marked done while it still has open commits.`,
            "invalid-transition",
          );
        }
      }
      graph.workflowBranch.update(branch.id, {
        state: workflowBranchStateIds[targetState],
      });
      return {
        action: input.action,
        created: false,
        summary: buildBranchSummary(graph.workflowBranch.get(branch.id)),
      };
    }
    case "attachBranchRepositoryTarget": {
      const branch = requireBranch(graph, store, requireString(input.branchId, "Branch id"));
      const repository = requireRepository(
        graph,
        store,
        requireString(input.repositoryId, "Repository id"),
      );
      if (branch.project !== repository.project) {
        throw new WorkflowMutationError(
          409,
          `Workflow branch "${branch.id}" does not belong to repository "${repository.id}".`,
          "invalid-transition",
        );
      }

      const existingManagedBranch = findManagedRepositoryBranchForBranch(graph, branch.id);
      const selectedRepositoryBranch =
        input.repositoryBranchId !== undefined
          ? requireRepositoryBranch(
              graph,
              store,
              requireString(input.repositoryBranchId, "Repository branch id"),
            )
          : existingManagedBranch;

      if (selectedRepositoryBranch) {
        if (selectedRepositoryBranch.repository !== repository.id) {
          throw new WorkflowMutationError(
            409,
            `Repository branch "${selectedRepositoryBranch.id}" does not belong to repository "${repository.id}".`,
            "invalid-transition",
          );
        }
        if (selectedRepositoryBranch.project !== branch.project) {
          throw new WorkflowMutationError(
            409,
            `Repository branch "${selectedRepositoryBranch.id}" does not belong to project "${branch.project}".`,
            "invalid-transition",
          );
        }
        if (
          selectedRepositoryBranch.workflowBranch &&
          selectedRepositoryBranch.workflowBranch !== branch.id
        ) {
          throw new WorkflowMutationError(
            409,
            `Repository branch "${selectedRepositoryBranch.id}" is already managed by workflow branch "${selectedRepositoryBranch.workflowBranch}".`,
            "branch-lock-conflict",
          );
        }
        if (existingManagedBranch && existingManagedBranch.id !== selectedRepositoryBranch.id) {
          throw new WorkflowMutationError(
            409,
            `Workflow branch "${branch.id}" already has managed repository branch "${existingManagedBranch.id}".`,
            "branch-lock-conflict",
          );
        }

        const patch: Record<string, unknown> = {
          name: input.title ?? selectedRepositoryBranch.name ?? branch.name,
          managed: true,
          workflowBranch: branch.id,
          branchName: requireString(input.branchName, "Branch name"),
          baseBranchName: requireString(input.baseBranchName, "Base branch name"),
        };
        if (input.upstreamName !== undefined) {
          if (input.upstreamName === null) {
            clearSingleValue(
              store,
              selectedRepositoryBranch.id,
              edgeId(ops.repositoryBranch.fields.upstreamName),
            );
          } else {
            patch.upstreamName = requireString(input.upstreamName, "Upstream name");
          }
        }
        if (input.headSha !== undefined) {
          if (input.headSha === null) {
            clearSingleValue(
              store,
              selectedRepositoryBranch.id,
              edgeId(ops.repositoryBranch.fields.headSha),
            );
          } else {
            patch.headSha = requireString(input.headSha, "Head SHA");
          }
        }
        if (input.worktreePath !== undefined) {
          if (input.worktreePath === null) {
            clearSingleValue(
              store,
              selectedRepositoryBranch.id,
              edgeId(ops.repositoryBranch.fields.worktreePath),
            );
          } else {
            patch.worktreePath = requireString(input.worktreePath, "Worktree path");
          }
        }
        if (input.latestReconciledAt !== undefined) {
          const latestReconciledAt = parseOptionalDate(
            input.latestReconciledAt,
            "Latest reconciled at",
          );
          if (latestReconciledAt === null) {
            clearSingleValue(
              store,
              selectedRepositoryBranch.id,
              edgeId(ops.repositoryBranch.fields.latestReconciledAt),
            );
          } else if (latestReconciledAt) {
            patch.latestReconciledAt = latestReconciledAt;
          }
        }
        graph.repositoryBranch.update(selectedRepositoryBranch.id, patch);
        return {
          action: input.action,
          created: false,
          summary: buildRepositoryBranchSummary(
            graph.repositoryBranch.get(selectedRepositoryBranch.id),
          ),
        };
      }

      const latestReconciledAt = parseOptionalDate(
        input.latestReconciledAt,
        "Latest reconciled at",
      );
      const repositoryBranchId = graph.repositoryBranch.create({
        name: trimOptionalString(input.title) ?? branch.name,
        project: branch.project,
        repository: repository.id,
        workflowBranch: branch.id,
        managed: true,
        branchName: requireString(input.branchName, "Branch name"),
        baseBranchName: requireString(input.baseBranchName, "Base branch name"),
        upstreamName: trimOptionalString(input.upstreamName),
        headSha: trimOptionalString(input.headSha),
        worktreePath: trimOptionalString(input.worktreePath),
        ...(latestReconciledAt ? { latestReconciledAt } : {}),
      });
      return {
        action: input.action,
        created: true,
        summary: buildRepositoryBranchSummary(graph.repositoryBranch.get(repositoryBranchId)),
      };
    }
    case "createCommit": {
      const branch = requireBranch(graph, store, requireString(input.branchId, "Branch id"));
      const branchState = decodeWorkflowBranchState(branch.state);
      if (branchState === "done" || branchState === "archived") {
        throw new WorkflowMutationError(
          409,
          `Workflow branch "${branch.id}" does not accept new commits in state "${branchState}".`,
          "invalid-transition",
        );
      }
      const commitKey = requireString(input.commitKey, "Commit key");
      requireUniqueCommitKey(graph, commitKey);
      let parentCommitId: string | undefined;
      if (input.parentCommitId) {
        const parentCommit = requireCommit(
          graph,
          store,
          requireString(input.parentCommitId, "Parent commit id"),
        );
        if (parentCommit.branch !== branch.id) {
          throw new WorkflowMutationError(
            409,
            `Parent commit "${parentCommit.id}" does not belong to branch "${branch.id}".`,
            "invalid-transition",
          );
        }
        parentCommitId = parentCommit.id;
      }
      const requestedState =
        input.state === undefined
          ? "planned"
          : requireAllowedValue(
              input.state,
              ["planned", "ready"] as const,
              "Workflow commit state",
            );
      const commitId = graph.workflowCommit.create({
        name: requireString(input.title, "Commit title"),
        branch: branch.id,
        commitKey,
        state: workflowCommitStateIds[requestedState],
        order: input.order,
        ...(parentCommitId ? { parentCommit: parentCommitId } : {}),
      });
      return {
        action: input.action,
        created: true,
        summary: buildCommitSummary(graph.workflowCommit.get(commitId)),
      };
    }
    case "updateCommit": {
      const commit = requireCommit(graph, store, requireString(input.commitId, "Commit id"));
      const patch: Record<string, unknown> = {};
      if (input.title !== undefined) patch.name = input.title;
      if (input.commitKey !== undefined) {
        const commitKey = requireString(input.commitKey, "Commit key");
        requireUniqueCommitKey(graph, commitKey, commit.id);
        patch.commitKey = commitKey;
      }
      if (input.order !== undefined) patch.order = input.order;
      if (input.parentCommitId !== undefined) {
        if (input.parentCommitId === null) {
          clearSingleValue(store, commit.id, edgeId(ops.workflowCommit.fields.parentCommit));
        } else {
          const parentCommit = requireCommit(
            graph,
            store,
            requireString(input.parentCommitId, "Parent commit id"),
          );
          if (parentCommit.id === commit.id) {
            throw new WorkflowMutationError(
              409,
              `Workflow commit "${commit.id}" cannot parent itself.`,
              "invalid-transition",
            );
          }
          if (parentCommit.branch !== commit.branch) {
            throw new WorkflowMutationError(
              409,
              `Parent commit "${parentCommit.id}" does not belong to branch "${commit.branch}".`,
              "invalid-transition",
            );
          }
          patch.parentCommit = parentCommit.id;
        }
      }
      if (Object.keys(patch).length > 0) {
        graph.workflowCommit.update(commit.id, patch);
      }
      return {
        action: input.action,
        created: false,
        summary: buildCommitSummary(graph.workflowCommit.get(commit.id)),
      };
    }
    case "setCommitState": {
      const commit = requireCommit(graph, store, requireString(input.commitId, "Commit id"));
      const branch = requireBranch(graph, store, commit.branch);
      const currentState = decodeWorkflowCommitState(commit.state);
      const targetState = requireAllowedValue(
        input.state,
        workflowCommitStateValues,
        "Workflow commit state",
      );

      requireWorkflowTransition(
        currentState,
        targetState,
        workflowCommitTransitions,
        "Workflow commit",
      );
      if (targetState === "active") {
        requireBranchRepositoryTarget(graph, branch.id);
        requireWorkflowTransition(
          decodeWorkflowBranchState(branch.state),
          "active",
          workflowBranchTransitions,
          "Workflow branch",
        );
        if (branch.activeCommit && branch.activeCommit !== commit.id) {
          throw new WorkflowMutationError(
            409,
            `Workflow branch "${branch.id}" is already locked by active commit "${branch.activeCommit}".`,
            "branch-lock-conflict",
          );
        }
        graph.workflowCommit.update(commit.id, {
          state: workflowCommitStateIds.active,
        });
        graph.workflowBranch.update(branch.id, {
          state: workflowBranchStateIds.active,
        });
        setSingleValue(store, branch.id, edgeId(ops.workflowBranch.fields.activeCommit), commit.id);
      } else {
        if (targetState === "committed") {
          const repositoryCommit = findRepositoryCommitForWorkflowCommit(graph, commit.id);
          if (!repositoryCommit) {
            throw new WorkflowMutationError(
              409,
              `Workflow commit "${commit.id}" does not have a repository commit result.`,
              "repository-missing",
            );
          }
          if (decodeRepositoryCommitState(repositoryCommit.state) !== "committed") {
            throw new WorkflowMutationError(
              409,
              `Workflow commit "${commit.id}" cannot be marked committed before its repository commit is committed.`,
              "invalid-transition",
            );
          }
        }
        graph.workflowCommit.update(commit.id, {
          state: workflowCommitStateIds[targetState],
        });
        if (
          branch.activeCommit === commit.id ||
          currentState === "active" ||
          targetState === "blocked" ||
          targetState === "committed" ||
          targetState === "dropped" ||
          decodeWorkflowBranchState(branch.state) === "active" ||
          decodeWorkflowBranchState(branch.state) === "blocked"
        ) {
          reconcileBranchAfterCommitChange(graph, store, branch.id, commit.id);
        }
      }

      return {
        action: input.action,
        created: false,
        summary: buildCommitSummary(graph.workflowCommit.get(commit.id)),
      };
    }
    case "createRepositoryCommit": {
      const repository = requireRepository(
        graph,
        store,
        requireString(input.repositoryId, "Repository id"),
      );
      let workflowCommitId: string | undefined;
      let repositoryBranchId: string | undefined;
      let defaultTitle = "Repository commit";

      if (input.workflowCommitId) {
        const workflowCommit = requireCommit(
          graph,
          store,
          requireString(input.workflowCommitId, "Workflow commit id"),
        );
        const branch = requireBranch(graph, store, workflowCommit.branch);
        if (branch.project !== repository.project) {
          throw new WorkflowMutationError(
            409,
            `Workflow commit "${workflowCommit.id}" does not belong to repository "${repository.id}".`,
            "invalid-transition",
          );
        }
        const managedRepositoryBranch = requireBranchRepositoryTarget(graph, branch.id);
        if (input.repositoryBranchId) {
          const selectedRepositoryBranch = requireRepositoryBranch(
            graph,
            store,
            requireString(input.repositoryBranchId, "Repository branch id"),
          );
          if (selectedRepositoryBranch.id !== managedRepositoryBranch.id) {
            throw new WorkflowMutationError(
              409,
              `Workflow commit "${workflowCommit.id}" requires managed repository branch "${managedRepositoryBranch.id}".`,
              "repository-missing",
            );
          }
          repositoryBranchId = selectedRepositoryBranch.id;
        } else {
          repositoryBranchId = managedRepositoryBranch.id;
        }
        const existingRepositoryCommit = findRepositoryCommitForWorkflowCommit(
          graph,
          workflowCommit.id,
        );
        if (existingRepositoryCommit) {
          throw new WorkflowMutationError(
            409,
            `Workflow commit "${workflowCommit.id}" is already attached to repository commit "${existingRepositoryCommit.id}".`,
            "commit-lock-conflict",
          );
        }
        workflowCommitId = workflowCommit.id;
        defaultTitle = workflowCommit.name;
      } else if (input.repositoryBranchId) {
        const repositoryBranch = requireRepositoryBranch(
          graph,
          store,
          requireString(input.repositoryBranchId, "Repository branch id"),
        );
        if (repositoryBranch.repository !== repository.id) {
          throw new WorkflowMutationError(
            409,
            `Repository branch "${repositoryBranch.id}" does not belong to repository "${repository.id}".`,
            "invalid-transition",
          );
        }
        repositoryBranchId = repositoryBranch.id;
      }

      const requestedState =
        input.state === undefined
          ? "planned"
          : requireAllowedValue(
              input.state,
              repositoryCommitStateValues,
              "Repository commit state",
            );
      if (requestedState === "committed") {
        throw new WorkflowMutationError(
          409,
          'Repository commits must be finalized through "attachCommitResult".',
          "invalid-transition",
        );
      }
      const requestedLeaseState = normalizeRepositoryCommitLeaseState(
        requestedState,
        input.worktree?.leaseState === undefined
          ? undefined
          : requireAllowedValue(
              input.worktree.leaseState,
              repositoryCommitLeaseStateValues,
              "Repository commit lease state",
            ),
      );
      const repositoryCommitId = graph.repositoryCommit.create({
        name: trimOptionalString(input.title) ?? defaultTitle,
        repository: repository.id,
        ...(repositoryBranchId ? { repositoryBranch: repositoryBranchId } : {}),
        ...(workflowCommitId ? { workflowCommit: workflowCommitId } : {}),
        state: repositoryCommitStateIds[requestedState],
        worktree: {
          path: trimOptionalString(input.worktree?.path),
          branchName: trimOptionalString(input.worktree?.branchName),
          leaseState: repositoryCommitLeaseStateIds[requestedLeaseState],
        },
      });
      return {
        action: input.action,
        created: true,
        summary: buildRepositoryCommitSummary(graph.repositoryCommit.get(repositoryCommitId)),
      };
    }
    case "attachCommitResult": {
      const repositoryCommit = requireRepositoryCommit(
        graph,
        store,
        requireString(input.repositoryCommitId, "Repository commit id"),
      );
      const repository = requireRepository(graph, store, repositoryCommit.repository);

      let workflowCommitId = repositoryCommit.workflowCommit;
      if (input.workflowCommitId) {
        const workflowCommit = requireCommit(
          graph,
          store,
          requireString(input.workflowCommitId, "Workflow commit id"),
        );
        if (workflowCommitId && workflowCommitId !== workflowCommit.id) {
          throw new WorkflowMutationError(
            409,
            `Repository commit "${repositoryCommit.id}" is already attached to workflow commit "${workflowCommitId}".`,
            "commit-lock-conflict",
          );
        }
        workflowCommitId = workflowCommit.id;
      }
      if (!workflowCommitId) {
        throw new WorkflowMutationError(
          409,
          `Repository commit "${repositoryCommit.id}" does not have a workflow commit attachment.`,
          "invalid-transition",
        );
      }

      const workflowCommit = requireCommit(graph, store, workflowCommitId);
      const branch = requireBranch(graph, store, workflowCommit.branch);
      if (branch.project !== repository.project) {
        throw new WorkflowMutationError(
          409,
          `Workflow commit "${workflowCommit.id}" does not belong to repository "${repository.id}".`,
          "invalid-transition",
        );
      }

      const existingRepositoryCommit = findRepositoryCommitForWorkflowCommit(
        graph,
        workflowCommit.id,
        repositoryCommit.id,
      );
      if (existingRepositoryCommit) {
        throw new WorkflowMutationError(
          409,
          `Workflow commit "${workflowCommit.id}" is already attached to repository commit "${existingRepositoryCommit.id}".`,
          "commit-lock-conflict",
        );
      }

      const managedRepositoryBranch = requireBranchRepositoryTarget(graph, branch.id);
      const selectedRepositoryBranch =
        input.repositoryBranchId !== undefined
          ? requireRepositoryBranch(
              graph,
              store,
              requireString(input.repositoryBranchId, "Repository branch id"),
            )
          : repositoryCommit.repositoryBranch
            ? requireRepositoryBranch(graph, store, repositoryCommit.repositoryBranch)
            : managedRepositoryBranch;

      if (selectedRepositoryBranch.repository !== repository.id) {
        throw new WorkflowMutationError(
          409,
          `Repository branch "${selectedRepositoryBranch.id}" does not belong to repository "${repository.id}".`,
          "invalid-transition",
        );
      }
      if (selectedRepositoryBranch.id !== managedRepositoryBranch.id) {
        throw new WorkflowMutationError(
          409,
          `Workflow commit "${workflowCommit.id}" requires managed repository branch "${managedRepositoryBranch.id}".`,
          "repository-missing",
        );
      }

      const committedAt = parseOptionalDate(input.committedAt, "Committed at");
      const patch: Record<string, unknown> = {
        name: trimOptionalString(input.title) ?? repositoryCommit.name ?? workflowCommit.name,
        repositoryBranch: selectedRepositoryBranch.id,
        workflowCommit: workflowCommit.id,
        state: repositoryCommitStateIds.committed,
        sha: requireString(input.sha, "Commit SHA"),
        committedAt: committedAt ?? new Date(),
        worktree: {
          leaseState:
            repositoryCommitLeaseStateIds[
              input.worktree?.leaseState === undefined
                ? "released"
                : requireAllowedValue(
                    input.worktree.leaseState,
                    repositoryCommitLeaseStateValues,
                    "Repository commit lease state",
                  )
            ],
        },
      };
      if (input.worktree?.path !== undefined) {
        if (input.worktree.path === null) {
          clearSingleValue(
            store,
            repositoryCommit.id,
            edgeId(ops.repositoryCommit.fields.worktree.path),
          );
        } else {
          patch.worktree = {
            ...(patch.worktree as Record<string, unknown>),
            path: requireString(input.worktree.path, "Worktree path"),
          };
        }
      }
      if (input.worktree?.branchName !== undefined) {
        if (input.worktree.branchName === null) {
          clearSingleValue(
            store,
            repositoryCommit.id,
            edgeId(ops.repositoryCommit.fields.worktree.branchName),
          );
        } else {
          patch.worktree = {
            ...(patch.worktree as Record<string, unknown>),
            branchName: requireString(input.worktree.branchName, "Worktree branch name"),
          };
        }
      }

      graph.repositoryCommit.update(repositoryCommit.id, patch);
      graph.workflowCommit.update(workflowCommit.id, {
        state: workflowCommitStateIds.committed,
      });
      reconcileBranchAfterCommitChange(graph, store, branch.id, workflowCommit.id);

      return {
        action: input.action,
        created: false,
        summary: buildRepositoryCommitSummary(graph.repositoryCommit.get(repositoryCommit.id)),
      };
    }
    default: {
      throw new WorkflowMutationError(400, "Unsupported workflow mutation action.");
    }
  }
}
