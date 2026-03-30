import { coreQuerySurfaceCatalog } from "@io/graph-module-core";
import { workflowQuerySurfaceCatalog } from "@io/graph-module-workflow";
import type {
  ModuleQuerySurfaceCatalog,
  ModuleQuerySurfaceSpec,
  QuerySurfaceFieldKind,
} from "@io/graph-projection";

import {
  createQueryEditorCatalog,
  type QueryEditorCatalog,
  type QueryEditorFieldControl,
  type QueryEditorSurfaceSpec,
} from "./query-editor.js";
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

function toQueryEditorFieldControl(kind: QuerySurfaceFieldKind): QueryEditorFieldControl {
  return kind;
}

function toQueryEditorSurface(surface: InstalledModuleQuerySurface): QueryEditorSurfaceSpec {
  return {
    catalogId: surface.catalogId,
    catalogVersion: surface.catalogVersion,
    ...(surface.defaultPageSize ? { defaultPageSize: surface.defaultPageSize } : {}),
    ...(surface.description ? { description: surface.description } : {}),
    fields:
      surface.filters?.map((field) => ({
        control: toQueryEditorFieldControl(field.kind),
        ...(field.description ? { description: field.description } : {}),
        fieldId: field.fieldId,
        filterOperators: field.operators,
        label: field.label,
        ...(field.options ? { options: field.options } : {}),
      })) ?? [],
    label: surface.label,
    moduleId: surface.moduleId,
    queryKind: surface.queryKind,
    ...(surface.ordering ? { sortFields: surface.ordering } : {}),
    sourceKind: surface.source.kind,
    surfaceId: surface.surfaceId,
    surfaceVersion: surface.surfaceVersion,
  };
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
): QueryEditorCatalog {
  return createQueryEditorCatalog(
    registry.surfaces.map((surface) => toQueryEditorSurface(surface)),
  );
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

export const installedModuleQuerySurfaceRegistry = createInstalledModuleQuerySurfaceRegistry([
  workflowQuerySurfaceCatalog,
  coreQuerySurfaceCatalog,
]);

export const installedModuleQueryEditorCatalog = createQueryEditorCatalogFromRegistry(
  installedModuleQuerySurfaceRegistry,
);

export function getInstalledModuleQuerySurfaceRendererCompatibility(
  surfaceId: string,
): QuerySurfaceRendererCompatibility | undefined {
  const surface = getInstalledModuleQuerySurface(installedModuleQuerySurfaceRegistry, surfaceId);
  return surface ? createQuerySurfaceRendererCompatibility(surface) : undefined;
}
