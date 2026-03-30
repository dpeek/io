import type { NormalizedQueryRequest, QueryResultPage } from "@io/graph-client";

import type {
  InstalledModuleQuerySurface,
  InstalledModuleQuerySurfaceRegistry,
} from "./query-surface-registry.js";

type RegisteredSerializedQueryKind = Extract<
  NormalizedQueryRequest["query"]["kind"],
  "collection" | "scope"
>;
type SerializedQuerySurfaceSourceKind<Kind extends RegisteredSerializedQueryKind> =
  Kind extends "scope" ? "scope" : "projection";

type InstalledSerializedQuerySurface<Kind extends RegisteredSerializedQueryKind> =
  InstalledModuleQuerySurface & {
    readonly queryKind: Kind;
    readonly source: Extract<
      InstalledModuleQuerySurface["source"],
      { readonly kind: SerializedQuerySurfaceSourceKind<Kind> }
    >;
  };

type NormalizedRegisteredSerializedQuery<Kind extends RegisteredSerializedQueryKind> = Extract<
  NormalizedQueryRequest["query"],
  { readonly kind: Kind }
>;

type NormalizedRegisteredSerializedQueryRequest<Kind extends RegisteredSerializedQueryKind> = Omit<
  NormalizedQueryRequest,
  "query"
> & {
  readonly query: NormalizedRegisteredSerializedQuery<Kind>;
};

export type SerializedQueryCollectionExecutionContext<ReadOptions> = {
  readonly normalizedRequest: NormalizedRegisteredSerializedQueryRequest<"collection">;
  readonly options: ReadOptions;
  readonly pageCursor: string | undefined;
  readonly surface: InstalledSerializedQuerySurface<"collection">;
};

export type SerializedQueryScopeExecutionContext<ReadOptions> = {
  readonly normalizedRequest: NormalizedRegisteredSerializedQueryRequest<"scope">;
  readonly options: ReadOptions;
  readonly surface: InstalledSerializedQuerySurface<"scope">;
};

export type RegisteredSerializedQueryCollectionExecutor<ReadOptions> = {
  readonly execute: (
    context: SerializedQueryCollectionExecutionContext<ReadOptions>,
  ) => QueryResultPage;
  readonly queryKind: "collection";
  readonly surfaceId: string;
  readonly surfaceVersion: string;
};

export type RegisteredSerializedQueryScopeExecutor<ReadOptions> = {
  readonly execute: (context: SerializedQueryScopeExecutionContext<ReadOptions>) => QueryResultPage;
  readonly queryKind: "scope";
  readonly surfaceId: string;
  readonly surfaceVersion: string;
};

export type RegisteredSerializedQueryExecutor<ReadOptions> =
  | RegisteredSerializedQueryCollectionExecutor<ReadOptions>
  | RegisteredSerializedQueryScopeExecutor<ReadOptions>;

export type SerializedQueryExecutorRegistry<ReadOptions> = {
  readonly collectionExecutors: ReadonlyMap<
    string,
    RegisteredSerializedQueryCollectionExecutor<ReadOptions>
  >;
  readonly scopeExecutors: ReadonlyMap<string, RegisteredSerializedQueryScopeExecutor<ReadOptions>>;
  readonly surfaceRegistry: InstalledModuleQuerySurfaceRegistry;
};

type SerializedQueryExecutorResolutionFailureCode =
  | "ambiguous-surface"
  | "missing-executor"
  | "stale-executor"
  | "unregistered-surface";

type SerializedQueryExecutorResolutionFailureBase<
  Kind extends RegisteredSerializedQueryKind,
  Code extends SerializedQueryExecutorResolutionFailureCode,
> = {
  readonly code: Code;
  readonly ok: false;
  readonly queryKind: Kind;
};

type SerializedQueryExecutorResolutionSuccess<
  ReadOptions,
  Kind extends RegisteredSerializedQueryKind,
> = {
  readonly executor: Kind extends "collection"
    ? RegisteredSerializedQueryCollectionExecutor<ReadOptions>
    : RegisteredSerializedQueryScopeExecutor<ReadOptions>;
  readonly ok: true;
  readonly surface: InstalledSerializedQuerySurface<Kind>;
};

type SerializedQueryExecutorResolution<ReadOptions, Kind extends RegisteredSerializedQueryKind> =
  | SerializedQueryExecutorResolutionSuccess<ReadOptions, Kind>
  | SerializedQueryExecutorResolutionFailureBase<Kind, "unregistered-surface">
  | (SerializedQueryExecutorResolutionFailureBase<Kind, "missing-executor"> & {
      readonly surface: InstalledSerializedQuerySurface<Kind>;
    })
  | (SerializedQueryExecutorResolutionFailureBase<Kind, "stale-executor"> & {
      readonly executor: Kind extends "collection"
        ? RegisteredSerializedQueryCollectionExecutor<ReadOptions>
        : RegisteredSerializedQueryScopeExecutor<ReadOptions>;
      readonly surface: InstalledSerializedQuerySurface<Kind>;
    })
  | (Kind extends "scope"
      ? SerializedQueryExecutorResolutionFailureBase<Kind, "ambiguous-surface"> & {
          readonly surfaces: readonly InstalledSerializedQuerySurface<Kind>[];
        }
      : never);

function requireUniqueExecutorSurfaceIds<ReadOptions>(
  executors: readonly RegisteredSerializedQueryExecutor<ReadOptions>[],
): void {
  const seen = new Set<string>();
  for (const executor of executors) {
    if (executor.surfaceId.length === 0) {
      throw new TypeError("Serialized-query executor registrations must include a surfaceId.");
    }
    if (executor.surfaceVersion.length === 0) {
      throw new TypeError("Serialized-query executor registrations must include a surfaceVersion.");
    }
    const key = `${executor.queryKind}:${executor.surfaceId}`;
    if (seen.has(key)) {
      throw new TypeError(
        `Serialized-query executor registrations must not duplicate ${executor.queryKind} surface "${executor.surfaceId}".`,
      );
    }
    seen.add(key);
  }
}

function isInstalledSurfaceForKind<Kind extends RegisteredSerializedQueryKind>(
  surface: InstalledModuleQuerySurface,
  kind: Kind,
): surface is InstalledSerializedQuerySurface<Kind> {
  return surface.queryKind === kind;
}

function getInstalledSurfaceForKind<Kind extends RegisteredSerializedQueryKind>(
  surfaceRegistry: InstalledModuleQuerySurfaceRegistry,
  surfaceId: string,
  kind: Kind,
): InstalledSerializedQuerySurface<Kind> | undefined {
  const surface = surfaceRegistry.surfaceById.get(surfaceId);
  if (!surface || !isInstalledSurfaceForKind(surface, kind)) {
    return undefined;
  }
  return surface;
}

function matchesInstalledScopeSurface(
  query: NormalizedRegisteredSerializedQuery<"scope">,
  surface: InstalledSerializedQuerySurface<"scope">,
): boolean {
  if (query.scopeId) {
    return query.scopeId === surface.surfaceId;
  }
  if (!query.definition || query.definition.kind !== "module") {
    return false;
  }
  if (query.definition.projectionId || query.definition.roots) {
    return false;
  }
  if (query.definition.scopeId && query.definition.scopeId !== surface.source.scopeId) {
    return false;
  }
  const moduleIds = query.definition.moduleIds ?? [];
  return moduleIds.length === 1 && moduleIds[0] === surface.moduleId;
}

function resolveRegisteredExecutor<ReadOptions, Kind extends RegisteredSerializedQueryKind>(
  queryKind: Kind,
  surface: InstalledSerializedQuerySurface<Kind>,
  executors: ReadonlyMap<
    string,
    Kind extends "collection"
      ? RegisteredSerializedQueryCollectionExecutor<ReadOptions>
      : RegisteredSerializedQueryScopeExecutor<ReadOptions>
  >,
): SerializedQueryExecutorResolution<ReadOptions, Kind> {
  const executor = executors.get(surface.surfaceId);
  if (!executor) {
    return {
      ok: false,
      code: "missing-executor",
      queryKind,
      surface,
    };
  }
  if (executor.surfaceVersion !== surface.surfaceVersion) {
    return {
      ok: false,
      code: "stale-executor",
      executor,
      queryKind,
      surface,
    };
  }
  return {
    ok: true,
    executor,
    surface,
  };
}

export function createSerializedQueryExecutorRegistry<ReadOptions>(
  surfaceRegistry: InstalledModuleQuerySurfaceRegistry,
  executors: readonly RegisteredSerializedQueryExecutor<ReadOptions>[],
): SerializedQueryExecutorRegistry<ReadOptions> {
  requireUniqueExecutorSurfaceIds(executors);

  const collectionExecutors = new Map<
    string,
    RegisteredSerializedQueryCollectionExecutor<ReadOptions>
  >();
  const scopeExecutors = new Map<string, RegisteredSerializedQueryScopeExecutor<ReadOptions>>();

  for (const executor of executors) {
    if (executor.queryKind === "collection") {
      collectionExecutors.set(executor.surfaceId, executor);
      continue;
    }
    scopeExecutors.set(executor.surfaceId, executor);
  }

  return Object.freeze({
    collectionExecutors,
    scopeExecutors,
    surfaceRegistry,
  });
}

export function resolveSerializedQueryCollectionExecutor<ReadOptions>(
  registry: SerializedQueryExecutorRegistry<ReadOptions>,
  query: NormalizedRegisteredSerializedQuery<"collection">,
): SerializedQueryExecutorResolution<ReadOptions, "collection"> {
  const surface = getInstalledSurfaceForKind(registry.surfaceRegistry, query.indexId, "collection");
  if (!surface) {
    return {
      ok: false,
      code: "unregistered-surface",
      queryKind: "collection",
    };
  }
  return resolveRegisteredExecutor("collection", surface, registry.collectionExecutors);
}

export function resolveSerializedQueryScopeExecutor<ReadOptions>(
  registry: SerializedQueryExecutorRegistry<ReadOptions>,
  query: NormalizedRegisteredSerializedQuery<"scope">,
): SerializedQueryExecutorResolution<ReadOptions, "scope"> {
  const matchedSurfaces = registry.surfaceRegistry.surfaces.filter(
    (surface): surface is InstalledSerializedQuerySurface<"scope"> =>
      isInstalledSurfaceForKind(surface, "scope") && matchesInstalledScopeSurface(query, surface),
  );

  if (matchedSurfaces.length === 0) {
    return {
      ok: false,
      code: "unregistered-surface",
      queryKind: "scope",
    };
  }
  if (matchedSurfaces.length > 1) {
    return {
      ok: false,
      code: "ambiguous-surface",
      queryKind: "scope",
      surfaces: Object.freeze([...matchedSurfaces]),
    };
  }

  const [surface] = matchedSurfaces;
  if (!surface) {
    return {
      ok: false,
      code: "unregistered-surface",
      queryKind: "scope",
    };
  }

  return resolveRegisteredExecutor("scope", surface, registry.scopeExecutors);
}
