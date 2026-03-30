import { describe, expect, it } from "bun:test";

import {
  createInstalledModuleQuerySurfaceRegistry,
  createQueryEditorCatalogFromRegistry,
  createQuerySurfaceRendererCompatibility,
  getInstalledModuleQuerySurface,
  installedModuleQuerySurfaceRegistry,
} from "./query-surface-registry.js";

describe("query surface registry", () => {
  it("loads installed module catalogs and exposes workflow surface metadata", () => {
    const surface = getInstalledModuleQuerySurface(
      installedModuleQuerySurfaceRegistry,
      "workflow:project-branch-board",
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
  });

  it("projects installed surfaces into editor and renderer views", () => {
    const catalog = createQueryEditorCatalogFromRegistry(installedModuleQuerySurfaceRegistry);
    const branchBoardSurface = catalog.surfaces.find(
      (surface) => surface.surfaceId === "workflow:project-branch-board",
    );
    const branchBoardRegistrySurface = getInstalledModuleQuerySurface(
      installedModuleQuerySurfaceRegistry,
      "workflow:project-branch-board",
    );

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
  });

  it("rejects duplicate installed surface registrations", () => {
    expect(() =>
      createInstalledModuleQuerySurfaceRegistry([
        {
          ...installedModuleQuerySurfaceRegistry.catalogs[0]!,
          catalogId: "workflow:query-surfaces:copy",
        },
        installedModuleQuerySurfaceRegistry.catalogs[0]!,
      ]),
    ).toThrow("surfaceId must not contain duplicate values.");
  });

  it("rejects duplicate installed catalog registrations", () => {
    expect(() =>
      createInstalledModuleQuerySurfaceRegistry([
        installedModuleQuerySurfaceRegistry.catalogs[0]!,
        installedModuleQuerySurfaceRegistry.catalogs[0]!,
      ]),
    ).toThrow("catalogId must not contain duplicate values.");
  });
});
