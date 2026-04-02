import type { QueryResultPage } from "@io/graph-client";
import type { NormalizedQueryRequest } from "@io/graph-client";

import { branchStateValues } from "./command.js";
import {
  type CommitQueueScopeQuery,
  type CommitQueueScopeResult,
  type ProjectBranchScopeQuery,
  type ProjectBranchScopeResult,
} from "./query.js";
import { projectBranchScopeOrderFieldValues } from "./query.js";
import {
  workflowBuiltInQuerySurfaces,
  type WorkflowBuiltInQuerySurfaceSpec,
} from "./projection.js";

export type WorkflowQueryExecutorDependencies<_ReadOptions> = {
  readonly executeModuleScopeQuery: (context: any) => QueryResultPage;
  readonly readCommitQueueScope: (
    query: CommitQueueScopeQuery,
    options: _ReadOptions,
  ) => CommitQueueScopeResult;
  readonly readProjectBranchScope: (
    query: ProjectBranchScopeQuery,
    options: _ReadOptions,
  ) => ProjectBranchScopeResult;
  readonly unsupported: (message: string) => Error;
};

type WorkflowInstalledQuerySurface = Pick<
  WorkflowBuiltInQuerySurfaceSpec,
  "queryKind" | "surfaceId" | "surfaceVersion"
>;

type WorkflowQueryExecutorRegistration<_ReadOptions> = {
  readonly execute: (context: any) => QueryResultPage;
  readonly queryKind: "collection" | "scope";
  readonly surfaceId: string;
  readonly surfaceVersion: string;
};

const defaultWorkflowInstalledQuerySurfaces = Object.freeze([
  workflowBuiltInQuerySurfaces.projectBranchBoard,
  workflowBuiltInQuerySurfaces.branchCommitQueue,
  workflowBuiltInQuerySurfaces.reviewScope,
] satisfies readonly WorkflowInstalledQuerySurface[]);

function getInstalledWorkflowSurface(
  surfaces: readonly WorkflowInstalledQuerySurface[],
  input: Pick<WorkflowQueryExecutorRegistration<never>, "queryKind" | "surfaceId">,
): Pick<WorkflowQueryExecutorRegistration<never>, "surfaceId" | "surfaceVersion"> | undefined {
  const surface = surfaces.find(
    (candidate) =>
      candidate.queryKind === input.queryKind && candidate.surfaceId === input.surfaceId,
  );
  return surface
    ? {
        surfaceId: surface.surfaceId,
        surfaceVersion: surface.surfaceVersion,
      }
    : undefined;
}

function requireStringQueryLiteral(
  value: unknown,
  label: string,
  unsupported: (message: string) => Error,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw unsupported(`${label} must resolve to a non-empty string.`);
  }
  return value;
}

function requireBooleanQueryLiteral(
  value: unknown,
  label: string,
  unsupported: (message: string) => Error,
): boolean {
  if (typeof value !== "boolean") {
    throw unsupported(`${label} must resolve to a boolean.`);
  }
  return value;
}

function planWorkflowProjectBranchCollectionQuery(
  query: Extract<NormalizedQueryRequest["query"], { readonly kind: "collection" }>,
  pageCursor: string | undefined,
  unsupported: (message: string) => Error,
): ProjectBranchScopeQuery {
  let projectId: string | undefined;
  const states = new Set<(typeof branchStateValues)[number]>();
  let hasActiveCommit: boolean | undefined;
  let showUnmanagedRepositoryBranches: boolean | undefined;

  const applyFilter = (filter: typeof query.filter): void => {
    if (!filter) {
      return;
    }
    if (filter.op === "and") {
      for (const clause of filter.clauses) {
        applyFilter(clause);
      }
      return;
    }
    if (filter.op === "eq") {
      if (filter.fieldId === "projectId") {
        projectId = requireStringQueryLiteral(
          filter.value,
          'Collection filter "projectId"',
          unsupported,
        );
        return;
      }
      if (filter.fieldId === "state") {
        const state = requireStringQueryLiteral(
          filter.value,
          'Collection filter "state"',
          unsupported,
        );
        if (!branchStateValues.includes(state as (typeof branchStateValues)[number])) {
          throw unsupported(
            `Collection filter "state" must be one of: ${branchStateValues.join(", ")}.`,
          );
        }
        states.add(state as (typeof branchStateValues)[number]);
        return;
      }
      if (filter.fieldId === "hasActiveCommit") {
        hasActiveCommit = requireBooleanQueryLiteral(
          filter.value,
          'Collection filter "hasActiveCommit"',
          unsupported,
        );
        return;
      }
      if (filter.fieldId === "showUnmanagedRepositoryBranches") {
        showUnmanagedRepositoryBranches = requireBooleanQueryLiteral(
          filter.value,
          'Collection filter "showUnmanagedRepositoryBranches"',
          unsupported,
        );
        return;
      }
    }
    if (filter.op === "in" && filter.fieldId === "state") {
      for (const value of filter.values) {
        const state = requireStringQueryLiteral(value, 'Collection filter "state"', unsupported);
        if (!branchStateValues.includes(state as (typeof branchStateValues)[number])) {
          throw unsupported(
            `Collection filter "state" must be one of: ${branchStateValues.join(", ")}.`,
          );
        }
        states.add(state as (typeof branchStateValues)[number]);
      }
      return;
    }

    throw unsupported(
      `Collection query "${query.indexId}" only supports "and", "eq", and "in" filters over projectId, state, hasActiveCommit, and showUnmanagedRepositoryBranches.`,
    );
  };

  applyFilter(query.filter);

  if (!projectId) {
    throw unsupported(
      `Collection query "${query.indexId}" requires an equality filter for "projectId".`,
    );
  }

  const order = query.order?.map((clause) => {
    if (
      !projectBranchScopeOrderFieldValues.includes(
        clause.fieldId as (typeof projectBranchScopeOrderFieldValues)[number],
      )
    ) {
      throw unsupported(
        `Collection query "${query.indexId}" only supports order fields: ${projectBranchScopeOrderFieldValues.join(", ")}.`,
      );
    }

    return {
      field: clause.fieldId as (typeof projectBranchScopeOrderFieldValues)[number],
      direction: clause.direction,
    };
  });

  return {
    projectId,
    ...(pageCursor ? { cursor: pageCursor } : {}),
    ...(query.window ? { limit: query.window.limit } : {}),
    ...(order ? { order } : {}),
    ...(states.size > 0 ||
    hasActiveCommit !== undefined ||
    showUnmanagedRepositoryBranches !== undefined
      ? {
          filter: {
            ...(states.size > 0 ? { states: [...states] } : {}),
            ...(hasActiveCommit !== undefined ? { hasActiveCommit } : {}),
            ...(showUnmanagedRepositoryBranches !== undefined
              ? { showUnmanagedRepositoryBranches }
              : {}),
          },
        }
      : {}),
  };
}

function planWorkflowCommitQueueCollectionQuery(
  query: Extract<NormalizedQueryRequest["query"], { readonly kind: "collection" }>,
  pageCursor: string | undefined,
  unsupported: (message: string) => Error,
): CommitQueueScopeQuery {
  let branchId: string | undefined;

  const applyFilter = (filter: typeof query.filter): void => {
    if (!filter) {
      return;
    }
    if (filter.op === "and") {
      for (const clause of filter.clauses) {
        applyFilter(clause);
      }
      return;
    }
    if (filter.op === "eq" && filter.fieldId === "branchId") {
      branchId = requireStringQueryLiteral(
        filter.value,
        'Collection filter "branchId"',
        unsupported,
      );
      return;
    }

    throw unsupported(
      `Collection query "${query.indexId}" only supports an equality filter for "branchId".`,
    );
  };

  if (query.order && query.order.length > 0) {
    throw unsupported(`Collection query "${query.indexId}" does not support custom ordering.`);
  }

  applyFilter(query.filter);

  if (!branchId) {
    throw unsupported(
      `Collection query "${query.indexId}" requires an equality filter for "branchId".`,
    );
  }

  return {
    branchId,
    ...(pageCursor ? { cursor: pageCursor } : {}),
    ...(query.window ? { limit: query.window.limit } : {}),
  };
}

function mapWorkflowProjectBranchCollectionResult(
  result: ProjectBranchScopeResult,
): QueryResultPage {
  return {
    kind: "collection",
    items: [
      ...result.rows.map((row) => ({
        key: row.branch.id,
        entityId: row.branch.id,
        payload: {
          kind: "workflow-project-branch-row",
          project: result.project,
          repository: result.repository,
          row,
        },
      })),
      ...result.unmanagedRepositoryBranches.map((row) => ({
        key: `repository-branch:${row.repositoryBranch.id}`,
        entityId: row.repositoryBranch.id,
        payload: {
          kind: "workflow-unmanaged-repository-branch",
          project: result.project,
          repository: result.repository,
          row,
        },
      })),
    ],
    ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
    freshness: {
      completeness: "complete",
      freshness: "current",
      projectedAt: result.freshness.projectedAt,
      projectionCursor: result.freshness.projectionCursor,
    },
  };
}

function mapWorkflowCommitQueueCollectionResult(result: CommitQueueScopeResult): QueryResultPage {
  return {
    kind: "collection",
    items: result.rows.map((row) => ({
      key: row.commit.id,
      entityId: row.commit.id,
      payload: {
        kind: "workflow-commit-queue-row",
        branch: result.branch,
        row,
      },
    })),
    ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
    freshness: {
      completeness: "complete",
      freshness: "current",
      projectedAt: result.freshness.projectedAt,
      projectionCursor: result.freshness.projectionCursor,
    },
  };
}

function createWorkflowModuleScopeExecutor<ReadOptions>(
  surface: Pick<WorkflowQueryExecutorRegistration<ReadOptions>, "surfaceId" | "surfaceVersion">,
  dependencies: WorkflowQueryExecutorDependencies<ReadOptions>,
): WorkflowQueryExecutorRegistration<ReadOptions> {
  return {
    queryKind: "scope",
    surfaceId: surface.surfaceId,
    surfaceVersion: surface.surfaceVersion,
    execute(context) {
      if (context.normalizedRequest.query.window) {
        throw dependencies.unsupported(
          `Scope query "${context.normalizedRequest.query.scopeId ?? "inline"}" does not support windowed pagination.`,
        );
      }

      return dependencies.executeModuleScopeQuery(context);
    },
  };
}

export function createWorkflowQueryExecutorRegistrations<ReadOptions>(
  dependencies: WorkflowQueryExecutorDependencies<ReadOptions>,
  installedSurfaces: readonly WorkflowInstalledQuerySurface[] = defaultWorkflowInstalledQuerySurfaces,
): readonly WorkflowQueryExecutorRegistration<ReadOptions>[] {
  const registrations: WorkflowQueryExecutorRegistration<ReadOptions>[] = [];

  const projectBranchBoardSurface = getInstalledWorkflowSurface(installedSurfaces, {
    queryKind: "collection",
    surfaceId: workflowBuiltInQuerySurfaces.projectBranchBoard.surfaceId,
  });
  if (projectBranchBoardSurface) {
    registrations.push({
      queryKind: "collection",
      surfaceId: projectBranchBoardSurface.surfaceId,
      surfaceVersion: projectBranchBoardSurface.surfaceVersion,
      execute({ normalizedRequest, options, pageCursor }) {
        return mapWorkflowProjectBranchCollectionResult(
          dependencies.readProjectBranchScope(
            planWorkflowProjectBranchCollectionQuery(
              normalizedRequest.query,
              pageCursor,
              dependencies.unsupported,
            ),
            options,
          ),
        );
      },
    });
  }

  const branchCommitQueueSurface = getInstalledWorkflowSurface(installedSurfaces, {
    queryKind: "collection",
    surfaceId: workflowBuiltInQuerySurfaces.branchCommitQueue.surfaceId,
  });
  if (branchCommitQueueSurface) {
    registrations.push({
      queryKind: "collection",
      surfaceId: branchCommitQueueSurface.surfaceId,
      surfaceVersion: branchCommitQueueSurface.surfaceVersion,
      execute({ normalizedRequest, options, pageCursor }) {
        return mapWorkflowCommitQueueCollectionResult(
          dependencies.readCommitQueueScope(
            planWorkflowCommitQueueCollectionQuery(
              normalizedRequest.query,
              pageCursor,
              dependencies.unsupported,
            ),
            options,
          ),
        );
      },
    });
  }

  const reviewScopeSurface = getInstalledWorkflowSurface(installedSurfaces, {
    queryKind: "scope",
    surfaceId: workflowBuiltInQuerySurfaces.reviewScope.surfaceId,
  });
  if (reviewScopeSurface) {
    registrations.push(createWorkflowModuleScopeExecutor(reviewScopeSurface, dependencies));
  }

  return registrations;
}
