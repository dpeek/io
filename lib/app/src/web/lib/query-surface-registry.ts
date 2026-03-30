import { coreQuerySurfaceCatalog } from "@io/graph-module-core";
import { createQueryEditorCatalogFromRegistry as createSharedQueryEditorCatalogFromRegistry } from "@io/graph-module-core/react-dom/query-editor-catalog";
import type { QueryEditorCatalog } from "@io/graph-module-core/react-dom";
import { workflowQuerySurfaceCatalog } from "@io/graph-module-workflow";
import type { ModuleQuerySurfaceCatalog, ModuleQuerySurfaceSpec } from "@io/graph-projection";

import type { QuerySurfaceRendererCompatibility } from "./query-container.js";

export type InstalledModuleQuerySurface = ModuleQuerySurfaceSpec & {
  readonly catalogId: string;
  readonly catalogVersion: string;
  readonly moduleId: string;
};

export type InstalledModuleQuerySurfaceRegistry = {
  readonly catalogs: readonly ModuleQuerySurfaceCatalog[];
  readonly surfaces: readonly InstalledModuleQuerySurface[];
  readonly surfaceById: ReadonlyMap<string, InstalledModuleQuerySurface>;
};

function requireUniqueString(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (value.length === 0) {
      throw new TypeError(`${label} must not contain empty values.`);
    }
    if (seen.has(value)) {
      throw new TypeError(`${label} must not contain duplicate values.`);
    }
    seen.add(value);
  }
}

export function createInstalledModuleQuerySurfaceRegistry(
  catalogs: readonly ModuleQuerySurfaceCatalog[],
): InstalledModuleQuerySurfaceRegistry {
  if (catalogs.length === 0) {
    throw new TypeError("Installed module query-surface catalogs must not be empty.");
  }

  requireUniqueString(
    catalogs.map((catalog) => catalog.catalogId),
    "catalogId",
  );

  const surfaces = catalogs.flatMap((catalog) =>
    catalog.surfaces.map((surface) =>
      Object.freeze({
        ...surface,
        catalogId: catalog.catalogId,
        catalogVersion: catalog.catalogVersion,
        moduleId: catalog.moduleId,
      }),
    ),
  );

  requireUniqueString(
    surfaces.map((surface) => surface.surfaceId),
    "surfaceId",
  );

  const surfaceById = new Map(surfaces.map((surface) => [surface.surfaceId, surface]));

  return Object.freeze({
    catalogs: Object.freeze([...catalogs]),
    surfaces: Object.freeze(surfaces),
    surfaceById,
  });
}

export function getInstalledModuleQuerySurface(
  registry: InstalledModuleQuerySurfaceRegistry,
  surfaceId: string,
): InstalledModuleQuerySurface | undefined {
  return registry.surfaceById.get(surfaceId);
}

export function createQueryEditorCatalogFromRegistry(
  registry: InstalledModuleQuerySurfaceRegistry,
) {
  return createSharedQueryEditorCatalogFromRegistry(registry);
}

export function createQuerySurfaceRendererCompatibility(
  surface: InstalledModuleQuerySurface,
): QuerySurfaceRendererCompatibility | undefined {
  if (!surface.renderers) {
    return undefined;
  }

  return {
    compatibleRendererIds: surface.renderers.compatibleRendererIds,
    ...(surface.renderers.itemEntityIds ? { itemEntityIds: surface.renderers.itemEntityIds } : {}),
    queryKind: surface.queryKind,
    resultKind: surface.renderers.resultKind,
    ...(surface.renderers.sourceKinds ? { sourceKinds: surface.renderers.sourceKinds } : {}),
    surfaceId: surface.surfaceId,
    surfaceVersion: surface.surfaceVersion,
  };
}

/**
 * Keep the current built-in installation path explicit until manifest-backed
 * activation decides which module catalogs are active at runtime.
 *
 * This stays lazy because the Cloudflare dev worker scans entry exports during
 * startup, and eager catalog materialization can observe partially initialized
 * workspace modules.
 */
export function getBuiltInInstalledModuleQuerySurfaceCatalogs(): readonly ModuleQuerySurfaceCatalog[] {
  return [workflowQuerySurfaceCatalog, coreQuerySurfaceCatalog];
}

export const builtInInstalledModuleQuerySurfaceCatalogs =
  getBuiltInInstalledModuleQuerySurfaceCatalogs();

export function createBuiltInInstalledModuleQuerySurfaceRegistry(): InstalledModuleQuerySurfaceRegistry {
  return createInstalledModuleQuerySurfaceRegistry(getBuiltInInstalledModuleQuerySurfaceCatalogs());
}

let installedModuleQuerySurfaceRegistryCache: InstalledModuleQuerySurfaceRegistry | undefined;

export function getInstalledModuleQuerySurfaceRegistry(): InstalledModuleQuerySurfaceRegistry {
  installedModuleQuerySurfaceRegistryCache ??= createBuiltInInstalledModuleQuerySurfaceRegistry();
  return installedModuleQuerySurfaceRegistryCache;
}

let installedModuleQueryEditorCatalogCache: QueryEditorCatalog | undefined;

export function getInstalledModuleQueryEditorCatalog(): QueryEditorCatalog {
  installedModuleQueryEditorCatalogCache ??= createQueryEditorCatalogFromRegistry(
    getInstalledModuleQuerySurfaceRegistry(),
  );
  return installedModuleQueryEditorCatalogCache;
}

export const installedModuleQueryEditorCatalog = getInstalledModuleQueryEditorCatalog();

export function getInstalledModuleQuerySurfaceRendererCompatibility(
  surfaceId: string,
): QuerySurfaceRendererCompatibility | undefined {
  const surface = getInstalledModuleQuerySurface(
    getInstalledModuleQuerySurfaceRegistry(),
    surfaceId,
  );
  return surface ? createQuerySurfaceRendererCompatibility(surface) : undefined;
}
