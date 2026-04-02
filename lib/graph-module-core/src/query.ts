import {
  createProjectionDependencyKey,
  defineModuleReadScopeRegistration,
  defineModuleQuerySurfaceCatalog,
  defineModuleQuerySurfaceSpec,
  defineModuleReadScopeDefinition,
  defineProjectionSpec,
  type ModuleQuerySurfaceSpec,
} from "@io/graph-projection";

import { savedQueryKindValues } from "./core/saved-query.js";

export const coreModuleId = "core";

export const coreCatalogModuleReadScope = defineModuleReadScopeDefinition({
  kind: "module",
  moduleId: coreModuleId,
  scopeId: "scope:core:catalog",
  definitionHash: "scope-def:core:catalog:v1",
});

export const coreCatalogModuleReadScopeRegistration = defineModuleReadScopeRegistration({
  definition: coreCatalogModuleReadScope,
  fallback: {
    definitionChanged: "scope-changed",
    policyChanged: "policy-changed",
  },
});

const coreSavedQueryLibraryProjectionId = "core:saved-query-library";

const coreSavedQueryLibraryProjection = defineProjectionSpec({
  projectionId: coreSavedQueryLibraryProjectionId,
  kind: "collection-index",
  definitionHash: "projection-def:core:saved-query-library:v1",
  sourceScopeKinds: ["module"],
  dependencyKeys: [createProjectionDependencyKey(coreSavedQueryLibraryProjectionId)],
  rebuildStrategy: "full",
  visibilityMode: "policy-filtered",
});

function titleCaseWord(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

const coreQueryRendererIds = ["default:list", "default:table"] as const;

const savedQueryKindOptions = Object.freeze(
  savedQueryKindValues.map((kind) => ({
    label: titleCaseWord(kind),
    value: kind,
  })),
);

const coreCatalogScopeQuerySurface = defineModuleQuerySurfaceSpec({
  surfaceId: coreCatalogModuleReadScope.scopeId,
  surfaceVersion: "query-surface:core:catalog-scope:v1",
  label: "Core Catalog Scope",
  description:
    "Module-scoped core catalog bootstrap surface used to prove bounded serialized-query dispatch across modules.",
  queryKind: "scope",
  source: {
    kind: "scope",
    scopeId: coreCatalogModuleReadScope.scopeId,
  },
  renderers: {
    compatibleRendererIds: coreQueryRendererIds,
    itemEntityIds: "required",
    resultKind: "scope",
    sourceKinds: ["saved-query", "inline"],
  },
});

const coreSavedQueryLibraryQuerySurface = defineModuleQuerySurfaceSpec({
  surfaceId: coreSavedQueryLibraryProjection.projectionId,
  surfaceVersion: "query-surface:core:saved-query-library:v1",
  label: "Saved Query Library",
  description:
    "Core-owned saved-query library for reusable query definitions that are shared across workflow and later product surfaces.",
  queryKind: "collection",
  source: {
    kind: "projection",
    projectionId: coreSavedQueryLibraryProjection.projectionId,
  },
  defaultPageSize: 25,
  filters: [
    {
      fieldId: "ownerId",
      kind: "entity-ref",
      label: "Owner",
      operators: ["eq"],
    },
    {
      fieldId: "queryKind",
      kind: "enum",
      label: "Query Kind",
      operators: ["eq", "in"],
      options: savedQueryKindOptions,
    },
    {
      fieldId: "name",
      kind: "text",
      label: "Name",
      operators: ["eq", "contains", "starts-with"],
    },
    {
      fieldId: "surfaceModuleId",
      kind: "text",
      label: "Surface Module",
      operators: ["eq"],
    },
  ],
  ordering: [
    {
      fieldId: "updatedAt",
      label: "Updated",
      directions: ["asc", "desc"],
    },
    {
      fieldId: "createdAt",
      label: "Created",
      directions: ["asc", "desc"],
    },
    {
      fieldId: "name",
      label: "Name",
      directions: ["asc", "desc"],
    },
    {
      fieldId: "queryKind",
      label: "Query Kind",
      directions: ["asc", "desc"],
    },
  ],
  selections: [
    {
      fieldId: "name",
      label: "Name",
      defaultSelected: true,
    },
    {
      fieldId: "queryKind",
      label: "Query Kind",
      defaultSelected: true,
    },
    {
      fieldId: "surfaceModuleId",
      label: "Surface Module",
      defaultSelected: true,
    },
    {
      fieldId: "surfaceId",
      label: "Surface Id",
    },
    {
      fieldId: "updatedAt",
      label: "Updated",
      defaultSelected: true,
    },
  ],
  parameters: [
    {
      name: "owner-id",
      label: "Owner",
      type: "entity-ref",
      required: true,
    },
    {
      name: "query-kind",
      label: "Query Kind",
      type: "enum",
    },
    {
      name: "name",
      label: "Name",
      type: "string",
    },
    {
      name: "surface-module-id",
      label: "Surface Module",
      type: "string",
    },
  ],
  renderers: {
    compatibleRendererIds: coreQueryRendererIds,
    itemEntityIds: "required",
    resultKind: "collection",
    sourceKinds: ["saved-query", "inline"],
  },
});

/**
 * Package-root metadata export for the built-in core catalog scope plus the
 * first reusable saved-query library surface.
 *
 * Durable `core:savedQuery` records live in the core schema, but their surface
 * bindings may target this catalog or any other installed module catalog.
 */
export const coreQuerySurfaceCatalog = defineModuleQuerySurfaceCatalog({
  catalogId: "core:query-surfaces",
  catalogVersion: "query-catalog:core:v2",
  moduleId: coreModuleId,
  surfaces: [coreCatalogScopeQuerySurface, coreSavedQueryLibraryQuerySurface],
});

export type CoreBuiltInQuerySurfaceSpec = ModuleQuerySurfaceSpec;

export const coreBuiltInQuerySurfaces = Object.freeze({
  catalogScope: coreCatalogScopeQuerySurface,
  savedQueryLibrary: coreSavedQueryLibraryQuerySurface,
});

export const coreBuiltInQuerySurfaceIds = Object.freeze({
  catalogScope: coreBuiltInQuerySurfaces.catalogScope.surfaceId,
  savedQueryLibrary: coreBuiltInQuerySurfaces.savedQueryLibrary.surfaceId,
});
