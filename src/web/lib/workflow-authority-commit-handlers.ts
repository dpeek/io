import { edgeId, type GraphStore } from "@io/core/graph";
import { workflow } from "@io/core/graph/modules/workflow";
import {
  repositoryCommitLeaseStateValues,
  repositoryCommitStateValues,
  commitStateValues,
  type WorkflowBranchStateValue,
  type WorkflowMutationAction,
  type WorkflowMutationResult,
} from "@io/core/graph/modules/workflow";

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
  buildCommitSummary,
  buildRepositoryCommitSummary,
  clearSingleValue,
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
type CommitResultMutation = Extract<WorkflowMutationAction, { action: "attachCommitResult" }>;

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

export function attachWorkflowCommitResult(
  graph: ProductGraphClient,
  store: GraphStore,
  input: CommitResultMutation,
): WorkflowMutationResult {
  const repositoryCommit = requireRepositoryCommit(
    graph,
    store,
    requireString(input.repositoryCommitId, "Repository commit id"),
  );
  const repository = requireRepository(graph, store, repositoryCommit.repository);

  let commitId = repositoryCommit.commit;
  if (input.commitId) {
    const commit = requireCommit(graph, store, requireString(input.commitId, "Workflow commit id"));
    if (commitId && commitId !== commit.id) {
      throw new WorkflowMutationError(
        409,
        `Repository commit "${repositoryCommit.id}" is already attached to workflow commit "${commitId}".`,
        "commit-lock-conflict",
      );
    }
    commitId = commit.id;
  }
  if (!commitId) {
    throw new WorkflowMutationError(
      409,
      `Repository commit "${repositoryCommit.id}" does not have a workflow commit attachment.`,
      "invalid-transition",
    );
  }

  const commit = requireCommit(graph, store, commitId);
  const branch = requireBranch(graph, store, commit.branch);
  if (branch.project !== repository.project) {
    throw new WorkflowMutationError(
      409,
      `Workflow commit "${commit.id}" does not belong to repository "${repository.id}".`,
      "invalid-transition",
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
      `Workflow commit "${commit.id}" requires managed repository branch "${managedRepositoryBranch.id}".`,
      "repository-missing",
    );
  }

  const committedAt = parseOptionalDate(input.committedAt, "Committed at");
  const patch: Record<string, unknown> = {
    name: trimOptionalString(input.title) ?? repositoryCommit.name ?? commit.name,
    repositoryBranch: selectedRepositoryBranch.id,
    commit: commit.id,
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
        edgeId(workflow.repositoryCommit.fields.worktree.path),
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
        edgeId(workflow.repositoryCommit.fields.worktree.branchName),
      );
    } else {
      patch.worktree = {
        ...(patch.worktree as Record<string, unknown>),
        branchName: requireString(input.worktree.branchName, "Worktree branch name"),
      };
    }
  }

  graph.repositoryCommit.update(repositoryCommit.id, patch);
  graph.commit.update(commit.id, {
    state: commitStateIds.committed,
  });
  reconcileBranchAfterCommitChange(graph, store, branch.id, commit.id);

  return {
    action: input.action,
    created: false,
    summary: buildRepositoryCommitSummary(graph.repositoryCommit.get(repositoryCommit.id)),
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
