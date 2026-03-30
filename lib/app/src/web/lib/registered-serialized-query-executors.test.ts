import { describe, expect, it } from "bun:test";

import type { NormalizedQueryRequest, QueryResultPage } from "@io/graph-client";
import {
  coreBuiltInQuerySurfaceIds,
  type CoreBuiltInQuerySurfaceSpec,
} from "@io/graph-module-core";
import {
  type CommitQueueScopeQuery,
  type CommitQueueScopeResult,
  type ProjectBranchScopeQuery,
  type ProjectBranchScopeResult,
  workflowBuiltInQuerySurfaceIds,
  type WorkflowBuiltInQuerySurfaceSpec,
} from "@io/graph-module-workflow";

import {
  getInstalledModuleQuerySurface,
  installedModuleQuerySurfaceRegistry,
} from "./query-surface-registry.js";
import { createWebAppSerializedQueryExecutorRegistry } from "./registered-serialized-query-executors.js";
import {
  resolveSerializedQueryCollectionExecutor,
  resolveSerializedQueryScopeExecutor,
} from "./serialized-query-executor-registry.js";

const normalizedMetadata = {
  executionContextHash: "ctx-hash",
  executionContextJson: "{}",
  identityHash: "identity-hash",
  parameterHash: "params-hash",
  parameterJson: "[]",
  queryHash: "query-hash",
  queryJson: "{}",
  requestHash: "request-hash",
  requestJson: "{}",
} as const;

function createCollectionRequest(
  query: Extract<NormalizedQueryRequest["query"], { readonly kind: "collection" }>,
): NormalizedQueryRequest {
  return {
    version: 1,
    metadata: normalizedMetadata,
    params: [],
    query,
  };
}

function createScopeRequest(
  query: Extract<NormalizedQueryRequest["query"], { readonly kind: "scope" }>,
): NormalizedQueryRequest {
  return {
    version: 1,
    metadata: normalizedMetadata,
    params: [],
    query,
  };
}

function createScopePage(): QueryResultPage {
  return {
    kind: "scope",
    items: [],
    freshness: {
      completeness: "complete",
      freshness: "current",
    },
  };
}

function requireWorkflowSurface(surfaceId: string): WorkflowBuiltInQuerySurfaceSpec & {
  readonly moduleId: string;
} {
  const surface = getInstalledModuleQuerySurface(installedModuleQuerySurfaceRegistry, surfaceId);
  if (!surface) {
    throw new Error(`Expected installed workflow query surface "${surfaceId}".`);
  }
  return surface as WorkflowBuiltInQuerySurfaceSpec & { readonly moduleId: string };
}

function requireCoreSurface(surfaceId: string): CoreBuiltInQuerySurfaceSpec & {
  readonly moduleId: string;
} {
  const surface = getInstalledModuleQuerySurface(installedModuleQuerySurfaceRegistry, surfaceId);
  if (!surface) {
    throw new Error(`Expected installed core query surface "${surfaceId}".`);
  }
  return surface as CoreBuiltInQuerySurfaceSpec & { readonly moduleId: string };
}

describe("registered serialized query executors", () => {
  it("registers the shipped workflow collections and cross-module scopes through one factory", () => {
    const recordedScopeQueries: string[] = [];
    let recordedProjectBranchQuery: ProjectBranchScopeQuery | undefined;
    let recordedCommitQueueQuery: CommitQueueScopeQuery | undefined;
    const registry = createWebAppSerializedQueryExecutorRegistry<string>({
      executeModuleScopeQuery({ surface, options }) {
        recordedScopeQueries.push(`${surface.surfaceId}:${options}`);
        return createScopePage();
      },
      readCommitQueueScope(query, options) {
        recordedCommitQueueQuery = query;
        expect(options).toBe("authorized");
        return {
          branch: {
            branch: {
              id: "branch:1",
            },
          },
          freshness: {
            projectedAt: "2026-03-30T10:00:00.000Z",
            projectionCursor: "projection:branch:1",
          },
          nextCursor: "commit:next",
          rows: [
            {
              commit: {
                id: "commit:1",
              },
            },
          ],
        } as unknown as CommitQueueScopeResult;
      },
      readProjectBranchScope(query, options) {
        recordedProjectBranchQuery = query;
        expect(options).toBe("authorized");
        return {
          freshness: {
            projectedAt: "2026-03-30T10:00:00.000Z",
            projectionCursor: "projection:project:1",
          },
          nextCursor: "branch:next",
          project: {
            id: "project:1",
          },
          repository: {
            id: "repository:1",
          },
          rows: [
            {
              branch: {
                id: "branch:1",
              },
            },
          ],
          unmanagedRepositoryBranches: [
            {
              repositoryBranch: {
                id: "repository-branch:1",
              },
            },
          ],
        } as unknown as ProjectBranchScopeResult;
      },
      unsupported(message) {
        return new Error(message);
      },
    });

    const branchBoardSurface = requireWorkflowSurface(
      workflowBuiltInQuerySurfaceIds.projectBranchBoard,
    );
    const branchBoardResolution = resolveSerializedQueryCollectionExecutor(registry, {
      kind: "collection",
      indexId: branchBoardSurface.surfaceId,
    });
    expect(branchBoardResolution.ok).toBe(true);
    if (!branchBoardResolution.ok) {
      throw new Error("Expected workflow branch-board executor registration.");
    }

    const branchBoardPage = branchBoardResolution.executor.execute({
      normalizedRequest: createCollectionRequest({
        kind: "collection",
        indexId: branchBoardSurface.surfaceId,
        filter: {
          op: "and",
          clauses: [
            {
              op: "eq",
              fieldId: "projectId",
              value: "project:1",
            },
            {
              op: "eq",
              fieldId: "showUnmanagedRepositoryBranches",
              value: true,
            },
          ],
        },
        order: [{ fieldId: "queue-rank", direction: "asc" }],
        window: {
          limit: 2,
        },
      }),
      options: "authorized",
      pageCursor: "branch:cursor",
      surface: branchBoardResolution.surface,
    });
    expect(recordedProjectBranchQuery).toEqual({
      cursor: "branch:cursor",
      filter: {
        showUnmanagedRepositoryBranches: true,
      },
      limit: 2,
      order: [{ field: "queue-rank", direction: "asc" }],
      projectId: "project:1",
    });
    expect(branchBoardPage).toMatchObject({
      kind: "collection",
      nextCursor: "branch:next",
      freshness: {
        projectionCursor: "projection:project:1",
      },
      items: [
        {
          entityId: "branch:1",
          payload: {
            kind: "workflow-project-branch-row",
          },
        },
        {
          entityId: "repository-branch:1",
          payload: {
            kind: "workflow-unmanaged-repository-branch",
          },
        },
      ],
    });

    const commitQueueSurface = requireWorkflowSurface(
      workflowBuiltInQuerySurfaceIds.branchCommitQueue,
    );
    const commitQueueResolution = resolveSerializedQueryCollectionExecutor(registry, {
      kind: "collection",
      indexId: commitQueueSurface.surfaceId,
    });
    expect(commitQueueResolution.ok).toBe(true);
    if (!commitQueueResolution.ok) {
      throw new Error("Expected workflow commit-queue executor registration.");
    }

    const commitQueuePage = commitQueueResolution.executor.execute({
      normalizedRequest: createCollectionRequest({
        kind: "collection",
        indexId: commitQueueSurface.surfaceId,
        filter: {
          op: "eq",
          fieldId: "branchId",
          value: "branch:1",
        },
        window: {
          limit: 1,
        },
      }),
      options: "authorized",
      pageCursor: "commit:cursor",
      surface: commitQueueResolution.surface,
    });
    expect(recordedCommitQueueQuery).toEqual({
      branchId: "branch:1",
      cursor: "commit:cursor",
      limit: 1,
    });
    expect(commitQueuePage).toMatchObject({
      kind: "collection",
      nextCursor: "commit:next",
      items: [
        {
          entityId: "commit:1",
          payload: {
            kind: "workflow-commit-queue-row",
          },
        },
      ],
    });

    const workflowScopeResolution = resolveSerializedQueryScopeExecutor(registry, {
      kind: "scope",
      scopeId: workflowBuiltInQuerySurfaceIds.reviewScope,
    });
    expect(workflowScopeResolution.ok).toBe(true);
    if (!workflowScopeResolution.ok) {
      throw new Error("Expected workflow scope executor registration.");
    }
    workflowScopeResolution.executor.execute({
      normalizedRequest: createScopeRequest({
        kind: "scope",
        scopeId: workflowBuiltInQuerySurfaceIds.reviewScope,
      }),
      options: "authorized",
      surface: workflowScopeResolution.surface,
    });

    const coreScopeSurface = requireCoreSurface(coreBuiltInQuerySurfaceIds.catalogScope);
    const coreScopeResolution = resolveSerializedQueryScopeExecutor(registry, {
      kind: "scope",
      scopeId: coreScopeSurface.surfaceId,
    });
    expect(coreScopeResolution.ok).toBe(true);
    if (!coreScopeResolution.ok) {
      throw new Error("Expected core scope executor registration.");
    }
    coreScopeResolution.executor.execute({
      normalizedRequest: createScopeRequest({
        kind: "scope",
        definition: {
          kind: "module",
          moduleIds: [coreScopeSurface.moduleId],
          scopeId: coreScopeSurface.surfaceId,
        },
      }),
      options: "authorized",
      surface: coreScopeResolution.surface,
    });

    expect(recordedScopeQueries).toEqual([
      `${workflowBuiltInQuerySurfaceIds.reviewScope}:authorized`,
      `${coreBuiltInQuerySurfaceIds.catalogScope}:authorized`,
    ]);
  });

  it("fails closed on unsupported collection shapes and windowed scope pagination before dispatch", () => {
    const registry = createWebAppSerializedQueryExecutorRegistry<string>({
      executeModuleScopeQuery() {
        throw new Error("Module-scope executor should not run for rejected requests.");
      },
      readCommitQueueScope() {
        throw new Error("Commit-queue executor should not run for rejected requests.");
      },
      readProjectBranchScope() {
        throw new Error("Project-branch executor should not run for rejected requests.");
      },
      unsupported(message) {
        return new Error(message);
      },
    });

    const branchBoardResolution = resolveSerializedQueryCollectionExecutor(registry, {
      kind: "collection",
      indexId: workflowBuiltInQuerySurfaceIds.projectBranchBoard,
    });
    if (!branchBoardResolution.ok) {
      throw new Error("Expected workflow branch-board executor registration.");
    }
    expect(() =>
      branchBoardResolution.executor.execute({
        normalizedRequest: createCollectionRequest({
          kind: "collection",
          indexId: workflowBuiltInQuerySurfaceIds.projectBranchBoard,
        }),
        options: "authorized",
        pageCursor: undefined,
        surface: branchBoardResolution.surface,
      }),
    ).toThrow(
      `Collection query "${workflowBuiltInQuerySurfaceIds.projectBranchBoard}" requires an equality filter for "projectId".`,
    );

    const scopeResolution = resolveSerializedQueryScopeExecutor(registry, {
      kind: "scope",
      scopeId: coreBuiltInQuerySurfaceIds.catalogScope,
    });
    if (!scopeResolution.ok) {
      throw new Error("Expected core scope executor registration.");
    }
    expect(() =>
      scopeResolution.executor.execute({
        normalizedRequest: createScopeRequest({
          kind: "scope",
          scopeId: coreBuiltInQuerySurfaceIds.catalogScope,
          window: {
            limit: 1,
          },
        }),
        options: "authorized",
        surface: scopeResolution.surface,
      }),
    ).toThrow(
      `Scope query "${coreBuiltInQuerySurfaceIds.catalogScope}" does not support windowed pagination.`,
    );
  });
});
