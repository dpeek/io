import type { ModuleQuerySurfaceCatalog } from "@io/graph-projection";
import {
  createInstalledQuerySurfaceRegistry,
  createQueryEditorCatalogFromInstalledSurfaces,
  createQuerySurfaceRendererCompatibility,
  getInstalledQuerySurface,
  type InstalledQuerySurface,
  type InstalledQuerySurfaceRegistry,
  type QueryEditorCatalog,
  type QuerySurfaceRendererCompatibility,
} from "@io/graph-query";

import {
  getBuiltInInstalledModuleContributionResolutions,
  resolveActiveInstalledModuleContributionResolutions,
  type InstalledModuleContributionResolution,
} from "./installed-module-runtime.js";

export type InstalledModuleQuerySurface = InstalledQuerySurface;
export type InstalledModuleQuerySurfaceRegistry = InstalledQuerySurfaceRegistry;

export function resolveInstalledModuleQuerySurfaceCatalogs(
  resolutions: readonly InstalledModuleContributionResolution[],
): readonly ModuleQuerySurfaceCatalog[] {
  const catalogs: ModuleQuerySurfaceCatalog[] = [];

  for (const { manifest, record } of resolveActiveInstalledModuleContributionResolutions(
    resolutions,
  )) {
    const moduleCatalogs = manifest.runtime.querySurfaceCatalogs;
    if (!moduleCatalogs || moduleCatalogs.length === 0) {
      throw new TypeError(
        `Active installed module "${record.moduleId}" does not publish any query-surface catalogs.`,
      );
    }

    catalogs.push(...moduleCatalogs);
  }

  if (catalogs.length === 0) {
    throw new TypeError(
      "Activation-driven query-surface catalog composition produced no active installed catalogs.",
    );
  }

  return Object.freeze([...catalogs]);
}

export function createInstalledModuleQuerySurfaceRegistry(
  catalogs: readonly ModuleQuerySurfaceCatalog[],
): InstalledModuleQuerySurfaceRegistry {
  return createInstalledQuerySurfaceRegistry(catalogs);
}

export function getInstalledModuleQuerySurface(
  registry: InstalledModuleQuerySurfaceRegistry,
  surfaceId: string,
): InstalledModuleQuerySurface | undefined {
  return getInstalledQuerySurface(registry, surfaceId);
}

export function createQueryEditorCatalogFromRegistry(
  registry: InstalledModuleQuerySurfaceRegistry,
): QueryEditorCatalog {
  return createQueryEditorCatalogFromInstalledSurfaces(registry);
}

/**
 * Compose the shipped built-in query-surface catalogs from the same manifest
 * contribution and activation state seam that later installed-module work will
 * reuse.
 *
 * Keep this available as a getter because the Cloudflare dev worker scans
 * entry exports during startup, and some startup-sensitive paths need to defer
 * catalog materialization until workspace modules finish initializing.
 */
export function getBuiltInInstalledModuleQuerySurfaceCatalogs(): readonly ModuleQuerySurfaceCatalog[] {
  return resolveInstalledModuleQuerySurfaceCatalogs(
    getBuiltInInstalledModuleContributionResolutions(),
  );
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

export { createQuerySurfaceRendererCompatibility };
export { getBuiltInInstalledModuleContributionResolutions };
