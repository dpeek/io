import { describe, expect, it } from "bun:test";

import type { QueryResultPage } from "@io/graph-client";
import { coreBuiltInQuerySurfaceIds } from "@io/graph-module-core";
import { workflowBuiltInQuerySurfaceIds } from "@io/graph-module-workflow";

import {
  type InstalledModuleQuerySurface,
  type InstalledModuleQuerySurfaceRegistry,
  getInstalledModuleQuerySurface,
  installedModuleQuerySurfaceRegistry,
} from "./query-surface-registry.js";
import {
  createSerializedQueryExecutorRegistry,
  resolveSerializedQueryCollectionExecutor,
  resolveSerializedQueryScopeExecutor,
} from "./serialized-query-executor-registry.js";

function createCollectionPage(_context?: unknown): QueryResultPage {
  return {
    kind: "collection",
    items: [],
    freshness: {
      completeness: "complete",
      freshness: "current",
    },
  };
}

function createScopePage(_context?: unknown): QueryResultPage {
  return {
    kind: "scope",
    items: [],
    freshness: {
      completeness: "complete",
      freshness: "current",
    },
  };
}

function requireInstalledSurface(surfaceId: string): InstalledModuleQuerySurface {
  const surface = getInstalledModuleQuerySurface(installedModuleQuerySurfaceRegistry, surfaceId);
  if (!surface) {
    throw new Error(`Expected installed query surface "${surfaceId}".`);
  }
  return surface;
}

function createSurfaceRegistry(
  surfaces: readonly InstalledModuleQuerySurface[],
): InstalledModuleQuerySurfaceRegistry {
  return {
    catalogs: [],
    surfaces,
    surfaceById: new Map(surfaces.map((surface) => [surface.surfaceId, surface])),
  };
}

describe("serialized query executor registry", () => {
  it("resolves collection executors from installed query surfaces", () => {
    const surface = requireInstalledSurface(workflowBuiltInQuerySurfaceIds.projectBranchBoard);
    const registry = createSerializedQueryExecutorRegistry(installedModuleQuerySurfaceRegistry, [
      {
        queryKind: "collection",
        surfaceId: surface.surfaceId,
        surfaceVersion: surface.surfaceVersion,
        execute: createCollectionPage,
      },
    ]);

    const resolution = resolveSerializedQueryCollectionExecutor(registry, {
      kind: "collection",
      indexId: surface.surfaceId,
    });

    expect(resolution).toMatchObject({
      ok: true,
      surface: {
        surfaceId: surface.surfaceId,
        surfaceVersion: surface.surfaceVersion,
      },
    });
  });

  it("fails closed for unregistered, missing, and stale collection executors", () => {
    const surface = requireInstalledSurface(workflowBuiltInQuerySurfaceIds.projectBranchBoard);

    const unregistered = resolveSerializedQueryCollectionExecutor(
      createSerializedQueryExecutorRegistry(installedModuleQuerySurfaceRegistry, []),
      {
        kind: "collection",
        indexId: "workflow:missing-surface",
      },
    );
    expect(unregistered).toMatchObject({
      ok: false,
      code: "unregistered-surface",
      queryKind: "collection",
    });

    const missing = resolveSerializedQueryCollectionExecutor(
      createSerializedQueryExecutorRegistry(installedModuleQuerySurfaceRegistry, []),
      {
        kind: "collection",
        indexId: surface.surfaceId,
      },
    );
    expect(missing).toMatchObject({
      ok: false,
      code: "missing-executor",
      queryKind: "collection",
      surface: {
        surfaceId: surface.surfaceId,
      },
    });

    const stale = resolveSerializedQueryCollectionExecutor(
      createSerializedQueryExecutorRegistry(installedModuleQuerySurfaceRegistry, [
        {
          queryKind: "collection",
          surfaceId: surface.surfaceId,
          surfaceVersion: `${surface.surfaceVersion}:stale`,
          execute: createCollectionPage,
        },
      ]),
      {
        kind: "collection",
        indexId: surface.surfaceId,
      },
    );
    expect(stale).toMatchObject({
      ok: false,
      code: "stale-executor",
      queryKind: "collection",
      surface: {
        surfaceId: surface.surfaceId,
        surfaceVersion: surface.surfaceVersion,
      },
      executor: {
        surfaceId: surface.surfaceId,
        surfaceVersion: `${surface.surfaceVersion}:stale`,
      },
    });
  });

  it("resolves scope executors from registered scope ids and inline module definitions across modules", () => {
    const workflowSurface = requireInstalledSurface(workflowBuiltInQuerySurfaceIds.reviewScope);
    if (workflowSurface.queryKind !== "scope" || workflowSurface.source.kind !== "scope") {
      throw new Error(`Expected scope query surface "${workflowSurface.surfaceId}".`);
    }
    const coreSurface = requireInstalledSurface(coreBuiltInQuerySurfaceIds.catalogScope);
    if (coreSurface.queryKind !== "scope" || coreSurface.source.kind !== "scope") {
      throw new Error(`Expected scope query surface "${coreSurface.surfaceId}".`);
    }

    const registry = createSerializedQueryExecutorRegistry(installedModuleQuerySurfaceRegistry, [
      {
        queryKind: "scope",
        surfaceId: workflowSurface.surfaceId,
        surfaceVersion: workflowSurface.surfaceVersion,
        execute: createScopePage,
      },
      {
        queryKind: "scope",
        surfaceId: coreSurface.surfaceId,
        surfaceVersion: coreSurface.surfaceVersion,
        execute: createScopePage,
      },
    ]);

    const byScopeId = resolveSerializedQueryScopeExecutor(registry, {
      kind: "scope",
      scopeId: workflowSurface.surfaceId,
    });
    expect(byScopeId).toMatchObject({
      ok: true,
      surface: {
        surfaceId: workflowSurface.surfaceId,
      },
    });

    const byWorkflowDefinition = resolveSerializedQueryScopeExecutor(registry, {
      kind: "scope",
      definition: {
        kind: "module",
        moduleIds: [workflowSurface.moduleId],
        scopeId: workflowSurface.source.scopeId,
      },
    });
    expect(byWorkflowDefinition).toMatchObject({
      ok: true,
      surface: {
        surfaceId: workflowSurface.surfaceId,
      },
    });

    const byCoreDefinition = resolveSerializedQueryScopeExecutor(registry, {
      kind: "scope",
      definition: {
        kind: "module",
        moduleIds: [coreSurface.moduleId],
        scopeId: coreSurface.source.scopeId,
      },
    });
    expect(byCoreDefinition).toMatchObject({
      ok: true,
      surface: {
        surfaceId: coreSurface.surfaceId,
      },
    });
  });

  it("fails closed for ambiguous scope registrations and duplicate executors", () => {
    const surface = requireInstalledSurface(workflowBuiltInQuerySurfaceIds.reviewScope);
    if (surface.queryKind !== "scope" || surface.source.kind !== "scope") {
      throw new Error(`Expected scope query surface "${surface.surfaceId}".`);
    }

    const ambiguousRegistry = createSurfaceRegistry([
      {
        ...surface,
        surfaceId: "workflow:review-scope:copy-a",
      },
      {
        ...surface,
        surfaceId: "workflow:review-scope:copy-b",
      },
    ]);
    const ambiguous = resolveSerializedQueryScopeExecutor(
      createSerializedQueryExecutorRegistry(ambiguousRegistry, []),
      {
        kind: "scope",
        definition: {
          kind: "module",
          moduleIds: [surface.moduleId],
        },
      },
    );

    expect(ambiguous).toMatchObject({
      ok: false,
      code: "ambiguous-surface",
      queryKind: "scope",
    });
    if (ambiguous.ok) {
      throw new Error("Expected ambiguous scope executor resolution to fail.");
    }
    expect(ambiguous.surfaces.map((entry) => entry.surfaceId)).toEqual([
      "workflow:review-scope:copy-a",
      "workflow:review-scope:copy-b",
    ]);

    expect(() =>
      createSerializedQueryExecutorRegistry(installedModuleQuerySurfaceRegistry, [
        {
          queryKind: "scope",
          surfaceId: surface.surfaceId,
          surfaceVersion: surface.surfaceVersion,
          execute: createScopePage,
        },
        {
          queryKind: "scope",
          surfaceId: surface.surfaceId,
          surfaceVersion: surface.surfaceVersion,
          execute: createScopePage,
        },
      ]),
    ).toThrow(
      `Serialized-query executor registrations must not duplicate scope surface "${surface.surfaceId}".`,
    );
  });
});
