import { coreBuiltInQuerySurfaceIds } from "@io/graph-module-core";
import {
  createQueryEditorDraft,
  hydrateQueryEditorDraft,
  QueryEditorHydrationError,
  serializeQueryEditorDraft,
  type QueryEditorCatalog,
  type QueryEditorDraft,
} from "@io/graph-module-core/react-dom/query-editor";
import {
  validateSerializedQueryRequest,
  type QueryFilter,
  type QueryLiteral,
  type QueryResultItem,
  type QueryResultPage,
  type SerializedQueryRequest,
} from "@io/graph-client";

import {
  type QueryContainerSourceResolver,
  type QueryContainerSpec,
  type QuerySurfaceRendererCompatibility,
} from "./query-container.js";
import type { QueryRendererCapability } from "./query-container.js";
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

export type QueryWorkbenchRouteSearch = {
  readonly draft?: string;
  readonly params?: string;
  readonly queryId?: string;
  readonly viewId?: string;
};

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
      readonly kind: "draft";
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

type PreviewRow = {
  readonly entityId?: string;
  readonly key: string;
  readonly payload: Readonly<Record<string, unknown>>;
};

type PreviewDataset = Readonly<Record<string, readonly PreviewRow[]>>;

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

const defaultPreviewDataset = Object.freeze({
  [coreBuiltInQuerySurfaceIds.savedQueryLibrary]: [
    {
      entityId: "saved-query:workflow-review",
      key: "row:saved-query-workflow-review",
      payload: {
        createdAt: "2026-03-18",
        name: "Workflow review board",
        queryKind: "collection",
        surfaceId: "workflow:project-branch-board",
        surfaceModuleId: "workflow",
        updatedAt: "2026-03-26",
      },
    },
    {
      entityId: "saved-query:catalog-bootstrap",
      key: "row:saved-query-catalog-bootstrap",
      payload: {
        createdAt: "2026-03-17",
        name: "Catalog bootstrap scope",
        queryKind: "scope",
        surfaceId: coreBuiltInQuerySurfaceIds.catalogScope,
        surfaceModuleId: "core",
        updatedAt: "2026-03-25",
      },
    },
    {
      entityId: "saved-query:core-library",
      key: "row:saved-query-core-library",
      payload: {
        createdAt: "2026-03-16",
        name: "Saved query library browser",
        queryKind: "collection",
        surfaceId: coreBuiltInQuerySurfaceIds.savedQueryLibrary,
        surfaceModuleId: "core",
        updatedAt: "2026-03-24",
      },
    },
  ],
  "workflow:project-branch-board": [
    {
      entityId: "workflow-branch:1",
      key: "row:branch-1",
      payload: {
        "created-at": "2026-03-20",
        "queue-rank": 1,
        "updated-at": "2026-03-26",
        hasActiveCommit: true,
        projectId: "workflow-project:io",
        queueRank: 1,
        repositoryFreshness: "fresh",
        showUnmanagedRepositoryBranches: false,
        state: "active",
        title: "Workflow shell",
        updatedAt: "2026-03-26",
      },
    },
    {
      entityId: "workflow-branch:2",
      key: "row:branch-2",
      payload: {
        "created-at": "2026-03-18",
        "queue-rank": 2,
        "updated-at": "2026-03-25",
        hasActiveCommit: false,
        projectId: "workflow-project:io",
        queueRank: 2,
        repositoryFreshness: "stale",
        showUnmanagedRepositoryBranches: false,
        state: "ready",
        title: "Query cards",
        updatedAt: "2026-03-25",
      },
    },
    {
      entityId: "workflow-branch:3",
      key: "row:branch-3",
      payload: {
        "created-at": "2026-03-16",
        "queue-rank": 3,
        "updated-at": "2026-03-24",
        hasActiveCommit: true,
        projectId: "workflow-project:io",
        queueRank: 3,
        repositoryFreshness: "missing",
        showUnmanagedRepositoryBranches: true,
        state: "blocked",
        title: "Saved view refresh",
        updatedAt: "2026-03-24",
      },
    },
  ],
  "workflow:branch-commit-queue": [
    {
      entityId: "queue-row:1",
      key: "row:queue-1",
      payload: {
        branchId: "workflow-branch:1",
        order: 1,
        state: "planned",
        title: "Define workflow query surface registry",
        updatedAt: "2026-03-26",
      },
    },
    {
      entityId: "queue-row:2",
      key: "row:queue-2",
      payload: {
        branchId: "workflow-branch:1",
        order: 2,
        state: "active",
        title: "Register catalog with authority planner",
        updatedAt: "2026-03-27",
      },
    },
  ],
}) as PreviewDataset;

const queryWorkbenchStoreVersion = 3;
const defaultQueryWorkbenchStorageKey = "io.web.query-workbench";

export function encodeQueryWorkbenchDraft(request: SerializedQueryRequest): string {
  return encodeWorkbenchValue(request);
}

export function decodeQueryWorkbenchDraft(value: string): SerializedQueryRequest | undefined {
  const parsed = decodeWorkbenchValue(value);
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  try {
    validateSerializedQueryRequest(parsed as SerializedQueryRequest);
    return parsed as SerializedQueryRequest;
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

export function validateQueryWorkbenchRouteSearch(
  search: Record<string, unknown>,
): QueryWorkbenchRouteSearch {
  return {
    ...(readTrimmedString(search.queryId) ? { queryId: readTrimmedString(search.queryId) } : {}),
    ...(readTrimmedString(search.viewId) ? { viewId: readTrimmedString(search.viewId) } : {}),
    ...(readTrimmedString(search.draft) ? { draft: readTrimmedString(search.draft) } : {}),
    ...(readTrimmedString(search.params) ? { params: readTrimmedString(search.params) } : {}),
  };
}

export function resolveQueryWorkbenchRouteTarget(
  search: QueryWorkbenchRouteSearch,
  store: Pick<QueryWorkbenchStore, "getQuery" | "getView">,
  catalog: QueryEditorCatalog,
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
    const request = decodeQueryWorkbenchDraft(search.draft);
    if (!request) {
      return {
        code: "invalid-draft",
        kind: "invalid",
        message: "Draft preview state is invalid or stale.",
      };
    }
    return {
      kind: "draft",
      request,
    };
  }
  return {
    kind: "draft",
    request: createInitialQueryWorkbenchRequest(catalog),
  };
}

export function hydrateQueryWorkbenchDraft(input: {
  readonly catalog: QueryEditorCatalog;
  readonly target: QueryWorkbenchRouteTarget;
}): HydratedQueryWorkbenchDraft | undefined {
  const { catalog, target } = input;
  if (target.kind === "invalid") {
    return undefined;
  }
  if (target.kind === "draft") {
    return {
      draft: hydrateQueryEditorDraft({
        catalog,
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
  if (target.kind === "invalid") {
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

export async function executeQueryWorkbenchPreviewRequest(
  request: SerializedQueryRequest,
  options: {
    readonly dataset?: PreviewDataset;
  } = {},
): Promise<QueryResultPage> {
  validateSerializedQueryRequest(request);
  if (request.query.kind !== "collection") {
    const error = new Error(
      `Preview only supports collection queries, received "${request.query.kind}".`,
    );
    (error as Error & { code: string }).code = "unsupported-query";
    throw error;
  }
  const query = request.query;
  const rows =
    options.dataset?.[query.indexId] ??
    (defaultPreviewDataset as Readonly<Record<string, readonly PreviewRow[]>>)[query.indexId];
  if (!rows) {
    const error = new Error(`Preview surface "${request.query.indexId}" is not registered.`);
    (error as Error & { code: string }).code = "unsupported-query";
    throw error;
  }
  const resolved = rows.filter((row: PreviewRow) =>
    matchesQueryFilter(row.payload, query.filter, request.params),
  );
  const ordered = applyQueryOrder(resolved, query.order);
  const limited = applyQueryWindow(ordered, query.window);
  return {
    freshness: {
      completeness: "complete",
      freshness: "current",
    },
    items: limited.items,
    kind: "collection",
    ...(limited.nextCursor ? { nextCursor: limited.nextCursor } : {}),
  };
}

export function createQueryWorkbenchInitialDraft(catalog: QueryEditorCatalog): QueryEditorDraft {
  return createQueryEditorDraft(catalog);
}

function createInitialQueryWorkbenchRequest(catalog: QueryEditorCatalog): SerializedQueryRequest {
  return serializeQueryEditorDraft(createQueryWorkbenchInitialDraft(catalog), catalog).request;
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

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function encodeWorkbenchValue(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeWorkbenchValue(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
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

function resolveQueryValue(
  value:
    | { readonly kind: "literal"; readonly value: QueryLiteral }
    | { readonly kind: "param"; readonly name: string },
  params: SerializedQueryRequest["params"],
): QueryLiteral | undefined {
  return value.kind === "literal" ? value.value : params?.[value.name];
}

function matchesQueryFilter(
  payload: Readonly<Record<string, unknown>>,
  filter: QueryFilter | undefined,
  params: SerializedQueryRequest["params"],
): boolean {
  if (!filter) {
    return true;
  }
  switch (filter.op) {
    case "and":
      return filter.clauses.every((clause) => matchesQueryFilter(payload, clause, params));
    case "or":
      return filter.clauses.some((clause) => matchesQueryFilter(payload, clause, params));
    case "not":
      return !matchesQueryFilter(payload, filter.clause, params);
    case "exists":
      return (payload[filter.fieldId] !== undefined) === filter.value;
    case "in": {
      const candidate = payload[filter.fieldId];
      const values = filter.values
        .map((value) => resolveQueryValue(value, params))
        .filter((value): value is QueryLiteral => value !== undefined);
      return values.some((value) => value === candidate);
    }
    case "contains":
    case "starts-with":
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return compareFieldValue(
        payload[filter.fieldId],
        filter.op,
        resolveQueryValue(filter.value, params),
      );
  }
}

function compareFieldValue(
  current: unknown,
  operator: "contains" | "starts-with" | "eq" | "neq" | "gt" | "gte" | "lt" | "lte",
  expected: QueryLiteral | undefined,
): boolean {
  if (expected === undefined) {
    return false;
  }
  switch (operator) {
    case "eq":
      return current === expected;
    case "neq":
      return current !== expected;
    case "contains":
      return typeof current === "string" && typeof expected === "string"
        ? current.includes(expected)
        : false;
    case "starts-with":
      return typeof current === "string" && typeof expected === "string"
        ? current.startsWith(expected)
        : false;
    case "gt":
      return compareComparable(current, expected) > 0;
    case "gte":
      return compareComparable(current, expected) >= 0;
    case "lt":
      return compareComparable(current, expected) < 0;
    case "lte":
      return compareComparable(current, expected) <= 0;
  }
}

function compareComparable(left: unknown, right: QueryLiteral): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  if (typeof left === "string" && typeof right === "string") {
    return left.localeCompare(right);
  }
  return Number.NaN;
}

function applyQueryOrder(
  rows: readonly PreviewRow[],
  order: readonly { readonly direction: "asc" | "desc"; readonly fieldId: string }[] | undefined,
): readonly PreviewRow[] {
  if (!order || order.length === 0) {
    return rows;
  }
  return [...rows].sort((left, right) => {
    for (const clause of order) {
      const leftValue = left.payload[clause.fieldId];
      const rightValue = right.payload[clause.fieldId];
      const comparison =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue ?? "").localeCompare(String(rightValue ?? ""));
      if (comparison !== 0) {
        return clause.direction === "asc" ? comparison : -comparison;
      }
    }
    return left.key.localeCompare(right.key);
  });
}

function applyQueryWindow(
  rows: readonly QueryResultItem[],
  window: { readonly after?: string; readonly limit: number } | undefined,
): {
  readonly items: readonly QueryResultItem[];
  readonly nextCursor?: string;
} {
  const limit = window?.limit ?? rows.length;
  const offset =
    window?.after !== undefined ? Number.parseInt(window.after.replace("cursor:", ""), 10) || 0 : 0;
  const items = rows.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  return {
    items,
    ...(nextOffset < rows.length ? { nextCursor: `cursor:${nextOffset}` } : {}),
  };
}
