import { edgeId, type GraphStore } from "@io/app/graph";
import { workflow } from "@io/graph-module-workflow";
import {
  repositoryCommitLeaseStateValues,
  repositoryCommitStateValues,
  commitStateValues,
  type WorkflowBranchStateValue,
  type WorkflowMutationAction,
  type WorkflowMutationResult,
} from "@io/graph-module-workflow";

import {
  requireBranch,
  requireCommit,
  requireDocument,
  requireRepository,
  requireRepositoryBranch,
  requireRepositoryCommit,
  requireUniqueCommitKey,
} from "./workflow-authority-shared.js";
import {
  WorkflowMutationError,
  buildBranchSummary,
  buildCommitSummary,
  buildRepositoryCommitSummary,
  clearSingleValue,
  decodeRepositoryCommitLeaseState,
  decodeRepositoryCommitState,
  decodeWorkflowBranchState,
  decodeWorkflowCommitState,
  isWorkflowCommitTerminal,
  normalizeRepositoryCommitLeaseState,
  parseOptionalDate,
  repositoryCommitLeaseStateIds,
  repositoryCommitStateIds,
  requireAllowedValue,
  requireString,
  requireWorkflowTransition,
  setSingleValue,
  trimOptionalString,
  type ProductGraphClient,
  branchStateIds,
  branchTransitions,
  commitStateIds,
  commitTransitions,
} from "./workflow-mutation-helpers.js";

type CommitCreateMutation = Extract<WorkflowMutationAction, { action: "createCommit" }>;
type CommitUpdateMutation = Extract<WorkflowMutationAction, { action: "updateCommit" }>;
type CommitStateMutation = Extract<WorkflowMutationAction, { action: "setCommitState" }>;
type RepositoryCommitCreateMutation = Extract<
  WorkflowMutationAction,
  { action: "createRepositoryCommit" }
>;
type CommitFinalizationMutation = Extract<WorkflowMutationAction, { action: "finalizeCommit" }>;
type RepositoryCommitRecord = ReturnType<ProductGraphClient["repositoryCommit"]["get"]>;

export function findManagedRepositoryBranchForBranch(graph: ProductGraphClient, branchId: string) {
  return graph.repositoryBranch
    .list()
    .find((repositoryBranch) => repositoryBranch.branch === branchId && repositoryBranch.managed);
}

function findRepositoryCommitForWorkflowCommit(
  graph: ProductGraphClient,
  commitId: string,
  exceptRepositoryCommitId?: string,
) {
  return graph.repositoryCommit
    .list()
    .find(
      (repositoryCommit) =>
        repositoryCommit.commit === commitId && repositoryCommit.id !== exceptRepositoryCommitId,
    );
}

function listBranchCommits(graph: ProductGraphClient, branchId: string) {
  return graph.commit.list().filter((commit) => commit.branch === branchId);
}

function compareBranchCommitOrder(
  left: ReturnType<ProductGraphClient["commit"]["get"]>,
  right: ReturnType<ProductGraphClient["commit"]["get"]>,
) {
  return (
    left.order - right.order ||
    left.createdAt.getTime() - right.createdAt.getTime() ||
    left.updatedAt.getTime() - right.updatedAt.getTime() ||
    left.id.localeCompare(right.id)
  );
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

function deriveBranchLifecycleAfterFinalization(
  graph: ProductGraphClient,
  branchId: string,
): {
  readonly activeCommitId?: string;
  readonly state: WorkflowBranchStateValue;
} {
  const commits = listBranchCommits(graph, branchId).sort(compareBranchCommitOrder);
  const activeCommit = commits.find(
    (commit) => decodeWorkflowCommitState(commit.state) === "active",
  );
  if (activeCommit) {
    return {
      activeCommitId: activeCommit.id,
      state: "active",
    };
  }

  const blockedCommit = commits.find(
    (commit) => decodeWorkflowCommitState(commit.state) === "blocked",
  );
  if (blockedCommit) {
    return {
      activeCommitId: blockedCommit.id,
      state: "blocked",
    };
  }

  const readyCommit = commits.find((commit) => decodeWorkflowCommitState(commit.state) === "ready");
  if (readyCommit) {
    return {
      activeCommitId: readyCommit.id,
      state: "ready",
    };
  }

  return {
    state: deriveBranchStateAfterCommitLifecycle(graph, branchId),
  };
}

export function requireBranchRepositoryTarget(graph: ProductGraphClient, branchId: string) {
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

function resolveExistingRepositoryCommitForFinalization(
  graph: ProductGraphClient,
  store: GraphStore,
  commit: ReturnType<ProductGraphClient["commit"]["get"]>,
  input: CommitFinalizationMutation,
): RepositoryCommitRecord | undefined {
  const repositoryCommit =
    input.git?.repositoryCommitId !== undefined
      ? requireRepositoryCommit(
          graph,
          store,
          requireString(input.git.repositoryCommitId, "Repository commit id"),
        )
      : findRepositoryCommitForWorkflowCommit(graph, commit.id);

  if (!repositoryCommit) {
    if (input.git && input.outcome !== "committed") {
      throw new WorkflowMutationError(
        409,
        `Workflow commit "${commit.id}" cannot record git finalization metadata without a repository commit record.`,
        "repository-missing",
      );
    }
    return undefined;
  }

  if (repositoryCommit.commit && repositoryCommit.commit !== commit.id) {
    throw new WorkflowMutationError(
      409,
      `Repository commit "${repositoryCommit.id}" is already attached to workflow commit "${repositoryCommit.commit}".`,
      "commit-lock-conflict",
    );
  }

  const existingRepositoryCommit = findRepositoryCommitForWorkflowCommit(
    graph,
    commit.id,
    repositoryCommit.id,
  );
  if (existingRepositoryCommit) {
    throw new WorkflowMutationError(
      409,
      `Workflow commit "${commit.id}" is already attached to repository commit "${existingRepositoryCommit.id}".`,
      "commit-lock-conflict",
    );
  }

  return repositoryCommit;
}

function resolveRepositoryCommitTargetForFinalization(
  graph: ProductGraphClient,
  store: GraphStore,
  branch: ReturnType<ProductGraphClient["branch"]["get"]>,
  repositoryId: string,
  commitId: string,
  repositoryBranchId: string | null | undefined,
) {
  const repository = requireRepository(graph, store, repositoryId);
  if (branch.project !== repository.project) {
    throw new WorkflowMutationError(
      409,
      `Workflow commit branch "${branch.id}" does not belong to repository "${repository.id}".`,
      "invalid-transition",
    );
  }

  const managedRepositoryBranch = requireBranchRepositoryTarget(graph, branch.id);
  const selectedRepositoryBranch =
    repositoryBranchId !== undefined
      ? requireRepositoryBranch(
          graph,
          store,
          requireString(repositoryBranchId, "Repository branch id"),
        )
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
      `Workflow commit "${commitId}" requires managed repository branch "${managedRepositoryBranch.id}".`,
      "repository-missing",
    );
  }

  return {
    repository,
    repositoryBranch: selectedRepositoryBranch,
  };
}

function buildRepositoryCommitWorktreeCreateInput(
  input:
    | {
        readonly branchName?: string | null;
        readonly leaseState?: (typeof repositoryCommitLeaseStateValues)[number];
        readonly path?: string | null;
      }
    | undefined,
  defaultLeaseState: (typeof repositoryCommitLeaseStateValues)[number],
) {
  const leaseState =
    input?.leaseState === undefined
      ? defaultLeaseState
      : requireAllowedValue(
          input.leaseState,
          repositoryCommitLeaseStateValues,
          "Repository commit lease state",
        );
  const path = trimOptionalString(input?.path);
  const branchName = trimOptionalString(input?.branchName);

  return {
    ...(path ? { path } : {}),
    ...(branchName ? { branchName } : {}),
    leaseState: repositoryCommitLeaseStateIds[leaseState],
  };
}

function buildRepositoryCommitWorktreePatch(
  store: GraphStore,
  repositoryCommit: RepositoryCommitRecord,
  input:
    | {
        readonly branchName?: string | null;
        readonly leaseState?: (typeof repositoryCommitLeaseStateValues)[number];
        readonly path?: string | null;
      }
    | undefined,
  defaultLeaseState?: (typeof repositoryCommitLeaseStateValues)[number],
) {
  let worktreePatch: Record<string, unknown> | undefined;
  const nextLeaseState = input?.leaseState === undefined ? defaultLeaseState : input.leaseState;
  if (nextLeaseState !== undefined) {
    worktreePatch = {
      leaseState:
        repositoryCommitLeaseStateIds[
          input?.leaseState === undefined
            ? nextLeaseState
            : requireAllowedValue(
                input.leaseState,
                repositoryCommitLeaseStateValues,
                "Repository commit lease state",
              )
        ],
    };
  }
  if (input?.path !== undefined) {
    if (input.path === null) {
      clearSingleValue(
        store,
        repositoryCommit.id,
        edgeId(workflow.repositoryCommit.fields.worktree.path),
      );
    } else {
      worktreePatch = {
        ...worktreePatch,
        path: requireString(input.path, "Worktree path"),
      };
    }
  }
  if (input?.branchName !== undefined) {
    if (input.branchName === null) {
      clearSingleValue(
        store,
        repositoryCommit.id,
        edgeId(workflow.repositoryCommit.fields.worktree.branchName),
      );
    } else {
      worktreePatch = {
        ...worktreePatch,
        branchName: requireString(input.branchName, "Worktree branch name"),
      };
    }
  }
  return worktreePatch;
}

function persistRepositoryCommitFinalization(
  graph: ProductGraphClient,
  store: GraphStore,
  branch: ReturnType<ProductGraphClient["branch"]["get"]>,
  commit: ReturnType<ProductGraphClient["commit"]["get"]>,
  input: CommitFinalizationMutation,
) {
  const repositoryCommit = resolveExistingRepositoryCommitForFinalization(
    graph,
    store,
    commit,
    input,
  );

  if (!repositoryCommit) {
    if (input.outcome !== "committed") {
      return undefined;
    }

    const managedRepositoryBranch = requireBranchRepositoryTarget(graph, branch.id);
    const { repository, repositoryBranch } = resolveRepositoryCommitTargetForFinalization(
      graph,
      store,
      branch,
      managedRepositoryBranch.repository,
      commit.id,
      input.git.repositoryBranchId,
    );
    const repositoryCommitId = graph.repositoryCommit.create({
      name: trimOptionalString(input.git.title) ?? commit.name,
      repository: repository.id,
      repositoryBranch: repositoryBranch.id,
      commit: commit.id,
      state: repositoryCommitStateIds.committed,
      worktree: buildRepositoryCommitWorktreeCreateInput(input.git.worktree, "released"),
      sha: requireString(input.git.sha, "Commit SHA"),
      committedAt: parseOptionalDate(input.git.committedAt, "Committed at") ?? new Date(),
    });

    return buildRepositoryCommitSummary(graph.repositoryCommit.get(repositoryCommitId));
  }

  const { repositoryBranch } = resolveRepositoryCommitTargetForFinalization(
    graph,
    store,
    branch,
    repositoryCommit.repository,
    commit.id,
    input.git?.repositoryBranchId ?? repositoryCommit.repositoryBranch,
  );
  const patch: Record<string, unknown> = {
    repositoryBranch: repositoryBranch.id,
    commit: commit.id,
  };

  if (input.git) {
    patch.name = trimOptionalString(input.git.title) ?? repositoryCommit.name ?? commit.name;
    const worktreePatch = buildRepositoryCommitWorktreePatch(
      store,
      repositoryCommit,
      input.git.worktree,
      input.outcome === "committed"
        ? "released"
        : decodeRepositoryCommitLeaseState(repositoryCommit.worktree.leaseState),
    );
    if (worktreePatch) {
      patch.worktree = worktreePatch;
    }
  }

  if (input.outcome === "committed") {
    patch.state = repositoryCommitStateIds.committed;
    patch.sha = requireString(input.git.sha, "Commit SHA");
    patch.committedAt = parseOptionalDate(input.git.committedAt, "Committed at") ?? new Date();
  }

  graph.repositoryCommit.update(repositoryCommit.id, patch);
  return buildRepositoryCommitSummary(graph.repositoryCommit.get(repositoryCommit.id));
}

function reconcileBranchAfterCommitChange(
  graph: ProductGraphClient,
  store: GraphStore,
  branchId: string,
  commitId: string,
): void {
  const branch = graph.branch.get(branchId);
  if (branch.activeCommit === commitId) {
    clearSingleValue(store, branchId, edgeId(workflow.branch.fields.activeCommit));
  }
  const nextState = deriveBranchStateAfterCommitLifecycle(graph, branchId);
  graph.branch.update(branchId, {
    state: branchStateIds[nextState],
  });
}

function advanceBranchAfterCommitFinalization(
  graph: ProductGraphClient,
  store: GraphStore,
  branchId: string,
): void {
  const nextLifecycle = deriveBranchLifecycleAfterFinalization(graph, branchId);

  if (nextLifecycle.activeCommitId) {
    setSingleValue(
      store,
      branchId,
      edgeId(workflow.branch.fields.activeCommit),
      nextLifecycle.activeCommitId,
    );
  } else {
    clearSingleValue(store, branchId, edgeId(workflow.branch.fields.activeCommit));
  }

  graph.branch.update(branchId, {
    state: branchStateIds[nextLifecycle.state],
  });
}

export function createWorkflowCommit(
  graph: ProductGraphClient,
  store: GraphStore,
  input: CommitCreateMutation,
): WorkflowMutationResult {
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
      : requireAllowedValue(input.state, ["planned", "ready"] as const, "Workflow commit state");
  const commitId = graph.commit.create({
    name: requireString(input.title, "Commit title"),
    branch: branch.id,
    commitKey,
    state: commitStateIds[requestedState],
    order: input.order,
    ...(parentCommitId ? { parentCommit: parentCommitId } : {}),
    ...(input.contextDocumentId !== undefined && input.contextDocumentId !== null
      ? {
          contextDocument: requireDocument(
            graph,
            store,
            requireString(input.contextDocumentId, "Context document id"),
          ).id,
        }
      : {}),
  });
  return {
    action: input.action,
    created: true,
    summary: buildCommitSummary(graph.commit.get(commitId)),
  };
}

export function updateWorkflowCommit(
  graph: ProductGraphClient,
  store: GraphStore,
  input: CommitUpdateMutation,
): WorkflowMutationResult {
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
      clearSingleValue(store, commit.id, edgeId(workflow.commit.fields.parentCommit));
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
  if (input.contextDocumentId !== undefined) {
    if (input.contextDocumentId === null) {
      clearSingleValue(store, commit.id, edgeId(workflow.commit.fields.contextDocument));
    } else {
      patch.contextDocument = requireDocument(
        graph,
        store,
        requireString(input.contextDocumentId, "Context document id"),
      ).id;
    }
  }
  if (Object.keys(patch).length > 0) {
    graph.commit.update(commit.id, patch);
  }
  return {
    action: input.action,
    created: false,
    summary: buildCommitSummary(graph.commit.get(commit.id)),
  };
}

export function setWorkflowCommitState(
  graph: ProductGraphClient,
  store: GraphStore,
  input: CommitStateMutation,
): WorkflowMutationResult {
  const commit = requireCommit(graph, store, requireString(input.commitId, "Commit id"));
  const branch = requireBranch(graph, store, commit.branch);
  const currentState = decodeWorkflowCommitState(commit.state);
  const targetState = requireAllowedValue(input.state, commitStateValues, "Workflow commit state");

  requireWorkflowTransition(currentState, targetState, commitTransitions, "Workflow commit");
  if (targetState === "active") {
    requireBranchRepositoryTarget(graph, branch.id);
    requireWorkflowTransition(
      decodeWorkflowBranchState(branch.state),
      "active",
      branchTransitions,
      "Workflow branch",
    );
    if (branch.activeCommit && branch.activeCommit !== commit.id) {
      throw new WorkflowMutationError(
        409,
        `Workflow branch "${branch.id}" is already locked by active commit "${branch.activeCommit}".`,
        "branch-lock-conflict",
      );
    }
    graph.commit.update(commit.id, {
      state: commitStateIds.active,
    });
    graph.branch.update(branch.id, {
      state: branchStateIds.active,
    });
    setSingleValue(store, branch.id, edgeId(workflow.branch.fields.activeCommit), commit.id);
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
    graph.commit.update(commit.id, {
      state: commitStateIds[targetState],
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
    summary: buildCommitSummary(graph.commit.get(commit.id)),
  };
}

export function createWorkflowRepositoryCommit(
  graph: ProductGraphClient,
  store: GraphStore,
  input: RepositoryCommitCreateMutation,
): WorkflowMutationResult {
  const repository = requireRepository(
    graph,
    store,
    requireString(input.repositoryId, "Repository id"),
  );
  let commitId: string | undefined;
  let repositoryBranchId: string | undefined;
  let defaultTitle = "Repository commit";

  if (input.commitId) {
    const commit = requireCommit(graph, store, requireString(input.commitId, "Workflow commit id"));
    const branch = requireBranch(graph, store, commit.branch);
    if (branch.project !== repository.project) {
      throw new WorkflowMutationError(
        409,
        `Workflow commit "${commit.id}" does not belong to repository "${repository.id}".`,
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
          `Workflow commit "${commit.id}" requires managed repository branch "${managedRepositoryBranch.id}".`,
          "repository-missing",
        );
      }
      repositoryBranchId = selectedRepositoryBranch.id;
    } else {
      repositoryBranchId = managedRepositoryBranch.id;
    }
    const existingRepositoryCommit = findRepositoryCommitForWorkflowCommit(graph, commit.id);
    if (existingRepositoryCommit) {
      throw new WorkflowMutationError(
        409,
        `Workflow commit "${commit.id}" is already attached to repository commit "${existingRepositoryCommit.id}".`,
        "commit-lock-conflict",
      );
    }
    commitId = commit.id;
    defaultTitle = commit.name;
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
      : requireAllowedValue(input.state, repositoryCommitStateValues, "Repository commit state");
  if (requestedState === "committed") {
    throw new WorkflowMutationError(
      409,
      'Repository commits must be finalized through "finalizeCommit".',
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
    ...(commitId ? { commit: commitId } : {}),
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

export function finalizeWorkflowCommit(
  graph: ProductGraphClient,
  store: GraphStore,
  input: CommitFinalizationMutation,
): WorkflowMutationResult {
  const commit = requireCommit(graph, store, requireString(input.commitId, "Workflow commit id"));
  const branch = requireBranch(graph, store, commit.branch);

  if (decodeWorkflowCommitState(commit.state) !== "active") {
    throw new WorkflowMutationError(
      409,
      `Workflow commit "${commit.id}" can only be finalized from "active".`,
      "invalid-transition",
    );
  }

  const repositoryCommitSummary = persistRepositoryCommitFinalization(
    graph,
    store,
    branch,
    commit,
    input,
  );

  graph.commit.update(commit.id, {
    state: commitStateIds[input.outcome],
  });
  advanceBranchAfterCommitFinalization(graph, store, branch.id);

  const finalizedCommit = graph.commit.get(commit.id);
  const finalizedBranch = graph.branch.get(branch.id);

  return {
    action: input.action,
    created: false,
    finalization: {
      branch: buildBranchSummary(graph, finalizedBranch),
      commit: buildCommitSummary(finalizedCommit),
      outcome: input.outcome,
      ...(repositoryCommitSummary ? { repositoryCommit: repositoryCommitSummary } : {}),
    },
    summary: buildCommitSummary(finalizedCommit),
  };
}

export function validateWorkflowBranchStateTransition(
  graph: ProductGraphClient,
  branch: ReturnType<ProductGraphClient["branch"]["get"]>,
  targetState: WorkflowBranchStateValue,
): void {
  const currentState = decodeWorkflowBranchState(branch.state);
  requireWorkflowTransition(currentState, targetState, branchTransitions, "Workflow branch");
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
      !commits.every((commit) => isWorkflowCommitTerminal(decodeWorkflowCommitState(commit.state)))
    ) {
      throw new WorkflowMutationError(
        409,
        `Workflow branch "${branch.id}" cannot be marked done while it still has open commits.`,
        "invalid-transition",
      );
    }
  }
}
