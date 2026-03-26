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

import opsIds from "../../ops.json";
import { pkm } from "../../pkm.js";
import {
  agentSession,
  agentSessionEvent,
  contextBundle,
  contextBundleEntry,
  repositoryBranch,
  repositoryCommit,
  workflowArtifact,
  workflowBranch,
  workflowCommit,
  workflowDecision,
  workflowProject,
  workflowRepository,
} from "./type.js";

const opsTypeIds = opsIds.keys as Record<string, string>;

export const workflowModuleId = "ops/workflow";
const workflowProjectBranchBoardProjectionId = "ops/workflow:project-branch-board";
const workflowBranchCommitQueueProjectionId = "ops/workflow:branch-commit-queue";
const emptyDependencyKeys = Object.freeze([]) as readonly DependencyKey[];

function typeIdentityKeys(typeDef: {
  readonly values: { readonly id?: string; readonly key: string };
}): readonly string[] {
  const keys = [typeDef.values.key];
  const resolvedId = opsTypeIds[typeDef.values.key];
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
  scopeId: "scope:ops/workflow:review",
  definitionHash: "scope-def:ops/workflow:review:v1",
});

export const workflowReviewSyncScopeRequest = createModuleReadScopeRequest(
  workflowReviewModuleReadScope,
);

export const workflowReviewScopeDependencyKey = createScopeDependencyKey(
  workflowReviewModuleReadScope.scopeId,
);

export const workflowProjectBranchBoardProjectionDependencyKey = createProjectionDependencyKey(
  workflowProjectBranchBoardProjectionId,
);

export const workflowBranchCommitQueueProjectionDependencyKey = createProjectionDependencyKey(
  workflowBranchCommitQueueProjectionId,
);

export const workflowProjectBranchBoardProjection = defineProjectionSpec({
  projectionId: workflowProjectBranchBoardProjectionId,
  kind: "collection-index",
  definitionHash: "projection-def:ops/workflow:project-branch-board:v1",
  sourceScopeKinds: ["module"],
  dependencyKeys: [
    workflowProjectBranchBoardProjectionDependencyKey,
    workflowReviewScopeDependencyKey,
  ],
  rebuildStrategy: "full",
  visibilityMode: "policy-filtered",
});

export const workflowBranchCommitQueueProjection = defineProjectionSpec({
  projectionId: workflowBranchCommitQueueProjectionId,
  kind: "collection-index",
  definitionHash: "projection-def:ops/workflow:branch-commit-queue:v1",
  sourceScopeKinds: ["module"],
  dependencyKeys: [
    workflowBranchCommitQueueProjectionDependencyKey,
    workflowReviewScopeDependencyKey,
  ],
  rebuildStrategy: "full",
  visibilityMode: "policy-filtered",
});

const workflowReviewInvalidationProjectionIds = Object.freeze([
  workflowProjectBranchBoardProjection.projectionId,
  workflowBranchCommitQueueProjection.projectionId,
] as const);

const workflowReviewAffectedScopeIds = Object.freeze([
  workflowReviewModuleReadScope.scopeId,
] as const);

const workflowReviewInvalidationTypeIds = new Set(
  [
    workflowProject,
    workflowRepository,
    workflowBranch,
    workflowCommit,
    repositoryBranch,
    repositoryCommit,
    agentSession,
    agentSessionEvent,
    workflowArtifact,
    workflowDecision,
    contextBundle,
    contextBundleEntry,
    pkm.document,
  ].flatMap((typeDef) => typeIdentityKeys(typeDef)),
);

export const workflowReviewDependencyKeys = Object.freeze([
  workflowReviewScopeDependencyKey,
  workflowProjectBranchBoardProjectionDependencyKey,
  workflowBranchCommitQueueProjectionDependencyKey,
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

export const workflowProjectionCatalog = defineProjectionCatalog([
  workflowProjectBranchBoardProjection,
  workflowBranchCommitQueueProjection,
] as const);

export const workflowProjectionMetadata = Object.freeze({
  projectBranchBoard: workflowProjectBranchBoardProjection,
  branchCommitQueue: workflowBranchCommitQueueProjection,
});

export const workflowProjectionIds = Object.freeze({
  projectBranchBoard: workflowProjectBranchBoardProjection.projectionId,
  branchCommitQueue: workflowBranchCommitQueueProjection.projectionId,
});

export const workflowProjectionDefinitionHashes = Object.freeze({
  reviewScope: workflowReviewModuleReadScope.definitionHash,
  projectBranchBoard: workflowProjectBranchBoardProjection.definitionHash,
  branchCommitQueue: workflowBranchCommitQueueProjection.definitionHash,
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
    surfaceId: workflowProjectBranchBoardProjection.projectionId,
    queryKind: "collection",
    sourceKind: "projection",
    projectionId: workflowProjectBranchBoardProjection.projectionId,
  } satisfies WorkflowBuiltInQuerySurfaceSpec,
  branchCommitQueue: {
    surfaceId: workflowBranchCommitQueueProjection.projectionId,
    queryKind: "collection",
    sourceKind: "projection",
    projectionId: workflowBranchCommitQueueProjection.projectionId,
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
