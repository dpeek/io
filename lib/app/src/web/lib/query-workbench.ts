import {
  addQueryEditorFilter,
  createQueryEditorDraft,
  hydrateQueryEditorDraft,
  QueryEditorHydrationError,
  updateQueryEditorFilter,
  type QueryEditorCatalog,
  type QueryEditorDraft,
} from "@io/graph-module-core/react-dom/query-editor";
import { workflowBuiltInQuerySurfaceIds } from "@io/graph-module-workflow";
import {
  validateSerializedQueryRequest,
  type QueryLiteral,
  type QueryParameterDefinition,
  type SerializedQueryRequest,
} from "@io/graph-client";

import {
  createQueryContainerRuntime,
  type QueryContainerPageExecutor,
  type QueryContainerRuntimeController,
  type QueryContainerSourceResolver,
  type QueryContainerSpec,
  type QuerySurfaceRendererCompatibility,
} from "./query-container.js";
import type { QueryRendererCapability } from "./query-container.js";
import { requestSerializedQuery } from "./query-transport.js";
import {
  createSavedQueryRecordInputFromDraft,
  createSavedQueryRecordSourceResolver,
  createSavedViewRecordInput,
  SavedQuerySaveError,
  validateSavedQueryCompatibility,
  validateSavedViewCompatibility,
  type SavedQueryRecord,
  type SavedViewRecord,
} from "./saved-query.js";
import type { QueryRouteSearch } from "./query-route-state.js";

export type QueryWorkbenchSavedQuery = SavedQueryRecord;
export type QueryWorkbenchSavedView = SavedViewRecord;

export type QueryWorkbenchStore = {
  deleteQuery(id: string): void;
  deleteView(id: string): void;
  getQuery(id: string): QueryWorkbenchSavedQuery | undefined;
  getView(id: string): QueryWorkbenchSavedView | undefined;
  listQueries(): readonly QueryWorkbenchSavedQuery[];
  listViews(): readonly QueryWorkbenchSavedView[];
  saveQuery(
    input: Omit<QueryWorkbenchSavedQuery, "id" | "updatedAt"> & {
      readonly id?: string;
    },
  ): QueryWorkbenchSavedQuery;
  saveView(
    input: Omit<QueryWorkbenchSavedView, "id" | "updatedAt"> & {
      readonly id?: string;
    },
  ): QueryWorkbenchSavedView;
};

export type QueryWorkbenchRouteTarget =
  | {
      readonly kind: "blank";
    }
  | {
      readonly kind: "draft";
      readonly parameterDefinitions?: readonly QueryParameterDefinition[];
      readonly request: SerializedQueryRequest;
    }
  | {
      readonly kind: "saved-query";
      readonly query: QueryWorkbenchSavedQuery;
    }
  | {
      readonly kind: "saved-view";
      readonly query: QueryWorkbenchSavedQuery;
      readonly view: QueryWorkbenchSavedView;
    }
  | {
      readonly code:
        | "invalid-draft"
        | "invalid-params"
        | "stale-query"
        | "stale-view"
        | "incompatible-query"
        | "incompatible-view";
      readonly kind: "invalid";
      readonly message: string;
    };

export type QueryWorkbenchSurfaceCompatibilityResolver = (
  surfaceId: string,
) => QuerySurfaceRendererCompatibility | undefined;

export class QueryWorkbenchSaveError extends Error {
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
    this.name = "QueryWorkbenchSaveError";
  }
}

export type QueryWorkbenchStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export type HydratedQueryWorkbenchDraft = {
  readonly draft: QueryEditorDraft;
  readonly queryName?: string;
  readonly savedQueryId?: string;
  readonly savedViewId?: string;
  readonly viewName?: string;
};

export type ResolvedQueryWorkbenchState = {
  readonly hydrated?: HydratedQueryWorkbenchDraft;
  readonly target: QueryWorkbenchRouteTarget;
};

const queryWorkbenchStoreVersion = 3;
const defaultQueryWorkbenchStorageKey = "io.web.query-workbench";

type QueryWorkbenchDraftRouteState = {
  readonly parameterDefinitions?: readonly QueryParameterDefinition[];
  readonly request: SerializedQueryRequest;
};

export function encodeQueryWorkbenchDraft(
  input: QueryWorkbenchDraftRouteState | SerializedQueryRequest,
): string {
  return encodeWorkbenchValue("request" in input ? input : { request: input });
}

export function decodeQueryWorkbenchDraft(
  value: string,
): QueryWorkbenchDraftRouteState | undefined {
  const parsed = decodeWorkbenchValue(value);
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const candidate = readQueryWorkbenchDraftRouteState(parsed);
  if (!candidate) {
    return undefined;
  }
  try {
    validateSerializedQueryRequest(candidate.request, {
      parameterDefinitions: candidate.parameterDefinitions,
    });
    return candidate;
  } catch {
    return undefined;
  }
}

export function encodeQueryWorkbenchParamOverrides(
  overrides: Readonly<Record<string, QueryLiteral>>,
): string {
  return encodeWorkbenchValue(overrides);
}

export function decodeQueryWorkbenchParamOverrides(
  value: string,
): Readonly<Record<string, QueryLiteral>> | undefined {
  const parsed = decodeWorkbenchValue(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const entries = Object.entries(parsed);
  if (
    entries.some(([name, literal]) => name.trim().length === 0 || !isQueryLiteralValue(literal))
  ) {
    return undefined;
  }
  return Object.freeze(Object.fromEntries(entries)) as Readonly<Record<string, QueryLiteral>>;
}

export function resolveQueryWorkbenchRouteTarget(
  search: QueryRouteSearch,
  store: Pick<QueryWorkbenchStore, "getQuery" | "getView">,
  _catalog: QueryEditorCatalog,
): QueryWorkbenchRouteTarget {
  if (
    (search.queryId || search.viewId) &&
    search.params &&
    !decodeQueryWorkbenchParamOverrides(search.params)
  ) {
    return {
      code: "invalid-params",
      kind: "invalid",
      message: "Route parameter overrides are invalid or stale.",
    };
  }
  if (search.viewId) {
    const view = store.getView(search.viewId);
    if (!view) {
      return {
        code: "stale-view",
        kind: "invalid",
        message: `Saved view "${search.viewId}" is no longer available.`,
      };
    }
    const query = store.getQuery(view.queryId);
    if (!query) {
      return {
        code: "stale-view",
        kind: "invalid",
        message: `Saved view "${view.id}" references stale query "${view.queryId}".`,
      };
    }
    return {
      kind: "saved-view",
      query,
      view,
    };
  }
  if (search.queryId) {
    const query = store.getQuery(search.queryId);
    if (!query) {
      return {
        code: "stale-query",
        kind: "invalid",
        message: `Saved query "${search.queryId}" is no longer available.`,
      };
    }
    return {
      kind: "saved-query",
      query,
    };
  }
  if (search.draft) {
    const draft = decodeQueryWorkbenchDraft(search.draft);
    if (!draft) {
      return {
        code: "invalid-draft",
        kind: "invalid",
        message: "Draft preview state is invalid or stale.",
      };
    }
    return {
      kind: "draft",
      ...(draft.parameterDefinitions ? { parameterDefinitions: draft.parameterDefinitions } : {}),
      request: draft.request,
    };
  }
  return {
    kind: "blank",
  };
}

export function hydrateQueryWorkbenchDraft(input: {
  readonly catalog: QueryEditorCatalog;
  readonly target: QueryWorkbenchRouteTarget;
}): HydratedQueryWorkbenchDraft | undefined {
  const { catalog, target } = input;
  if (target.kind === "blank" || target.kind === "invalid") {
    return undefined;
  }
  if (target.kind === "draft") {
    return {
      draft: hydrateQueryEditorDraft({
        catalog,
        parameterDefinitions: target.parameterDefinitions,
        request: target.request,
      }),
    };
  }
  if (target.kind === "saved-query") {
    return {
      draft: hydrateQueryEditorDraft({
        catalog,
        parameterDefinitions: target.query.parameterDefinitions,
        request: target.query.request,
      }),
      queryName: target.query.name,
      savedQueryId: target.query.id,
    };
  }
  return {
    draft: hydrateQueryEditorDraft({
      catalog,
      parameterDefinitions: target.query.parameterDefinitions,
      request: target.query.request,
    }),
    queryName: target.query.name,
    savedQueryId: target.query.id,
    savedViewId: target.view.id,
    viewName: target.view.name,
  };
}

export function resolveQueryWorkbenchState(input: {
  readonly catalog: QueryEditorCatalog;
  readonly rendererCapabilities?: Readonly<Record<string, QueryRendererCapability>>;
  readonly resolveSurfaceCompatibility?: QueryWorkbenchSurfaceCompatibilityResolver;
  readonly target: QueryWorkbenchRouteTarget;
}): ResolvedQueryWorkbenchState {
  const { catalog, rendererCapabilities, resolveSurfaceCompatibility, target } = input;
  if (target.kind === "blank" || target.kind === "invalid") {
    return { target };
  }
  if (target.kind === "saved-query") {
    const compatibility = validateSavedQueryCompatibility(target.query, catalog);
    if (!compatibility.ok) {
      return {
        target: {
          code: compatibility.code,
          kind: "invalid",
          message: compatibility.message,
        },
      };
    }
  }
  if (target.kind === "saved-view") {
    const compatibility = validateSavedViewCompatibility({
      catalog,
      query: target.query,
      rendererCapabilities,
      resolveSurfaceCompatibility,
      view: target.view,
    });
    if (!compatibility.ok) {
      return {
        target: {
          code: compatibility.code,
          kind: "invalid",
          message: compatibility.message,
        },
      };
    }
  }
  try {
    return {
      hydrated: hydrateQueryWorkbenchDraft({ catalog, target }),
      target,
    };
  } catch (error) {
    if (!(error instanceof QueryEditorHydrationError)) {
      throw error;
    }
    if (target.kind === "saved-view") {
      return {
        target: {
          code: "incompatible-view",
          kind: "invalid",
          message: `Saved view "${target.view.id}" can no longer hydrate against the current query surfaces.`,
        },
      };
    }
    if (target.kind === "saved-query") {
      return {
        target: {
          code: "incompatible-query",
          kind: "invalid",
          message: `Saved query "${target.query.id}" can no longer hydrate against the current query surfaces.`,
        },
      };
    }
    return {
      target: {
        code: "invalid-draft",
        kind: "invalid",
        message: "Draft preview state is stale against the current query surfaces.",
      },
    };
  }
}

export function createQueryWorkbenchMemoryStore(
  seed: {
    readonly queries?: readonly QueryWorkbenchSavedQuery[];
    readonly views?: readonly QueryWorkbenchSavedView[];
  } = {},
): QueryWorkbenchStore {
  const queries = new Map(seed.queries?.map((entry) => [entry.id, entry]));
  const views = new Map(seed.views?.map((entry) => [entry.id, entry]));
  let queryCount = seed.queries?.length ?? 0;
  let viewCount = seed.views?.length ?? 0;

  return {
    deleteQuery(id) {
      queries.delete(id);
    },
    deleteView(id) {
      views.delete(id);
    },
    getQuery(id) {
      return queries.get(id);
    },
    getView(id) {
      return views.get(id);
    },
    listQueries() {
      return [...queries.values()].sort(compareSavedEntries);
    },
    listViews() {
      return [...views.values()].sort(compareSavedEntries);
    },
    saveQuery(input) {
      const id = input.id ?? `saved-query:${++queryCount}`;
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
      } satisfies QueryWorkbenchSavedQuery);
      queries.set(id, saved);
      return saved;
    },
    saveView(input) {
      const id = input.id ?? `saved-view:${++viewCount}`;
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
      } satisfies QueryWorkbenchSavedView);
      views.set(id, saved);
      return saved;
    },
  };
}

export function createQueryWorkbenchBrowserStore(
  options: {
    readonly key?: string;
    readonly storage?: QueryWorkbenchStorage;
  } = {},
): QueryWorkbenchStore {
  const storage =
    options.storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
  if (!storage) {
    return createQueryWorkbenchMemoryStore();
  }

  const persisted = readPersistedWorkbenchStore(
    storage,
    options.key ?? defaultQueryWorkbenchStorageKey,
  );
  const store = createQueryWorkbenchMemoryStore(persisted);
  return {
    deleteQuery(id) {
      store.deleteQuery(id);
      writePersistedWorkbenchStore(storage, options.key ?? defaultQueryWorkbenchStorageKey, store);
    },
    deleteView(id) {
      store.deleteView(id);
      writePersistedWorkbenchStore(storage, options.key ?? defaultQueryWorkbenchStorageKey, store);
    },
    getQuery(id) {
      return store.getQuery(id);
    },
    getView(id) {
      return store.getView(id);
    },
    listQueries() {
      return store.listQueries();
    },
    listViews() {
      return store.listViews();
    },
    saveQuery(input) {
      const saved = store.saveQuery(input);
      writePersistedWorkbenchStore(storage, options.key ?? defaultQueryWorkbenchStorageKey, store);
      return saved;
    },
    saveView(input) {
      const saved = store.saveView(input);
      writePersistedWorkbenchStore(storage, options.key ?? defaultQueryWorkbenchStorageKey, store);
      return saved;
    },
  };
}

export function saveQueryWorkbenchQuery(input: {
  readonly catalog: QueryEditorCatalog;
  readonly draft: QueryEditorDraft;
  readonly id?: string;
  readonly name: string;
  readonly store: QueryWorkbenchStore;
}): QueryWorkbenchSavedQuery {
  try {
    return input.store.saveQuery({
      ...(input.id ? { id: input.id } : {}),
      ...createSavedQueryRecordInputFromDraft({
        catalog: input.catalog,
        draft: input.draft,
        name: input.name,
      }),
    });
  } catch (error) {
    throw coerceQueryWorkbenchSaveError(error) ?? error;
  }
}

export function saveQueryWorkbenchView(input: {
  readonly catalog: QueryEditorCatalog;
  readonly draft: QueryEditorDraft;
  readonly queryId?: string;
  readonly queryName: string;
  readonly rendererCapabilities: Readonly<Record<string, QueryRendererCapability>>;
  readonly viewId?: string;
  readonly viewName: string;
  readonly spec: Omit<QueryContainerSpec, "query">;
  readonly store: QueryWorkbenchStore;
  readonly surface?: QuerySurfaceRendererCompatibility;
}): {
  readonly query: QueryWorkbenchSavedQuery;
  readonly view: QueryWorkbenchSavedView;
} {
  if (!input.surface) {
    throw new QueryWorkbenchSaveError(
      "missing-surface-contract",
      `Saved view "${input.viewName.trim() || "Untitled view"}" does not have a current renderer compatibility contract.`,
    );
  }
  try {
    const query = input.store.saveQuery({
      ...(input.queryId ? { id: input.queryId } : {}),
      ...createSavedQueryRecordInputFromDraft({
        catalog: input.catalog,
        draft: input.draft,
        name: input.queryName,
      }),
    });
    const view = input.store.saveView({
      ...(input.viewId ? { id: input.viewId } : {}),
      ...createSavedViewRecordInput({
        name: input.viewName,
        query,
        rendererCapabilities: input.rendererCapabilities,
        spec: input.spec,
        surface: input.surface,
      }),
    });
    return { query, view };
  } catch (error) {
    throw coerceQueryWorkbenchSaveError(error) ?? error;
  }
}

export function createQueryWorkbenchSourceResolver(
  store: Pick<QueryWorkbenchStore, "getQuery">,
  options: {
    readonly catalog?: QueryEditorCatalog;
  } = {},
): QueryContainerSourceResolver {
  return createSavedQueryRecordSourceResolver(
    {
      getSavedQuery(id) {
        return store.getQuery(id);
      },
    },
    options,
  );
}

export function createQueryWorkbenchPreviewRuntime(
  store: Pick<QueryWorkbenchStore, "getQuery">,
  options: {
    readonly catalog?: QueryEditorCatalog;
    readonly executePage?: QueryContainerPageExecutor;
    readonly inlineParameterDefinitions?: readonly QueryParameterDefinition[];
  } = {},
): QueryContainerRuntimeController {
  const resolveSavedSource = createQueryWorkbenchSourceResolver(store, options);
  return createQueryContainerRuntime({
    executePage:
      options.executePage ??
      ((request, runtimeOptions) =>
        requestSerializedQuery(request, { signal: runtimeOptions.signal })),
    resolveSource: async (source, runtimeOptions) => {
      if (source.kind === "inline") {
        return {
          ...(options.inlineParameterDefinitions
            ? { parameterDefinitions: options.inlineParameterDefinitions }
            : {}),
          request: source.request,
        };
      }
      return resolveSavedSource(source, runtimeOptions);
    },
  });
}

export function createQueryWorkbenchInitialDraft(catalog: QueryEditorCatalog): QueryEditorDraft {
  const workflowBoardDraft = createWorkflowBoardInitialDraft(catalog);
  return workflowBoardDraft ?? createQueryEditorDraft(catalog);
}

function createWorkflowBoardInitialDraft(
  catalog: QueryEditorCatalog,
): QueryEditorDraft | undefined {
  const workflowBoardSurface = catalog.surfaces.find(
    (surface) => surface.surfaceId === workflowBuiltInQuerySurfaceIds.projectBranchBoard,
  );
  if (!workflowBoardSurface) {
    return undefined;
  }

  const baseDraft = createQueryEditorDraft(catalog, workflowBoardSurface.surfaceId);
  const seededDraft = addQueryEditorFilter(baseDraft, catalog);
  const projectFilter = seededDraft.filters[0];
  if (!projectFilter) {
    return baseDraft;
  }

  return updateQueryEditorFilter(
    seededDraft,
    projectFilter.id,
    {
      fieldId: "projectId",
      operator: "eq",
      value: {
        kind: "literal",
        value: "",
      },
    },
    catalog,
  );
}

function readPersistedWorkbenchStore(
  storage: QueryWorkbenchStorage,
  key: string,
): {
  readonly queries?: readonly QueryWorkbenchSavedQuery[];
  readonly views?: readonly QueryWorkbenchSavedView[];
} {
  const raw = storage.getItem(key);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as {
      readonly queries?: readonly QueryWorkbenchSavedQuery[];
      readonly version?: number;
      readonly views?: readonly QueryWorkbenchSavedView[];
    };
    if (parsed.version !== queryWorkbenchStoreVersion) {
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

function writePersistedWorkbenchStore(
  storage: QueryWorkbenchStorage,
  key: string,
  store: Pick<QueryWorkbenchStore, "listQueries" | "listViews">,
): void {
  storage.setItem(
    key,
    JSON.stringify({
      queries: store.listQueries(),
      version: queryWorkbenchStoreVersion,
      views: store.listViews(),
    }),
  );
}

function compareSavedEntries(
  left: { readonly name: string; readonly updatedAt: string },
  right: { readonly name: string; readonly updatedAt: string },
): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name);
}

function encodeWorkbenchValue(value: unknown): string {
  return encodeWorkbenchUtf8Base64Url(JSON.stringify(value));
}

function decodeWorkbenchValue(value: string): unknown {
  try {
    return JSON.parse(decodeWorkbenchUtf8Base64Url(value));
  } catch {
    return undefined;
  }
}

function encodeWorkbenchUtf8Base64Url(value: string): string {
  const buffer = readWorkbenchBufferApi();
  if (buffer) {
    return buffer.from(value, "utf8").toString("base64url");
  }
  if (typeof btoa !== "function") {
    throw new Error("Base64url encoding is unavailable in this runtime.");
  }
  return encodeBytesAsBase64Url(new TextEncoder().encode(value));
}

function decodeWorkbenchUtf8Base64Url(value: string): string {
  const buffer = readWorkbenchBufferApi();
  if (buffer) {
    return buffer.from(value, "base64url").toString("utf8");
  }
  if (typeof atob !== "function") {
    throw new Error("Base64url decoding is unavailable in this runtime.");
  }
  return new TextDecoder().decode(decodeBase64UrlToBytes(value));
}

function encodeBytesAsBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

type WorkbenchBufferEncoding = "base64url" | "utf8";

type WorkbenchBufferApi = {
  from(
    value: string,
    encoding: WorkbenchBufferEncoding,
  ): {
    toString(encoding: WorkbenchBufferEncoding): string;
  };
};

function readWorkbenchBufferApi(): WorkbenchBufferApi | undefined {
  const candidate = (globalThis as { Buffer?: Partial<WorkbenchBufferApi> }).Buffer;
  if (!candidate || typeof candidate.from !== "function") {
    return undefined;
  }
  return candidate as WorkbenchBufferApi;
}

function readQueryWorkbenchDraftRouteState(
  value: unknown,
): QueryWorkbenchDraftRouteState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as Partial<QueryWorkbenchDraftRouteState> & {
    readonly request?: unknown;
  };
  if (candidate.request) {
    return {
      ...(Array.isArray(candidate.parameterDefinitions)
        ? { parameterDefinitions: candidate.parameterDefinitions }
        : {}),
      request: candidate.request as SerializedQueryRequest,
    };
  }
  return {
    request: value as SerializedQueryRequest,
  };
}

function isQueryLiteralValue(value: unknown): value is QueryLiteral {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (!Array.isArray(value)) {
    return false;
  }
  if (value.length === 0) {
    return true;
  }
  return value.every((entry) => typeof entry === typeof value[0]);
}

function isSavedQueryRecord(value: unknown): value is QueryWorkbenchSavedQuery {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<QueryWorkbenchSavedQuery>;
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

function isSavedViewRecord(value: unknown): value is QueryWorkbenchSavedView {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<QueryWorkbenchSavedView>;
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

function coerceQueryWorkbenchSaveError(error: unknown): QueryWorkbenchSaveError | undefined {
  if (error instanceof QueryWorkbenchSaveError) {
    return error;
  }
  if (error instanceof SavedQuerySaveError) {
    return new QueryWorkbenchSaveError(error.code, error.message, {
      issues: error.issues,
    });
  }
  return undefined;
}
