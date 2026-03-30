import type { ModuleQuerySurfaceSpec, QuerySurfaceFieldKind } from "@io/graph-projection";

import {
  createQueryEditorCatalog,
  type QueryEditorCatalog,
  type QueryEditorFieldControl,
  type QueryEditorSurfaceSpec,
} from "./query-editor.js";
import { getQueryEditorBaseFieldKind } from "./query-editor-value-semantics.js";

export type QueryEditorInstalledSurface = ModuleQuerySurfaceSpec & {
  readonly catalogId: string;
  readonly catalogVersion: string;
  readonly moduleId: string;
};

export type QueryEditorInstalledSurfaceRegistry = {
  readonly surfaces: readonly QueryEditorInstalledSurface[];
};

function toQueryEditorFieldControl(kind: QuerySurfaceFieldKind): QueryEditorFieldControl {
  switch (getQueryEditorBaseFieldKind(kind)) {
    case "enum":
      return "enum";
    case "entity-ref":
      return "entity-ref";
    case "date":
      return "date";
    case "boolean":
      return "boolean";
    case "number":
    case "percent":
      return "number";
    case "text":
    case "url":
    case "email":
    case "color":
    case "duration":
    case "money":
    case "quantity":
    case "range":
    case "rate":
      return "text";
  }
}

function toQueryEditorSurface(surface: QueryEditorInstalledSurface): QueryEditorSurfaceSpec {
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
        kind: field.kind,
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

export function createQueryEditorCatalogFromRegistry(
  registry: QueryEditorInstalledSurfaceRegistry,
): QueryEditorCatalog {
  return createQueryEditorCatalog(
    registry.surfaces.map((surface) => toQueryEditorSurface(surface)),
  );
}
