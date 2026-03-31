import { describe, expect, it } from "bun:test";

import { serializedQueryVersion } from "@io/graph-client";
import type { CollectionSurfaceSpec } from "@io/graph-module";

import {
  builtInQueryRendererRegistry,
  createQueryRendererCapabilityMap,
} from "../components/query-renderers.js";
import { resolveCollectionSurfaceBinding } from "./collection-surface.js";
import {
  createInstalledModuleQuerySurfaceRegistry,
  createQueryEditorCatalogFromRegistry,
  getInstalledModuleQuerySurface,
  getInstalledModuleQuerySurfaceRegistry,
} from "./query-surface-registry.js";
import type { SavedQueryRecord } from "./saved-query.js";

const rendererCapabilities = createQueryRendererCapabilityMap(builtInQueryRendererRegistry);

function createSavedQueryRecord(input: {
  readonly catalogId: string;
  readonly catalogVersion: string;
  readonly id: string;
  readonly surfaceId: string;
  readonly surfaceVersion: string;
}): SavedQueryRecord {
  return {
    catalogId: input.catalogId,
    catalogVersion: input.catalogVersion,
    id: input.id,
    name: input.id,
    parameterDefinitions: [],
    request: {
      version: serializedQueryVersion,
      query: {
        kind: "collection",
        indexId: input.surfaceId,
        window: {
          limit: 25,
        },
      },
    },
    surfaceId: input.surfaceId,
    surfaceVersion: input.surfaceVersion,
    updatedAt: "2026-04-01T00:00:00.000Z",
  };
}

function requireTableColumns(result: Awaited<ReturnType<typeof resolveCollectionSurfaceBinding>>) {
  if (!result.ok) {
    throw new Error(result.issue.message);
  }
  const definition = result.binding.spec.renderer.definition;
  if (!definition || definition.kind !== "table") {
    throw new Error("Expected a table renderer definition.");
  }
  return definition.columns;
}

describe("collection surface binding", () => {
  it("uses default-selected query-surface fields for table presentations", async () => {
    const registry = getInstalledModuleQuerySurfaceRegistry();
    const catalog = createQueryEditorCatalogFromRegistry(registry);
    const surface = getInstalledModuleQuerySurface(registry, "workflow:project-branch-board");
    if (!surface) {
      throw new Error("Expected workflow branch board surface.");
    }

    const result = await resolveCollectionSurfaceBinding({
      catalog,
      collection: {
        key: "workflow:branch-board",
        presentation: {
          kind: "table",
        },
        source: {
          kind: "query",
          query: "saved-query:workflow:branch-board",
        },
        title: "Branch board",
      } satisfies CollectionSurfaceSpec,
      lookup: {
        getSavedQuery: () =>
          createSavedQueryRecord({
            catalogId: surface.catalogId,
            catalogVersion: surface.catalogVersion,
            id: "saved-query:workflow:branch-board",
            surfaceId: surface.surfaceId,
            surfaceVersion: surface.surfaceVersion,
          }),
      },
      rendererCapabilities,
      surfaceRegistry: registry,
    });

    expect(requireTableColumns(result)).toEqual([
      {
        fieldId: "title",
        label: "Title",
      },
      {
        fieldId: "state",
        kind: "enum",
        label: "State",
      },
      {
        fieldId: "queueRank",
        label: "Queue Rank",
      },
    ]);
  });

  it("falls back to ordering and filter metadata when a surface does not author selections", async () => {
    const registry = createInstalledModuleQuerySurfaceRegistry([
      {
        catalogId: "test:query-surfaces",
        catalogVersion: "query-catalog:test:v1",
        moduleId: "test",
        surfaces: [
          {
            filters: [
              {
                fieldId: "updatedAt",
                kind: "date",
                label: "Updated",
                operators: ["eq", "gt"],
              },
              {
                fieldId: "estimate",
                kind: "number",
                label: "Estimate",
                operators: ["eq", "gt"],
              },
              {
                fieldId: "state",
                kind: "enum",
                label: "State",
                operators: ["eq"],
              },
            ],
            label: "Test task board",
            ordering: [
              {
                directions: ["desc"],
                fieldId: "updatedAt",
                label: "Updated",
              },
            ],
            queryKind: "collection",
            renderers: {
              compatibleRendererIds: ["core:table"],
              itemEntityIds: "required",
              resultKind: "collection",
              sourceKinds: ["saved"],
            },
            source: {
              kind: "projection",
              projectionId: "test:task-board",
            },
            surfaceId: "test:task-board",
            surfaceVersion: "query-surface:test:task-board:v1",
          },
        ],
      },
    ]);
    const catalog = createQueryEditorCatalogFromRegistry(registry);
    const surface = getInstalledModuleQuerySurface(registry, "test:task-board");
    if (!surface) {
      throw new Error("Expected test task board surface.");
    }

    const result = await resolveCollectionSurfaceBinding({
      catalog,
      collection: {
        key: "test:task-board",
        presentation: {
          kind: "table",
        },
        source: {
          kind: "query",
          query: "saved-query:test:task-board",
        },
        title: "Task board",
      } satisfies CollectionSurfaceSpec,
      lookup: {
        getSavedQuery: () =>
          createSavedQueryRecord({
            catalogId: surface.catalogId,
            catalogVersion: surface.catalogVersion,
            id: "saved-query:test:task-board",
            surfaceId: surface.surfaceId,
            surfaceVersion: surface.surfaceVersion,
          }),
      },
      rendererCapabilities,
      surfaceRegistry: registry,
    });

    expect(requireTableColumns(result)).toEqual([
      {
        align: "end",
        fieldId: "updatedAt",
        kind: "date",
        label: "Updated",
      },
      {
        align: "end",
        fieldId: "estimate",
        kind: "number",
        label: "Estimate",
      },
      {
        fieldId: "state",
        kind: "enum",
        label: "State",
      },
    ]);
  });
});
