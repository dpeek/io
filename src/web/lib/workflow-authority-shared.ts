import type { Store } from "@io/core/graph";
import { ops } from "@io/core/graph/modules/ops";
import { pkm } from "@io/core/graph/modules/pkm";

import {
  WorkflowMutationError,
  hasEntityOfType,
  type ProductGraphClient,
} from "./workflow-mutation-helpers.js";

const workflowProjectTypeId = ops.workflowProject.values.id as string;
const workflowRepositoryTypeId = ops.workflowRepository.values.id as string;
const workflowBranchTypeId = ops.workflowBranch.values.id as string;
const workflowCommitTypeId = ops.workflowCommit.values.id as string;
const repositoryBranchTypeId = ops.repositoryBranch.values.id as string;
const repositoryCommitTypeId = ops.repositoryCommit.values.id as string;
const documentTypeId = pkm.document.values.id as string;

const inferredProjectLimitMessage =
  "Branch 6 v1 supports exactly one inferred workflow project per graph.";
const attachedRepositoryLimitMessage =
  "Branch 6 v1 supports exactly one attached workflow repository per graph.";

export function requireProject(graph: ProductGraphClient, store: Store, projectId: string) {
  if (!hasEntityOfType(store, projectId, workflowProjectTypeId)) {
    throw new WorkflowMutationError(
      404,
      `Workflow project "${projectId}" was not found.`,
      "subject-not-found",
    );
  }
  return graph.workflowProject.get(projectId);
}

export function requireRepository(graph: ProductGraphClient, store: Store, repositoryId: string) {
  if (!hasEntityOfType(store, repositoryId, workflowRepositoryTypeId)) {
    throw new WorkflowMutationError(
      409,
      `Workflow repository "${repositoryId}" was not found.`,
      "repository-missing",
    );
  }
  return graph.workflowRepository.get(repositoryId);
}

export function requireBranch(graph: ProductGraphClient, store: Store, branchId: string) {
  if (!hasEntityOfType(store, branchId, workflowBranchTypeId)) {
    throw new WorkflowMutationError(
      404,
      `Workflow branch "${branchId}" was not found.`,
      "subject-not-found",
    );
  }
  return graph.workflowBranch.get(branchId);
}

export function requireCommit(graph: ProductGraphClient, store: Store, commitId: string) {
  if (!hasEntityOfType(store, commitId, workflowCommitTypeId)) {
    throw new WorkflowMutationError(
      404,
      `Workflow commit "${commitId}" was not found.`,
      "subject-not-found",
    );
  }
  return graph.workflowCommit.get(commitId);
}

export function requireRepositoryBranch(
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

export function requireRepositoryCommit(
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

export function requireDocument(graph: ProductGraphClient, store: Store, documentId: string) {
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

export function requireUniqueRepositoryKey(
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

export function requireUniqueBranchKey(
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

export function requireUniqueCommitKey(
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

export function requireSingleInferredProject(
  graph: ProductGraphClient,
  exceptProjectId?: string,
): void {
  const inferredProject = graph.workflowProject
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
  const attachedRepository = graph.workflowRepository
    .list()
    .find((repository) => repository.id !== exceptRepositoryId);
  if (attachedRepository) {
    throw new WorkflowMutationError(409, attachedRepositoryLimitMessage, "invalid-transition");
  }
}
