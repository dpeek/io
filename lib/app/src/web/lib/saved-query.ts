import {
  normalizeSerializedQueryRequest,
  validateSerializedQueryRequest,
  type NormalizedQueryRequest,
  type QueryIdentityExecutionContext,
  type QueryLiteral,
  type QueryParameterDefinition,
  type SerializedQueryRequest,
} from "@io/graph-client";

import {
  validateQueryContainerSpec,
  type QueryContainerSourceResolver,
  type QueryContainerSpec,
  type QuerySurfaceRendererCompatibility,
} from "./query-container.js";
import type { QueryRendererCapability } from "./query-container.js";
import {
  getQueryEditorSurface,
  serializeQueryEditorDraft,
  validateQueryEditorDraft,
  type QueryEditorCatalog,
  type QueryEditorDraft,
  type QueryEditorSurfaceSpec,
} from "./query-editor.js";

export type SavedQueryRecord = {
  readonly catalogId: string;
  readonly catalogVersion: string;
  readonly id: string;
  readonly name: string;
  readonly parameterDefinitions: readonly QueryParameterDefinition[];
  readonly request: SerializedQueryRequest;
  readonly surfaceId: string;
  readonly surfaceVersion: string;
  readonly updatedAt: string;
};

export type SavedViewRecord = {
  readonly catalogId: string;
  readonly catalogVersion: string;
  readonly id: string;
  readonly name: string;
  readonly queryId: string;
  readonly spec: Omit<QueryContainerSpec, "query"> & {
    readonly query: {
      readonly kind: "saved";
      readonly params?: Readonly<Record<string, QueryLiteral>>;
      readonly queryId: string;
    };
  };
  readonly surfaceId: string;
  readonly surfaceVersion: string;
  readonly updatedAt: string;
};

export type SavedQueryStore = {
  deleteSavedQuery(id: string): void;
  deleteSavedView(id: string): void;
  getSavedQuery(id: string): SavedQueryRecord | undefined;
  getSavedView(id: string): SavedViewRecord | undefined;
  listSavedQueries(): readonly SavedQueryRecord[];
  listSavedViews(): readonly SavedViewRecord[];
  saveSavedQuery(
    input: Omit<SavedQueryRecord, "id" | "updatedAt"> & {
      readonly id?: string;
    },
  ): SavedQueryRecord;
  saveSavedView(
    input: Omit<SavedViewRecord, "id" | "updatedAt"> & {
      readonly id?: string;
    },
  ): SavedViewRecord;
};

export type SavedQueryStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export type SavedQueryResolution = {
  readonly normalizedRequest: NormalizedQueryRequest;
  readonly query: SavedQueryRecord;
  readonly request: SerializedQueryRequest;
  readonly surface: QueryEditorSurfaceSpec;
};

export type SavedViewResolution = SavedQueryResolution & {
  readonly view: SavedViewRecord;
};

export type SavedQueryCompatibilityResult =
  | {
      readonly ok: true;
      readonly surface: QueryEditorSurfaceSpec;
    }
  | {
      readonly code: "incompatible-query" | "stale-query";
      readonly message: string;
      readonly ok: false;
    };

export type SavedViewCompatibilityResult =
  | {
      readonly ok: true;
      readonly surface: QueryEditorSurfaceSpec;
    }
  | {
      readonly code: "incompatible-view" | "stale-view";
      readonly message: string;
      readonly ok: false;
    };

export class SavedQuerySaveError extends Error {
  readonly code: string;
  readonly issues?: readonly {
    readonly code: string;
    readonly message: string;
    readonly path: string;
  }[];

  constructor(
    code: string,
    message: string,
    options: {
      readonly issues?: readonly {
        readonly code: string;
        readonly message: string;
        readonly path: string;
      }[];
    } = {},
  ) {
    super(message);
    this.code = code;
    this.issues = options.issues;
    this.name = "SavedQuerySaveError";
  }
}

const savedQueryStoreVersion = 3;
const defaultSavedQueryStorageKey = "io.web.query-workbench";
const savedQueryIdPrefix = "saved-query:";
const savedViewIdPrefix = "saved-view:";

type SavedQuerySurfaceRef = {
  readonly catalogId: string;
  readonly catalogVersion: string;
  readonly surfaceId: string;
  readonly surfaceVersion: string;
};

export function createSavedQueryMemoryStore(
  seed: {
    readonly queries?: readonly SavedQueryRecord[];
    readonly views?: readonly SavedViewRecord[];
  } = {},
): SavedQueryStore {
  const queries = new Map(seed.queries?.map((entry) => [entry.id, entry]));
  const views = new Map(seed.views?.map((entry) => [entry.id, entry]));
  let nextQuerySequence = readNextSavedEntrySequence(queries.keys(), savedQueryIdPrefix);
  let nextViewSequence = readNextSavedEntrySequence(views.keys(), savedViewIdPrefix);

  return {
    deleteSavedQuery(id) {
      queries.delete(id);
      for (const [viewId, view] of views.entries()) {
        if (view.queryId === id) {
          views.delete(viewId);
        }
      }
    },
    deleteSavedView(id) {
      views.delete(id);
    },
    getSavedQuery(id) {
      return queries.get(id);
    },
    getSavedView(id) {
      return views.get(id);
    },
    listSavedQueries() {
      return [...queries.values()].sort(compareSavedEntries);
    },
    listSavedViews() {
      return [...views.values()].sort(compareSavedEntries);
    },
    saveSavedQuery(input) {
      const id = input.id ?? `${savedQueryIdPrefix}${nextQuerySequence++}`;
      const saved = Object.freeze({
        catalogId: input.catalogId,
        catalogVersion: input.catalogVersion,
        id,
        name: input.name,
        parameterDefinitions: [...input.parameterDefinitions],
        request: input.request,
        surfaceId: input.surfaceId,
        surfaceVersion: input.surfaceVersion,
        updatedAt: new Date().toISOString(),
      } satisfies SavedQueryRecord);
      queries.set(id, saved);
      return saved;
    },
    saveSavedView(input) {
      const id = input.id ?? `${savedViewIdPrefix}${nextViewSequence++}`;
      const saved = Object.freeze({
        catalogId: input.catalogId,
        catalogVersion: input.catalogVersion,
        id,
        name: input.name,
        queryId: input.queryId,
        spec: input.spec,
        surfaceId: input.surfaceId,
        surfaceVersion: input.surfaceVersion,
        updatedAt: new Date().toISOString(),
      } satisfies SavedViewRecord);
      views.set(id, saved);
      return saved;
    },
  };
}

export function createSavedQueryBrowserStore(
  options: {
    readonly key?: string;
    readonly storage?: SavedQueryStorage;
  } = {},
): SavedQueryStore {
  const storage =
    options.storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
  if (!storage) {
    return createSavedQueryMemoryStore();
  }

  const key = options.key ?? defaultSavedQueryStorageKey;
  const persisted = readPersistedSavedQueryStore(storage, key);
  const store = createSavedQueryMemoryStore(persisted);
  return {
    deleteSavedQuery(id) {
      store.deleteSavedQuery(id);
      writePersistedSavedQueryStore(storage, key, store);
    },
    deleteSavedView(id) {
      store.deleteSavedView(id);
      writePersistedSavedQueryStore(storage, key, store);
    },
    getSavedQuery(id) {
      return store.getSavedQuery(id);
    },
    getSavedView(id) {
      return store.getSavedView(id);
    },
    listSavedQueries() {
      return store.listSavedQueries();
    },
    listSavedViews() {
      return store.listSavedViews();
    },
    saveSavedQuery(input) {
      const saved = store.saveSavedQuery(input);
      writePersistedSavedQueryStore(storage, key, store);
      return saved;
    },
    saveSavedView(input) {
      const saved = store.saveSavedView(input);
      writePersistedSavedQueryStore(storage, key, store);
      return saved;
    },
  };
}

export function saveSavedQueryDraft(input: {
  readonly catalog: QueryEditorCatalog;
  readonly draft: QueryEditorDraft;
  readonly id?: string;
  readonly name: string;
  readonly store: SavedQueryStore;
}): SavedQueryRecord {
  const validation = validateQueryEditorDraft(input.draft, input.catalog);
  if (!validation.ok) {
    throw new SavedQuerySaveError(
      validation.issues[0]?.code ?? "invalid-draft",
      validation.issues[0]?.message ?? "Query draft is invalid.",
      {
        issues: validation.issues,
      },
    );
  }
  const serialized = serializeQueryEditorDraft(input.draft, input.catalog);
  const surfaceRef = requireInstalledSurfaceRef(serialized.surface);
  return input.store.saveSavedQuery({
    ...(input.id ? { id: input.id } : {}),
    catalogId: surfaceRef.catalogId,
    catalogVersion: surfaceRef.catalogVersion,
    name: input.name.trim() || "Untitled query",
    parameterDefinitions: serialized.parameterDefinitions,
    request: serialized.request,
    surfaceId: surfaceRef.surfaceId,
    surfaceVersion: surfaceRef.surfaceVersion,
  });
}

export function saveSavedViewDraft(input: {
  readonly catalog: QueryEditorCatalog;
  readonly draft: QueryEditorDraft;
  readonly queryId?: string;
  readonly queryName: string;
  readonly rendererCapabilities: Readonly<Record<string, QueryRendererCapability>>;
  readonly viewId?: string;
  readonly viewName: string;
  readonly spec: Omit<QueryContainerSpec, "query">;
  readonly store: SavedQueryStore;
  readonly surface?: QuerySurfaceRendererCompatibility;
}): {
  readonly query: SavedQueryRecord;
  readonly view: SavedViewRecord;
} {
  const validation = validateQueryEditorDraft(input.draft, input.catalog);
  if (!validation.ok) {
    throw new SavedQuerySaveError(
      validation.issues[0]?.code ?? "invalid-draft",
      validation.issues[0]?.message ?? "Query draft is invalid.",
      {
        issues: validation.issues,
      },
    );
  }
  const serialized = serializeQueryEditorDraft(input.draft, input.catalog);
  const surfaceRef = requireInstalledSurfaceRef(serialized.surface);
  if (!input.surface) {
    throw new SavedQuerySaveError(
      "missing-surface-contract",
      `Saved view "${input.viewName.trim() || "Untitled view"}" does not have a current renderer compatibility contract.`,
    );
  }
  const spec = {
    ...input.spec,
    query: {
      kind: "saved",
      queryId: "pending",
    },
  } satisfies SavedViewRecord["spec"];
  const containerValidation = validateQueryContainerSpec(spec, {
    rendererCapabilities: input.rendererCapabilities,
    surface: input.surface,
  });
  if (!containerValidation.ok) {
    const issue = containerValidation.issues[0];
    throw new SavedQuerySaveError(
      issue?.code ?? "invalid-view",
      issue ? formatValidationIssue(issue) : "Saved view is invalid.",
      {
        issues: containerValidation.issues,
      },
    );
  }
  const query = input.store.saveSavedQuery({
    ...(input.queryId ? { id: input.queryId } : {}),
    catalogId: surfaceRef.catalogId,
    catalogVersion: surfaceRef.catalogVersion,
    name: input.queryName.trim() || "Untitled query",
    parameterDefinitions: serialized.parameterDefinitions,
    request: serialized.request,
    surfaceId: surfaceRef.surfaceId,
    surfaceVersion: surfaceRef.surfaceVersion,
  });
  const view = input.store.saveSavedView({
    ...(input.viewId ? { id: input.viewId } : {}),
    catalogId: surfaceRef.catalogId,
    catalogVersion: surfaceRef.catalogVersion,
    name: input.viewName.trim() || "Untitled view",
    queryId: query.id,
    spec: {
      ...spec,
      query: {
        ...spec.query,
        queryId: query.id,
      },
    },
    surfaceId: surfaceRef.surfaceId,
    surfaceVersion: surfaceRef.surfaceVersion,
  });
  return { query, view };
}

export async function resolveSavedQueryRecord(input: {
  readonly catalog: QueryEditorCatalog;
  readonly executionContext?: QueryIdentityExecutionContext;
  readonly params?: Readonly<Record<string, QueryLiteral>>;
  readonly query: SavedQueryRecord;
}): Promise<SavedQueryResolution> {
  const compatibility = validateSavedQueryCompatibility(input.query, input.catalog);
  if (!compatibility.ok) {
    const error = new Error(compatibility.message);
    (error as Error & { code: string }).code = compatibility.code;
    throw error;
  }
  const request = mergeQueryParams(input.query.request, input.params);
  validateSerializedQueryRequest(request, {
    parameterDefinitions: input.query.parameterDefinitions,
  });
  const normalizedRequest = await normalizeSerializedQueryRequest(request, {
    executionContext: input.executionContext,
    parameterDefinitions: input.query.parameterDefinitions,
  });
  return {
    normalizedRequest,
    query: input.query,
    request,
    surface: compatibility.surface,
  };
}

export async function resolveSavedViewRecord(input: {
  readonly catalog: QueryEditorCatalog;
  readonly executionContext?: QueryIdentityExecutionContext;
  readonly params?: Readonly<Record<string, QueryLiteral>>;
  readonly query: SavedQueryRecord;
  readonly rendererCapabilities?: Readonly<Record<string, QueryRendererCapability>>;
  readonly resolveSurfaceCompatibility?: (
    surfaceId: string,
  ) => QuerySurfaceRendererCompatibility | undefined;
  readonly view: SavedViewRecord;
}): Promise<SavedViewResolution> {
  const compatibility = validateSavedViewCompatibility({
    catalog: input.catalog,
    query: input.query,
    rendererCapabilities: input.rendererCapabilities,
    resolveSurfaceCompatibility: input.resolveSurfaceCompatibility,
    view: input.view,
  });
  if (!compatibility.ok) {
    const error = new Error(compatibility.message);
    (error as Error & { code: string }).code = compatibility.code;
    throw error;
  }
  const resolvedQuery = await resolveSavedQueryRecord({
    catalog: input.catalog,
    executionContext: input.executionContext,
    params: input.params ?? input.view.spec.query.params,
    query: input.query,
  });
  return {
    ...resolvedQuery,
    view: input.view,
  };
}

export function createSavedQuerySourceResolver(
  store: Pick<SavedQueryStore, "getSavedQuery">,
  options: {
    readonly catalog?: QueryEditorCatalog;
  } = {},
): QueryContainerSourceResolver {
  return async (source) => {
    if (source.kind === "inline") {
      return { request: source.request };
    }
    const saved = store.getSavedQuery(source.queryId);
    if (!saved) {
      const error = new Error(`Saved query "${source.queryId}" is no longer available.`);
      (error as Error & { code: string }).code = "saved-query-stale";
      throw error;
    }
    if (options.catalog) {
      const compatibility = validateSavedQueryCompatibility(saved, options.catalog);
      if (!compatibility.ok) {
        const error = new Error(compatibility.message);
        (error as Error & { code: string }).code =
          compatibility.code === "stale-query" ? "saved-query-stale" : "saved-query-incompatible";
        throw error;
      }
    }
    const request = mergeQueryParams(saved.request, source.params);
    validateSerializedQueryRequest(request, {
      parameterDefinitions: saved.parameterDefinitions,
    });
    return {
      request,
      sourceCacheKey: `saved:${saved.id}`,
    };
  };
}

export function validateSavedQueryCompatibility(
  query: SavedQueryRecord,
  catalog: QueryEditorCatalog,
): SavedQueryCompatibilityResult {
  const requestSurfaceId = resolveSerializedSurfaceId(query.request);
  if (!requestSurfaceId) {
    return {
      code: "incompatible-query",
      message: `Saved query "${query.id}" uses unsupported query kind "${query.request.query.kind}".`,
      ok: false,
    };
  }
  if (requestSurfaceId !== query.surfaceId) {
    return {
      code: "incompatible-query",
      message:
        `Saved query "${query.id}" references surface "${query.surfaceId}" ` +
        `but serializes "${requestSurfaceId}".`,
      ok: false,
    };
  }
  const surface = getQueryEditorSurface(catalog, query.surfaceId);
  if (!surface) {
    return {
      code: "stale-query",
      message: `Saved query "${query.id}" references removed query surface "${query.surfaceId}".`,
      ok: false,
    };
  }
  const currentRef = readInstalledSurfaceRef(surface);
  if (!currentRef) {
    return {
      code: "incompatible-query",
      message:
        `Saved query "${query.id}" cannot be validated because query surface ` +
        `"${query.surfaceId}" does not expose installed catalog metadata.`,
      ok: false,
    };
  }
  if (currentRef.catalogId !== query.catalogId) {
    return {
      code: "stale-query",
      message:
        `Saved query "${query.id}" references removed query catalog ` + `"${query.catalogId}".`,
      ok: false,
    };
  }
  if (currentRef.catalogVersion !== query.catalogVersion) {
    return {
      code: "incompatible-query",
      message:
        `Saved query "${query.id}" references incompatible query catalog ` +
        `"${query.catalogId}@${query.catalogVersion}".`,
      ok: false,
    };
  }
  if (currentRef.surfaceVersion !== query.surfaceVersion) {
    return {
      code: "incompatible-query",
      message:
        `Saved query "${query.id}" references incompatible surface version ` +
        `"${query.surfaceVersion}".`,
      ok: false,
    };
  }
  return {
    ok: true,
    surface,
  };
}

export function validateSavedViewCompatibility(input: {
  readonly catalog: QueryEditorCatalog;
  readonly query: SavedQueryRecord;
  readonly rendererCapabilities?: Readonly<Record<string, QueryRendererCapability>>;
  readonly resolveSurfaceCompatibility?: (
    surfaceId: string,
  ) => QuerySurfaceRendererCompatibility | undefined;
  readonly view: SavedViewRecord;
}): SavedViewCompatibilityResult {
  const { catalog, query, rendererCapabilities, resolveSurfaceCompatibility, view } = input;
  const queryCompatibility = validateSavedQueryCompatibility(query, catalog);
  if (!queryCompatibility.ok) {
    return {
      code: queryCompatibility.code === "stale-query" ? "stale-view" : "incompatible-view",
      message:
        `Saved view "${view.id}" references saved query "${query.id}" ` +
        `that is no longer valid: ${queryCompatibility.message}`,
      ok: false,
    };
  }
  if (view.spec.query.queryId !== view.queryId) {
    return {
      code: "incompatible-view",
      message:
        `Saved view "${view.id}" references saved query "${view.spec.query.queryId}" ` +
        `in its container binding but is stored against "${view.queryId}".`,
      ok: false,
    };
  }
  if (view.surfaceId !== query.surfaceId) {
    return {
      code: "incompatible-view",
      message:
        `Saved view "${view.id}" references surface "${view.surfaceId}" ` +
        `but saved query "${query.id}" uses "${query.surfaceId}".`,
      ok: false,
    };
  }
  if (view.catalogId !== query.catalogId || view.catalogVersion !== query.catalogVersion) {
    return {
      code: "incompatible-view",
      message:
        `Saved view "${view.id}" references query catalog ` +
        `"${view.catalogId}@${view.catalogVersion}" but saved query "${query.id}" uses ` +
        `"${query.catalogId}@${query.catalogVersion}".`,
      ok: false,
    };
  }
  if (view.surfaceVersion !== query.surfaceVersion) {
    return {
      code: "incompatible-view",
      message:
        `Saved view "${view.id}" references surface version "${view.surfaceVersion}" ` +
        `but saved query "${query.id}" uses "${query.surfaceVersion}".`,
      ok: false,
    };
  }
  const surfaceCompatibility = resolveSurfaceCompatibility?.(view.surfaceId);
  if (resolveSurfaceCompatibility && !surfaceCompatibility) {
    return {
      code: "stale-view",
      message:
        `Saved view "${view.id}" references query surface "${view.surfaceId}" ` +
        `but the current renderer compatibility contract is missing.`,
      ok: false,
    };
  }
  if (surfaceCompatibility && rendererCapabilities) {
    const containerValidation = validateQueryContainerSpec(view.spec, {
      rendererCapabilities,
      surface: surfaceCompatibility,
    });
    if (!containerValidation.ok) {
      return {
        code: "incompatible-view",
        message:
          `Saved view "${view.id}" has incompatible container defaults: ` +
          `${formatValidationIssue(containerValidation.issues[0])}`,
        ok: false,
      };
    }
  }
  return {
    ok: true,
    surface: queryCompatibility.surface,
  };
}

function requireInstalledSurfaceRef(surface: QueryEditorSurfaceSpec): SavedQuerySurfaceRef {
  const ref = readInstalledSurfaceRef(surface);
  if (!ref) {
    throw new SavedQuerySaveError(
      "missing-catalog-ref",
      `Query surface "${surface.surfaceId}" does not expose installed catalog metadata.`,
    );
  }
  return ref;
}

function readInstalledSurfaceRef(
  surface: QueryEditorSurfaceSpec,
): SavedQuerySurfaceRef | undefined {
  const catalogId = readTrimmedString(surface.catalogId);
  const catalogVersion = readTrimmedString(surface.catalogVersion);
  if (!catalogId || !catalogVersion) {
    return undefined;
  }
  return {
    catalogId,
    catalogVersion,
    surfaceId: surface.surfaceId,
    surfaceVersion: surface.surfaceVersion,
  };
}

function readPersistedSavedQueryStore(
  storage: SavedQueryStorage,
  key: string,
): {
  readonly queries?: readonly SavedQueryRecord[];
  readonly views?: readonly SavedViewRecord[];
} {
  const raw = storage.getItem(key);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as {
      readonly queries?: readonly SavedQueryRecord[];
      readonly version?: number;
      readonly views?: readonly SavedViewRecord[];
    };
    if (parsed.version !== savedQueryStoreVersion) {
      storage.removeItem(key);
      return {};
    }
    return {
      queries: parsed.queries?.filter(isSavedQueryRecord) ?? [],
      views: parsed.views?.filter(isSavedViewRecord) ?? [],
    };
  } catch {
    storage.removeItem(key);
    return {};
  }
}

function writePersistedSavedQueryStore(
  storage: SavedQueryStorage,
  key: string,
  store: Pick<SavedQueryStore, "listSavedQueries" | "listSavedViews">,
): void {
  storage.setItem(
    key,
    JSON.stringify({
      queries: store.listSavedQueries(),
      version: savedQueryStoreVersion,
      views: store.listSavedViews(),
    }),
  );
}

function compareSavedEntries(
  left: { readonly name: string; readonly updatedAt: string },
  right: { readonly name: string; readonly updatedAt: string },
): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name);
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function mergeQueryParams(
  request: SerializedQueryRequest,
  params?: Readonly<Record<string, QueryLiteral>>,
): SerializedQueryRequest {
  if (!params || Object.keys(params).length === 0) {
    return request;
  }
  return {
    ...request,
    params: {
      ...request.params,
      ...params,
    },
  };
}

function resolveSerializedSurfaceId(request: SerializedQueryRequest): string | undefined {
  if (request.query.kind === "collection") {
    return request.query.indexId;
  }
  if (request.query.kind === "scope") {
    return request.query.scopeId;
  }
  return undefined;
}

function formatValidationIssue(
  issue:
    | {
        readonly message: string;
        readonly path: string;
      }
    | undefined,
): string {
  return issue ? `${issue.path} ${issue.message}` : "Unknown validation issue.";
}

function isSavedQueryRecord(value: unknown): value is SavedQueryRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<SavedQueryRecord>;
  return (
    typeof candidate.catalogId === "string" &&
    typeof candidate.catalogVersion === "string" &&
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.surfaceId === "string" &&
    typeof candidate.surfaceVersion === "string" &&
    typeof candidate.updatedAt === "string" &&
    Array.isArray(candidate.parameterDefinitions) &&
    Boolean(candidate.request)
  );
}

function isSavedViewRecord(value: unknown): value is SavedViewRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<SavedViewRecord>;
  return (
    typeof candidate.catalogId === "string" &&
    typeof candidate.catalogVersion === "string" &&
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.queryId === "string" &&
    typeof candidate.surfaceId === "string" &&
    typeof candidate.surfaceVersion === "string" &&
    typeof candidate.updatedAt === "string" &&
    Boolean(candidate.spec)
  );
}

function readNextSavedEntrySequence(
  ids: IterableIterator<string>,
  prefix: typeof savedQueryIdPrefix | typeof savedViewIdPrefix,
): number {
  let max = 0;
  for (const id of ids) {
    const sequence = readSavedEntrySequence(id, prefix);
    if (sequence !== undefined && sequence > max) {
      max = sequence;
    }
  }
  return max + 1;
}

function readSavedEntrySequence(
  id: string,
  prefix: typeof savedQueryIdPrefix | typeof savedViewIdPrefix,
): number | undefined {
  if (!id.startsWith(prefix)) {
    return undefined;
  }
  const suffix = id.slice(prefix.length);
  const sequence = Number.parseInt(suffix, 10);
  if (!Number.isInteger(sequence) || sequence <= 0 || `${sequence}` !== suffix) {
    return undefined;
  }
  return sequence;
}
