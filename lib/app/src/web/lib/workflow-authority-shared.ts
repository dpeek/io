import { type GraphStore } from "@io/app/graph";
import { workflow } from "@io/graph-module-workflow";

import {
  WorkflowMutationError,
  hasEntityOfType,
  type ProductGraphClient,
} from "./workflow-mutation-helpers.js";

const projectTypeId = workflow.project.values.id as string;
const repositoryTypeId = workflow.repository.values.id as string;
const branchTypeId = workflow.branch.values.id as string;
const commitTypeId = workflow.commit.values.id as string;
const repositoryBranchTypeId = workflow.repositoryBranch.values.id as string;
const repositoryCommitTypeId = workflow.repositoryCommit.values.id as string;
const agentSessionTypeId = workflow.agentSession.values.id as string;
const documentTypeId = workflow.document.values.id as string;

const inferredProjectLimitMessage =
  "Branch 6 v1 supports exactly one inferred workflow project per graph.";
const attachedRepositoryLimitMessage =
  "Branch 6 v1 supports exactly one attached workflow repository per graph.";

export function requireProject(graph: ProductGraphClient, store: GraphStore, projectId: string) {
  if (!hasEntityOfType(store, projectId, projectTypeId)) {
    throw new WorkflowMutationError(
      404,
      `Workflow project "${projectId}" was not found.`,
      "subject-not-found",
    );
  }
  return graph.project.get(projectId);
}

export function requireRepository(
  graph: ProductGraphClient,
  store: GraphStore,
  repositoryId: string,
) {
  if (!hasEntityOfType(store, repositoryId, repositoryTypeId)) {
    throw new WorkflowMutationError(
      409,
      `Workflow repository "${repositoryId}" was not found.`,
      "repository-missing",
    );
  }
  return graph.repository.get(repositoryId);
}

export function requireBranch(graph: ProductGraphClient, store: GraphStore, branchId: string) {
  if (!hasEntityOfType(store, branchId, branchTypeId)) {
    throw new WorkflowMutationError(
      404,
      `Workflow branch "${branchId}" was not found.`,
      "subject-not-found",
    );
  }
  return graph.branch.get(branchId);
}

export function requireCommit(graph: ProductGraphClient, store: GraphStore, commitId: string) {
  if (!hasEntityOfType(store, commitId, commitTypeId)) {
    throw new WorkflowMutationError(
      404,
      `Workflow commit "${commitId}" was not found.`,
      "subject-not-found",
    );
  }
  return graph.commit.get(commitId);
}

export function requireRepositoryBranch(
  graph: ProductGraphClient,
  store: GraphStore,
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

export function requireRepositoryCommit(
  graph: ProductGraphClient,
  store: GraphStore,
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

export function requireAgentSession(
  graph: ProductGraphClient,
  store: GraphStore,
  sessionId: string,
) {
  if (!hasEntityOfType(store, sessionId, agentSessionTypeId)) {
    throw new WorkflowMutationError(
      404,
      `Workflow session "${sessionId}" was not found.`,
      "subject-not-found",
    );
  }
  return graph.agentSession.get(sessionId);
}

export function requireDocument(graph: ProductGraphClient, store: GraphStore, documentId: string) {
  if (!hasEntityOfType(store, documentId, documentTypeId)) {
    throw new WorkflowMutationError(
      404,
      `Document "${documentId}" was not found.`,
      "subject-not-found",
    );
  }
  return graph.document.get(documentId);
}

export function requireUniqueProjectKey(
  graph: ProductGraphClient,
  projectKey: string,
  exceptProjectId?: string,
): void {
  const existing = graph.project
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

export function requireUniqueRepositoryKey(
  graph: ProductGraphClient,
  repositoryKey: string,
  exceptRepositoryId?: string,
): void {
  const existing = graph.repository
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

export function requireUniqueBranchKey(
  graph: ProductGraphClient,
  branchKey: string,
  exceptBranchId?: string,
): void {
  const existing = graph.branch
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

export function requireUniqueCommitKey(
  graph: ProductGraphClient,
  commitKey: string,
  exceptCommitId?: string,
): void {
  const existing = graph.commit
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

export function requireSingleInferredProject(
  graph: ProductGraphClient,
  exceptProjectId?: string,
): void {
  const inferredProject = graph.project
    .list()
    .find((project) => project.inferred && project.id !== exceptProjectId);
  if (inferredProject) {
    throw new WorkflowMutationError(409, inferredProjectLimitMessage, "invalid-transition");
  }
}

export function requireSingleAttachedRepository(
  graph: ProductGraphClient,
  exceptRepositoryId?: string,
): void {
  const attachedRepository = graph.repository
    .list()
    .find((repository) => repository.id !== exceptRepositoryId);
  if (attachedRepository) {
    throw new WorkflowMutationError(409, attachedRepositoryLimitMessage, "invalid-transition");
  }
}
