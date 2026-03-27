import {
  createModuleReadScopeRequest,
  createProjectionDependencyKey,
  createScopeDependencyKey,
  defineInvalidationEvent,
  defineModuleReadScopeDefinition,
  defineProjectionCatalog,
  defineProjectionSpec,
  type DependencyKey,
  type InvalidationEvent,
} from "@io/graph-projection";

import { document } from "./document.js";
import {
  agentSession,
  agentSessionEvent,
  contextBundle,
  contextBundleEntry,
  repositoryBranch,
  repositoryCommit,
  artifact,
  branch,
  commit,
  decision,
  project,
  repository,
} from "./type.js";
import workflowIds from "./workflow.json";

const workflowTypeIds = workflowIds.keys as Record<string, string>;

export const workflowModuleId = "workflow";
const projectBranchBoardProjectionId = "workflow:project-branch-board";
const branchCommitQueueProjectionId = "workflow:branch-commit-queue";
const emptyDependencyKeys = Object.freeze([]) as readonly DependencyKey[];

function typeIdentityKeys(typeDef: {
  readonly values: { readonly id?: string; readonly key: string };
}): readonly string[] {
  const keys = [typeDef.values.key];
  const resolvedId = workflowTypeIds[typeDef.values.key];
  if (typeof resolvedId === "string" && !keys.includes(resolvedId)) {
    keys.push(resolvedId);
  }
  if (typeDef.values.id) {
    keys.push(typeDef.values.id);
  }
  return keys;
}

export const workflowReviewModuleReadScope = defineModuleReadScopeDefinition({
  kind: "module",
  moduleId: workflowModuleId,
  scopeId: "scope:workflow:review",
  definitionHash: "scope-def:workflow:review:v1",
});

export const workflowReviewSyncScopeRequest = createModuleReadScopeRequest(
  workflowReviewModuleReadScope,
);

export const workflowReviewScopeDependencyKey = createScopeDependencyKey(
  workflowReviewModuleReadScope.scopeId,
);

export const projectBranchBoardProjectionDependencyKey = createProjectionDependencyKey(
  projectBranchBoardProjectionId,
);

export const branchCommitQueueProjectionDependencyKey = createProjectionDependencyKey(
  branchCommitQueueProjectionId,
);

export const projectBranchBoardProjection = defineProjectionSpec({
  projectionId: projectBranchBoardProjectionId,
  kind: "collection-index",
  definitionHash: "projection-def:workflow:project-branch-board:v1",
  sourceScopeKinds: ["module"],
  dependencyKeys: [projectBranchBoardProjectionDependencyKey, workflowReviewScopeDependencyKey],
  rebuildStrategy: "full",
  visibilityMode: "policy-filtered",
});

export const branchCommitQueueProjection = defineProjectionSpec({
  projectionId: branchCommitQueueProjectionId,
  kind: "collection-index",
  definitionHash: "projection-def:workflow:branch-commit-queue:v1",
  sourceScopeKinds: ["module"],
  dependencyKeys: [branchCommitQueueProjectionDependencyKey, workflowReviewScopeDependencyKey],
  rebuildStrategy: "full",
  visibilityMode: "policy-filtered",
});

const workflowReviewInvalidationProjectionIds = Object.freeze([
  projectBranchBoardProjection.projectionId,
  branchCommitQueueProjection.projectionId,
] as const);

const workflowReviewAffectedScopeIds = Object.freeze([
  workflowReviewModuleReadScope.scopeId,
] as const);

const workflowReviewInvalidationTypeIds = new Set(
  [
    project,
    repository,
    branch,
    commit,
    repositoryBranch,
    repositoryCommit,
    agentSession,
    agentSessionEvent,
    artifact,
    decision,
    contextBundle,
    contextBundleEntry,
    document,
  ].flatMap((typeDef) => typeIdentityKeys(typeDef)),
);

export const workflowReviewDependencyKeys = Object.freeze([
  workflowReviewScopeDependencyKey,
  projectBranchBoardProjectionDependencyKey,
  branchCommitQueueProjectionDependencyKey,
] as const);

export function compileWorkflowReviewScopeDependencyKeys(): readonly DependencyKey[] {
  return workflowReviewDependencyKeys;
}

export function compileWorkflowReviewWriteDependencyKeys(input: {
  readonly touchedTypeIds: Iterable<string>;
}): readonly DependencyKey[] {
  for (const typeId of input.touchedTypeIds) {
    if (workflowReviewInvalidationTypeIds.has(typeId)) {
      return workflowReviewDependencyKeys;
    }
  }

  return emptyDependencyKeys;
}

export function createWorkflowReviewInvalidationEvent(input: {
  readonly eventId: string;
  readonly graphId: string;
  readonly sourceCursor: string;
  readonly touchedTypeIds: Iterable<string>;
}): InvalidationEvent | undefined {
  const dependencyKeys = compileWorkflowReviewWriteDependencyKeys({
    touchedTypeIds: input.touchedTypeIds,
  });
  if (dependencyKeys.length === 0) {
    return undefined;
  }

  return defineInvalidationEvent({
    eventId: input.eventId,
    graphId: input.graphId,
    sourceCursor: input.sourceCursor,
    dependencyKeys,
    affectedProjectionIds: workflowReviewInvalidationProjectionIds,
    affectedScopeIds: workflowReviewAffectedScopeIds,
    delivery: { kind: "cursor-advanced" },
  });
}

export const projectionCatalog = defineProjectionCatalog([
  projectBranchBoardProjection,
  branchCommitQueueProjection,
] as const);

export const projectionMetadata = Object.freeze({
  projectBranchBoard: projectBranchBoardProjection,
  branchCommitQueue: branchCommitQueueProjection,
});

export const projectionIds = Object.freeze({
  projectBranchBoard: projectBranchBoardProjection.projectionId,
  branchCommitQueue: branchCommitQueueProjection.projectionId,
});

export const projectionDefinitionHashes = Object.freeze({
  reviewScope: workflowReviewModuleReadScope.definitionHash,
  projectBranchBoard: projectBranchBoardProjection.definitionHash,
  branchCommitQueue: branchCommitQueueProjection.definitionHash,
});

export type WorkflowBuiltInQuerySurfaceSpec = {
  readonly queryKind: "collection" | "scope";
  readonly sourceKind: "projection" | "scope";
  readonly surfaceId: string;
  readonly projectionId?: string;
  readonly scopeId?: string;
};

export const workflowBuiltInQuerySurfaces = Object.freeze({
  projectBranchBoard: {
    surfaceId: projectBranchBoardProjection.projectionId,
    queryKind: "collection",
    sourceKind: "projection",
    projectionId: projectBranchBoardProjection.projectionId,
  } satisfies WorkflowBuiltInQuerySurfaceSpec,
  branchCommitQueue: {
    surfaceId: branchCommitQueueProjection.projectionId,
    queryKind: "collection",
    sourceKind: "projection",
    projectionId: branchCommitQueueProjection.projectionId,
  } satisfies WorkflowBuiltInQuerySurfaceSpec,
  reviewScope: {
    surfaceId: workflowReviewModuleReadScope.scopeId,
    queryKind: "scope",
    sourceKind: "scope",
    scopeId: workflowReviewModuleReadScope.scopeId,
  } satisfies WorkflowBuiltInQuerySurfaceSpec,
});

export const workflowBuiltInQuerySurfaceIds = Object.freeze({
  projectBranchBoard: workflowBuiltInQuerySurfaces.projectBranchBoard.surfaceId,
  branchCommitQueue: workflowBuiltInQuerySurfaces.branchCommitQueue.surfaceId,
  reviewScope: workflowBuiltInQuerySurfaces.reviewScope.surfaceId,
});
