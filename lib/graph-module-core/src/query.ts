import {
  defineModuleQuerySurfaceCatalog,
  defineModuleQuerySurfaceSpec,
  defineModuleReadScopeDefinition,
  type ModuleQuerySurfaceSpec,
} from "@io/graph-projection";

export const coreModuleId = "core";

export const coreCatalogModuleReadScope = defineModuleReadScopeDefinition({
  kind: "module",
  moduleId: coreModuleId,
  scopeId: "scope:core:catalog",
  definitionHash: "scope-def:core:catalog:v1",
});

const coreScopeQueryRendererIds = ["core:list", "core:table"] as const;

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
    compatibleRendererIds: coreScopeQueryRendererIds,
    itemEntityIds: "required",
    resultKind: "scope",
    sourceKinds: ["saved", "inline"],
  },
});

export const coreQuerySurfaceCatalog = defineModuleQuerySurfaceCatalog({
  catalogId: "core:query-surfaces",
  catalogVersion: "query-catalog:core:v1",
  moduleId: coreModuleId,
  surfaces: [coreCatalogScopeQuerySurface],
});

export type CoreBuiltInQuerySurfaceSpec = ModuleQuerySurfaceSpec;

export const coreBuiltInQuerySurfaces = Object.freeze({
  catalogScope: coreCatalogScopeQuerySurface,
});

export const coreBuiltInQuerySurfaceIds = Object.freeze({
  catalogScope: coreBuiltInQuerySurfaces.catalogScope.surfaceId,
});
