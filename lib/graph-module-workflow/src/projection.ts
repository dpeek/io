import {
  createModuleReadScopeRequest,
  createProjectionDependencyKey,
  createScopeDependencyKey,
  defineInvalidationEvent,
  defineModuleQuerySurfaceCatalog,
  defineModuleQuerySurfaceSpec,
  defineModuleReadScopeDefinition,
  defineProjectionCatalog,
  defineProjectionSpec,
  type DependencyKey,
  type InvalidationEvent,
  type ModuleQuerySurfaceSpec,
} from "@io/graph-projection";

import { branchStateValues } from "./command.js";
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

function titleCaseWord(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

const workflowQueryRendererIds = ["core:list", "core:table", "core:card-grid"] as const;

const workflowBranchStateOptions = Object.freeze(
  branchStateValues.map((state) => ({
    label: titleCaseWord(state),
    value: state,
  })),
);

const projectBranchBoardQuerySurface = defineModuleQuerySurfaceSpec({
  surfaceId: projectBranchBoardProjection.projectionId,
  surfaceVersion: "query-surface:workflow:project-branch-board:v1",
  label: "Workflow Branch Board",
  description:
    "Projection-backed workflow branch board with planner-visible filters, ordering, selections, parameters, and renderer compatibility.",
  queryKind: "collection",
  source: {
    kind: "projection",
    projectionId: projectBranchBoardProjection.projectionId,
  },
  defaultPageSize: 25,
  filters: [
    {
      fieldId: "projectId",
      kind: "entity-ref",
      label: "Project",
      operators: ["eq"],
    },
    {
      fieldId: "state",
      kind: "enum",
      label: "State",
      operators: ["eq", "in"],
      options: workflowBranchStateOptions,
    },
    {
      fieldId: "hasActiveCommit",
      kind: "boolean",
      label: "Has Active Commit",
      operators: ["eq"],
    },
    {
      fieldId: "showUnmanagedRepositoryBranches",
      kind: "boolean",
      label: "Show Unmanaged Repository Branches",
      operators: ["eq"],
    },
  ],
  ordering: [
    {
      fieldId: "queue-rank",
      label: "Queue Rank",
      directions: ["asc", "desc"],
    },
    {
      fieldId: "updated-at",
      label: "Updated",
      directions: ["asc", "desc"],
    },
    {
      fieldId: "created-at",
      label: "Created",
      directions: ["asc", "desc"],
    },
    {
      fieldId: "title",
      label: "Title",
      directions: ["asc", "desc"],
    },
    {
      fieldId: "state",
      label: "State",
      directions: ["asc", "desc"],
    },
  ],
  selections: [
    {
      fieldId: "title",
      label: "Title",
      defaultSelected: true,
    },
    {
      fieldId: "state",
      label: "State",
      defaultSelected: true,
    },
    {
      fieldId: "queueRank",
      label: "Queue Rank",
      defaultSelected: true,
    },
    {
      fieldId: "hasActiveCommit",
      label: "Has Active Commit",
    },
    {
      fieldId: "repositoryFreshness",
      label: "Repository Freshness",
    },
    {
      fieldId: "updatedAt",
      label: "Updated",
    },
  ],
  parameters: [
    {
      name: "project-id",
      label: "Project",
      type: "entity-ref",
      required: true,
    },
    {
      name: "state",
      label: "State",
      type: "enum",
    },
    {
      name: "has-active-commit",
      label: "Has Active Commit",
      type: "boolean",
    },
    {
      name: "show-unmanaged-repository-branches",
      label: "Show Unmanaged Repository Branches",
      type: "boolean",
      defaultValue: false,
    },
  ],
  renderers: {
    compatibleRendererIds: workflowQueryRendererIds,
    itemEntityIds: "required",
    resultKind: "collection",
    sourceKinds: ["saved", "inline"],
  },
});

const branchCommitQueueQuerySurface = defineModuleQuerySurfaceSpec({
  surfaceId: branchCommitQueueProjection.projectionId,
  surfaceVersion: "query-surface:workflow:branch-commit-queue:v1",
  label: "Branch Commit Queue",
  description:
    "Projection-backed commit queue with one required branch filter and fixed queue ordering.",
  queryKind: "collection",
  source: {
    kind: "projection",
    projectionId: branchCommitQueueProjection.projectionId,
  },
  defaultPageSize: 50,
  filters: [
    {
      fieldId: "branchId",
      kind: "entity-ref",
      label: "Branch",
      operators: ["eq"],
    },
  ],
  selections: [
    {
      fieldId: "title",
      label: "Title",
      defaultSelected: true,
    },
    {
      fieldId: "state",
      label: "State",
      defaultSelected: true,
    },
    {
      fieldId: "order",
      label: "Order",
      defaultSelected: true,
    },
    {
      fieldId: "updatedAt",
      label: "Updated",
    },
  ],
  parameters: [
    {
      name: "branch-id",
      label: "Branch",
      type: "entity-ref",
      required: true,
    },
  ],
  renderers: {
    compatibleRendererIds: workflowQueryRendererIds,
    itemEntityIds: "required",
    resultKind: "collection",
    sourceKinds: ["saved", "inline"],
  },
});

const reviewScopeQuerySurface = defineModuleQuerySurfaceSpec({
  surfaceId: workflowReviewModuleReadScope.scopeId,
  surfaceVersion: "query-surface:workflow:review-scope:v1",
  label: "Workflow Review Scope",
  description:
    "Module review scope bootstrap surface used by the planner and live scope refresh path.",
  queryKind: "scope",
  source: {
    kind: "scope",
    scopeId: workflowReviewModuleReadScope.scopeId,
  },
  renderers: {
    compatibleRendererIds: ["core:list", "core:table"],
    itemEntityIds: "required",
    resultKind: "scope",
    sourceKinds: ["saved", "inline"],
  },
});

export const workflowQuerySurfaceCatalog = defineModuleQuerySurfaceCatalog({
  catalogId: "workflow:query-surfaces",
  catalogVersion: "query-catalog:workflow:v1",
  moduleId: workflowModuleId,
  surfaces: [
    projectBranchBoardQuerySurface,
    branchCommitQueueQuerySurface,
    reviewScopeQuerySurface,
  ],
});

export type WorkflowBuiltInQuerySurfaceSpec = ModuleQuerySurfaceSpec;

export const workflowBuiltInQuerySurfaces = Object.freeze({
  projectBranchBoard: projectBranchBoardQuerySurface,
  branchCommitQueue: branchCommitQueueQuerySurface,
  reviewScope: reviewScopeQuerySurface,
});

export const workflowBuiltInQuerySurfaceIds = Object.freeze({
  projectBranchBoard: workflowBuiltInQuerySurfaces.projectBranchBoard.surfaceId,
  branchCommitQueue: workflowBuiltInQuerySurfaces.branchCommitQueue.surfaceId,
  reviewScope: workflowBuiltInQuerySurfaces.reviewScope.surfaceId,
});
