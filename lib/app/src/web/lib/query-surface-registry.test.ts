import { describe, expect, it } from "bun:test";

import { coreBuiltInQuerySurfaceIds } from "@io/graph-module-core";

import {
  builtInInstalledModuleQuerySurfaceCatalogs,
  createBuiltInInstalledModuleQuerySurfaceRegistry,
  createInstalledModuleQuerySurfaceRegistry,
  createQueryEditorCatalogFromRegistry,
  createQuerySurfaceRendererCompatibility,
  getInstalledModuleQuerySurface,
  installedModuleQuerySurfaceRegistry,
} from "./query-surface-registry.js";

describe("query surface registry", () => {
  it("installs the explicit built-in workflow and core catalogs into one shared registry", () => {
    const registry = createBuiltInInstalledModuleQuerySurfaceRegistry();
    const surface = getInstalledModuleQuerySurface(registry, "workflow:project-branch-board");
    const coreSurface = getInstalledModuleQuerySurface(
      registry,
      coreBuiltInQuerySurfaceIds.catalogScope,
    );
    const savedQueryLibrarySurface = getInstalledModuleQuerySurface(
      registry,
      coreBuiltInQuerySurfaceIds.savedQueryLibrary,
    );

    expect(surface).toMatchObject({
      catalogId: "workflow:query-surfaces",
      catalogVersion: "query-catalog:workflow:v1",
      moduleId: "workflow",
      surfaceId: "workflow:project-branch-board",
      surfaceVersion: "query-surface:workflow:project-branch-board:v1",
      queryKind: "collection",
      source: {
        kind: "projection",
        projectionId: "workflow:project-branch-board",
      },
    });
    expect(surface?.filters?.map((field) => field.fieldId)).toEqual([
      "projectId",
      "state",
      "hasActiveCommit",
      "showUnmanagedRepositoryBranches",
    ]);
    expect(surface?.ordering?.map((field) => field.fieldId)).toEqual([
      "queue-rank",
      "updated-at",
      "created-at",
      "title",
      "state",
    ]);
    expect(surface?.parameters?.map((parameter) => parameter.name)).toEqual([
      "project-id",
      "state",
      "has-active-commit",
      "show-unmanaged-repository-branches",
    ]);
    expect(surface?.renderers?.compatibleRendererIds).toEqual([
      "core:list",
      "core:table",
      "core:card-grid",
    ]);
    expect(builtInInstalledModuleQuerySurfaceCatalogs.map((catalog) => catalog.catalogId)).toEqual([
      "workflow:query-surfaces",
      "core:query-surfaces",
    ]);
    expect(registry.catalogs.map((catalog) => catalog.catalogId)).toEqual([
      "workflow:query-surfaces",
      "core:query-surfaces",
    ]);
    expect(coreSurface).toMatchObject({
      catalogId: "core:query-surfaces",
      catalogVersion: "query-catalog:core:v2",
      moduleId: "core",
      surfaceId: "scope:core:catalog",
      surfaceVersion: "query-surface:core:catalog-scope:v1",
      queryKind: "scope",
      source: {
        kind: "scope",
        scopeId: "scope:core:catalog",
      },
    });
    expect(savedQueryLibrarySurface).toMatchObject({
      catalogId: "core:query-surfaces",
      catalogVersion: "query-catalog:core:v2",
      moduleId: "core",
      surfaceId: "core:saved-query-library",
      surfaceVersion: "query-surface:core:saved-query-library:v1",
      queryKind: "collection",
      source: {
        kind: "projection",
        projectionId: "core:saved-query-library",
      },
      renderers: {
        compatibleRendererIds: ["core:list", "core:table"],
        itemEntityIds: "required",
        resultKind: "collection",
        sourceKinds: ["saved", "inline"],
      },
    });
    expect(savedQueryLibrarySurface?.filters?.map((field) => field.fieldId)).toEqual([
      "ownerId",
      "queryKind",
      "name",
      "surfaceModuleId",
    ]);
    expect(savedQueryLibrarySurface?.ordering?.map((field) => field.fieldId)).toEqual([
      "updatedAt",
      "createdAt",
      "name",
      "queryKind",
    ]);
    expect(savedQueryLibrarySurface?.parameters?.map((parameter) => parameter.name)).toEqual([
      "owner-id",
      "query-kind",
      "name",
      "surface-module-id",
    ]);
  });

  it("projects installed workflow and core surfaces into one editor catalog and renderer views", () => {
    const catalog = createQueryEditorCatalogFromRegistry(installedModuleQuerySurfaceRegistry);
    const branchBoardSurface = catalog.surfaces.find(
      (surface) => surface.surfaceId === "workflow:project-branch-board",
    );
    const savedQueryLibrarySurface = catalog.surfaces.find(
      (surface) => surface.surfaceId === coreBuiltInQuerySurfaceIds.savedQueryLibrary,
    );
    const branchBoardRegistrySurface = getInstalledModuleQuerySurface(
      installedModuleQuerySurfaceRegistry,
      "workflow:project-branch-board",
    );
    const savedQueryLibraryRegistrySurface = getInstalledModuleQuerySurface(
      installedModuleQuerySurfaceRegistry,
      coreBuiltInQuerySurfaceIds.savedQueryLibrary,
    );

    expect(
      catalog.surfaces
        .filter(
          (surface) =>
            surface.surfaceId === "workflow:project-branch-board" ||
            surface.surfaceId === coreBuiltInQuerySurfaceIds.savedQueryLibrary,
        )
        .map((surface) => ({
          label: surface.label,
          moduleId: surface.moduleId,
          surfaceId: surface.surfaceId,
        })),
    ).toEqual([
      {
        label: "Workflow Branch Board",
        moduleId: "workflow",
        surfaceId: "workflow:project-branch-board",
      },
      {
        label: "Saved Query Library",
        moduleId: "core",
        surfaceId: coreBuiltInQuerySurfaceIds.savedQueryLibrary,
      },
    ]);
    expect(branchBoardSurface).toEqual(
      expect.objectContaining({
        surfaceId: "workflow:project-branch-board",
        surfaceVersion: "query-surface:workflow:project-branch-board:v1",
        sortFields: expect.arrayContaining([
          expect.objectContaining({ fieldId: "queue-rank", label: "Queue Rank" }),
          expect.objectContaining({ fieldId: "updated-at", label: "Updated" }),
        ]),
      }),
    );
    expect(branchBoardSurface?.fields.map((field) => field.fieldId)).toEqual([
      "projectId",
      "state",
      "hasActiveCommit",
      "showUnmanagedRepositoryBranches",
    ]);
    expect(savedQueryLibrarySurface).toEqual(
      expect.objectContaining({
        surfaceId: "core:saved-query-library",
        surfaceVersion: "query-surface:core:saved-query-library:v1",
        sortFields: expect.arrayContaining([
          expect.objectContaining({ fieldId: "updatedAt", label: "Updated" }),
          expect.objectContaining({ fieldId: "name", label: "Name" }),
        ]),
      }),
    );
    expect(savedQueryLibrarySurface?.fields.map((field) => field.fieldId)).toEqual([
      "ownerId",
      "queryKind",
      "name",
      "surfaceModuleId",
    ]);

    expect(
      branchBoardRegistrySurface
        ? createQuerySurfaceRendererCompatibility(branchBoardRegistrySurface)
        : undefined,
    ).toEqual({
      compatibleRendererIds: ["core:list", "core:table", "core:card-grid"],
      itemEntityIds: "required",
      queryKind: "collection",
      resultKind: "collection",
      sourceKinds: ["saved", "inline"],
      surfaceId: "workflow:project-branch-board",
      surfaceVersion: "query-surface:workflow:project-branch-board:v1",
    });
    expect(
      savedQueryLibraryRegistrySurface
        ? createQuerySurfaceRendererCompatibility(savedQueryLibraryRegistrySurface)
        : undefined,
    ).toEqual({
      compatibleRendererIds: ["core:list", "core:table"],
      itemEntityIds: "required",
      queryKind: "collection",
      resultKind: "collection",
      sourceKinds: ["saved", "inline"],
      surfaceId: "core:saved-query-library",
      surfaceVersion: "query-surface:core:saved-query-library:v1",
    });
  });

  it("rejects duplicate installed surface registrations", () => {
    expect(() =>
      createInstalledModuleQuerySurfaceRegistry([
        {
          ...builtInInstalledModuleQuerySurfaceCatalogs[0],
          catalogId: "workflow:query-surfaces:copy",
        },
        builtInInstalledModuleQuerySurfaceCatalogs[0],
      ]),
    ).toThrow("surfaceId must not contain duplicate values.");
  });

  it("rejects duplicate installed catalog registrations", () => {
    expect(() =>
      createInstalledModuleQuerySurfaceRegistry([
        builtInInstalledModuleQuerySurfaceCatalogs[0],
        builtInInstalledModuleQuerySurfaceCatalogs[0],
      ]),
    ).toThrow("catalogId must not contain duplicate values.");
  });
});
