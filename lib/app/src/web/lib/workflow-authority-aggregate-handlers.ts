import { edgeId, type GraphStore } from "@io/app/graph";
import { workflow } from "@io/graph-module-workflow";
import {
  branchStateValues,
  type WorkflowMutationAction,
  type WorkflowMutationResult,
} from "@io/graph-module-workflow";

import {
  findManagedRepositoryBranchForBranch,
  validateWorkflowBranchStateTransition,
} from "./workflow-authority-commit-handlers.js";
import {
  requireBranch,
  requireDocument,
  requireProject,
  requireRepository,
  requireRepositoryBranch,
  requireSingleAttachedRepository,
  requireSingleInferredProject,
  requireUniqueBranchKey,
  requireUniqueProjectKey,
  requireUniqueRepositoryKey,
} from "./workflow-authority-shared.js";
import {
  WorkflowMutationError,
  buildBranchSummary,
  buildProjectSummary,
  buildRepositoryBranchSummary,
  buildRepositorySummary,
  clearSingleValue,
  parseOptionalDate,
  type ProductGraphClient,
  requireAllowedValue,
  requireString,
  trimOptionalString,
  branchStateIds,
} from "./workflow-mutation-helpers.js";

type ProjectCreateMutation = Extract<WorkflowMutationAction, { action: "createProject" }>;
type ProjectUpdateMutation = Extract<WorkflowMutationAction, { action: "updateProject" }>;
type RepositoryCreateMutation = Extract<WorkflowMutationAction, { action: "createRepository" }>;
type RepositoryUpdateMutation = Extract<WorkflowMutationAction, { action: "updateRepository" }>;
type BranchCreateMutation = Extract<WorkflowMutationAction, { action: "createBranch" }>;
type BranchUpdateMutation = Extract<WorkflowMutationAction, { action: "updateBranch" }>;
type BranchStateMutation = Extract<WorkflowMutationAction, { action: "setBranchState" }>;
type BranchRepositoryTargetMutation = Extract<
  WorkflowMutationAction,
  { action: "attachBranchRepositoryTarget" }
>;

function createWorkflowProject(
  graph: ProductGraphClient,
  input: ProjectCreateMutation,
): WorkflowMutationResult {
  const projectKey = requireString(input.projectKey, "Project key");
  const title = requireString(input.title, "Project title");
  const inferred = input.inferred ?? true;
  if (inferred) requireSingleInferredProject(graph);
  requireUniqueProjectKey(graph, projectKey);
  const projectId = graph.project.create({
    name: title,
    projectKey,
    inferred,
  });
  return {
    action: input.action,
    created: true,
    summary: buildProjectSummary(graph.project.get(projectId)),
  };
}

function updateWorkflowProject(
  graph: ProductGraphClient,
  store: GraphStore,
  input: ProjectUpdateMutation,
): WorkflowMutationResult {
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
    graph.project.update(project.id, patch);
  }
  return {
    action: input.action,
    created: false,
    summary: buildProjectSummary(graph.project.get(project.id)),
  };
}

function createWorkflowRepository(
  graph: ProductGraphClient,
  store: GraphStore,
  input: RepositoryCreateMutation,
): WorkflowMutationResult {
  const project = requireProject(graph, store, requireString(input.projectId, "Project id"));
  requireSingleAttachedRepository(graph);
  const repositoryKey = requireString(input.repositoryKey, "Repository key");
  requireUniqueRepositoryKey(graph, repositoryKey);
  const repositoryId = graph.repository.create({
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
    summary: buildRepositorySummary(graph.repository.get(repositoryId)),
  };
}

function updateWorkflowRepository(
  graph: ProductGraphClient,
  store: GraphStore,
  input: RepositoryUpdateMutation,
): WorkflowMutationResult {
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
      clearSingleValue(store, repository.id, edgeId(workflow.repository.fields.mainRemoteName));
    } else {
      patch.mainRemoteName = requireString(input.mainRemoteName, "Main remote name");
    }
  }
  if (Object.keys(patch).length > 0) {
    graph.repository.update(repository.id, patch);
  }
  return {
    action: input.action,
    created: false,
    summary: buildRepositorySummary(graph.repository.get(repository.id)),
  };
}

function createWorkflowBranch(
  graph: ProductGraphClient,
  store: GraphStore,
  input: BranchCreateMutation,
): WorkflowMutationResult {
  const project = requireProject(graph, store, requireString(input.projectId, "Project id"));
  const branchKey = requireString(input.branchKey, "Branch key");
  requireUniqueBranchKey(graph, branchKey);
  const requestedState =
    input.state === undefined
      ? "backlog"
      : requireAllowedValue(input.state, ["backlog", "ready"] as const, "Workflow branch state");
  const branchId = graph.branch.create({
    name: requireString(input.title, "Branch title"),
    project: project.id,
    branchKey,
    state: branchStateIds[requestedState],
    ...(input.goalDocumentId !== undefined && input.goalDocumentId !== null
      ? {
          goalDocument: requireDocument(
            graph,
            store,
            requireString(input.goalDocumentId, "Goal document id"),
          ).id,
        }
      : {}),
    ...(input.contextDocumentId !== undefined && input.contextDocumentId !== null
      ? {
          contextDocument: requireDocument(
            graph,
            store,
            requireString(input.contextDocumentId, "Context document id"),
          ).id,
        }
      : {}),
    ...(input.queueRank !== undefined && input.queueRank !== null
      ? { queueRank: input.queueRank }
      : {}),
  });
  return {
    action: input.action,
    created: true,
    summary: buildBranchSummary(graph, graph.branch.get(branchId)),
  };
}

function updateWorkflowBranch(
  graph: ProductGraphClient,
  store: GraphStore,
  input: BranchUpdateMutation,
): WorkflowMutationResult {
  const branch = requireBranch(graph, store, requireString(input.branchId, "Branch id"));
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.name = input.title;
  if (input.branchKey !== undefined) {
    const branchKey = requireString(input.branchKey, "Branch key");
    requireUniqueBranchKey(graph, branchKey, branch.id);
    patch.branchKey = branchKey;
  }
  if (input.goalDocumentId !== undefined) {
    if (input.goalDocumentId === null) {
      clearSingleValue(store, branch.id, edgeId(workflow.branch.fields.goalDocument));
    } else {
      patch.goalDocument = requireDocument(
        graph,
        store,
        requireString(input.goalDocumentId, "Goal document id"),
      ).id;
    }
  }
  if (input.contextDocumentId !== undefined) {
    if (input.contextDocumentId === null) {
      clearSingleValue(store, branch.id, edgeId(workflow.branch.fields.contextDocument));
    } else {
      patch.contextDocument = requireDocument(
        graph,
        store,
        requireString(input.contextDocumentId, "Context document id"),
      ).id;
    }
  }
  if (input.queueRank !== undefined) {
    if (input.queueRank === null) {
      clearSingleValue(store, branch.id, edgeId(workflow.branch.fields.queueRank));
    } else {
      patch.queueRank = input.queueRank;
    }
  }
  if (Object.keys(patch).length > 0) {
    graph.branch.update(branch.id, patch);
  }
  return {
    action: input.action,
    created: false,
    summary: buildBranchSummary(graph, graph.branch.get(branch.id)),
  };
}

function setWorkflowBranchState(
  graph: ProductGraphClient,
  store: GraphStore,
  input: BranchStateMutation,
): WorkflowMutationResult {
  const branch = requireBranch(graph, store, requireString(input.branchId, "Branch id"));
  const targetState = requireAllowedValue(input.state, branchStateValues, "Workflow branch state");
  validateWorkflowBranchStateTransition(graph, branch, targetState);
  graph.branch.update(branch.id, {
    state: branchStateIds[targetState],
  });
  return {
    action: input.action,
    created: false,
    summary: buildBranchSummary(graph, graph.branch.get(branch.id)),
  };
}

function resolveBranchRepositoryTarget(
  graph: ProductGraphClient,
  store: GraphStore,
  branch: ReturnType<typeof requireBranch>,
  repositoryId: string,
  input: BranchRepositoryTargetMutation,
) {
  const existingManagedBranch = findManagedRepositoryBranchForBranch(graph, branch.id);
  const selectedRepositoryBranch =
    input.repositoryBranchId !== undefined
      ? requireRepositoryBranch(
          graph,
          store,
          requireString(input.repositoryBranchId, "Repository branch id"),
        )
      : existingManagedBranch;

  if (!selectedRepositoryBranch) {
    return { existingManagedBranch, selectedRepositoryBranch: undefined };
  }

  if (selectedRepositoryBranch.repository !== repositoryId) {
    throw new WorkflowMutationError(
      409,
      `Repository branch "${selectedRepositoryBranch.id}" does not belong to repository "${repositoryId}".`,
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
  if (selectedRepositoryBranch.branch && selectedRepositoryBranch.branch !== branch.id) {
    throw new WorkflowMutationError(
      409,
      `Repository branch "${selectedRepositoryBranch.id}" is already managed by workflow branch "${selectedRepositoryBranch.branch}".`,
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

  return { existingManagedBranch, selectedRepositoryBranch };
}

function updateManagedBranchRepositoryTarget(
  graph: ProductGraphClient,
  store: GraphStore,
  branch: ReturnType<typeof requireBranch>,
  repositoryBranch: ReturnType<typeof requireRepositoryBranch>,
  input: BranchRepositoryTargetMutation,
): WorkflowMutationResult {
  const patch: Record<string, unknown> = {
    name: input.title ?? repositoryBranch.name ?? branch.name,
    managed: true,
    branch: branch.id,
    branchName: requireString(input.branchName, "Branch name"),
    baseBranchName: requireString(input.baseBranchName, "Base branch name"),
  };
  if (input.upstreamName !== undefined) {
    if (input.upstreamName === null) {
      clearSingleValue(
        store,
        repositoryBranch.id,
        edgeId(workflow.repositoryBranch.fields.upstreamName),
      );
    } else {
      patch.upstreamName = requireString(input.upstreamName, "Upstream name");
    }
  }
  if (input.headSha !== undefined) {
    if (input.headSha === null) {
      clearSingleValue(
        store,
        repositoryBranch.id,
        edgeId(workflow.repositoryBranch.fields.headSha),
      );
    } else {
      patch.headSha = requireString(input.headSha, "Head SHA");
    }
  }
  if (input.worktreePath !== undefined) {
    if (input.worktreePath === null) {
      clearSingleValue(
        store,
        repositoryBranch.id,
        edgeId(workflow.repositoryBranch.fields.worktreePath),
      );
    } else {
      patch.worktreePath = requireString(input.worktreePath, "Worktree path");
    }
  }
  if (input.latestReconciledAt !== undefined) {
    const latestReconciledAt = parseOptionalDate(input.latestReconciledAt, "Latest reconciled at");
    if (latestReconciledAt === null) {
      clearSingleValue(
        store,
        repositoryBranch.id,
        edgeId(workflow.repositoryBranch.fields.latestReconciledAt),
      );
    } else if (latestReconciledAt) {
      patch.latestReconciledAt = latestReconciledAt;
    }
  }
  graph.repositoryBranch.update(repositoryBranch.id, patch);
  return {
    action: input.action,
    created: false,
    summary: buildRepositoryBranchSummary(graph.repositoryBranch.get(repositoryBranch.id)),
  };
}

function createManagedBranchRepositoryTarget(
  graph: ProductGraphClient,
  branch: ReturnType<typeof requireBranch>,
  repositoryId: string,
  input: BranchRepositoryTargetMutation,
): WorkflowMutationResult {
  const latestReconciledAt = parseOptionalDate(input.latestReconciledAt, "Latest reconciled at");
  const repositoryBranchId = graph.repositoryBranch.create({
    name: trimOptionalString(input.title) ?? branch.name,
    project: branch.project,
    repository: repositoryId,
    branch: branch.id,
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

function attachWorkflowBranchRepositoryTarget(
  graph: ProductGraphClient,
  store: GraphStore,
  input: BranchRepositoryTargetMutation,
): WorkflowMutationResult {
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

  const { selectedRepositoryBranch } = resolveBranchRepositoryTarget(
    graph,
    store,
    branch,
    repository.id,
    input,
  );

  return selectedRepositoryBranch
    ? updateManagedBranchRepositoryTarget(graph, store, branch, selectedRepositoryBranch, input)
    : createManagedBranchRepositoryTarget(graph, branch, repository.id, input);
}

export function dispatchWorkflowAggregateMutation(
  graph: ProductGraphClient,
  store: GraphStore,
  input: WorkflowMutationAction,
): WorkflowMutationResult | undefined {
  switch (input.action) {
    case "createProject":
      return createWorkflowProject(graph, input);
    case "updateProject":
      return updateWorkflowProject(graph, store, input);
    case "createRepository":
      return createWorkflowRepository(graph, store, input);
    case "updateRepository":
      return updateWorkflowRepository(graph, store, input);
    case "createBranch":
      return createWorkflowBranch(graph, store, input);
    case "updateBranch":
      return updateWorkflowBranch(graph, store, input);
    case "setBranchState":
      return setWorkflowBranchState(graph, store, input);
    case "attachBranchRepositoryTarget":
      return attachWorkflowBranchRepositoryTarget(graph, store, input);
    default:
      return undefined;
  }
}
