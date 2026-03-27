import {
  serializedQueryVersion,
  validateSerializedQueryRequest,
  type QueryFilter,
  type QueryLiteral,
  type QueryParameterDefinition,
  type QueryResultItem,
  type QueryResultPage,
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
  createQueryEditorDraft,
  hydrateQueryEditorDraft,
  QueryEditorHydrationError,
  serializeQueryEditorDraft,
  validateQueryEditorDraft,
  type QueryEditorCatalog,
  type QueryEditorDraft,
} from "./query-editor.js";

export type QueryWorkbenchRouteSearch = {
  readonly draft?: string;
  readonly params?: string;
  readonly queryId?: string;
  readonly viewId?: string;
};

export type QueryWorkbenchSavedQuery = {
  readonly id: string;
  readonly name: string;
  readonly parameterDefinitions: readonly QueryParameterDefinition[];
  readonly request: SerializedQueryRequest;
  readonly surfaceId: string;
  readonly updatedAt: string;
};

export type QueryWorkbenchSavedView = {
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
  readonly updatedAt: string;
};

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
      readonly code: "invalid-draft" | "invalid-params" | "stale-query" | "stale-view";
      readonly kind: "invalid";
      readonly message: string;
    };

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
  "workflow:project-branch-board": [
    {
      entityId: "workflow-branch:1",
      key: "row:branch-1",
      payload: {
        needsReview: true,
        openPullRequests: 4,
        ownerId: "person:avery",
        ownerName: "Avery Operator",
        status: "draft",
        title: "Workflow shell",
        updatedAt: "2026-03-26",
      },
    },
    {
      entityId: "workflow-branch:2",
      key: "row:branch-2",
      payload: {
        needsReview: false,
        openPullRequests: 1,
        ownerId: "person:sam",
        ownerName: "Sam Reviewer",
        status: "ready",
        title: "Query cards",
        updatedAt: "2026-03-25",
      },
    },
    {
      entityId: "workflow-branch:3",
      key: "row:branch-3",
      payload: {
        needsReview: true,
        openPullRequests: 2,
        ownerId: "person:avery",
        ownerName: "Avery Operator",
        status: "ready",
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
        queueState: "queued",
      },
    },
  ],
}) as PreviewDataset;

const queryWorkbenchStoreVersion = 1;
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
    request: {
      query: {
        indexId: "workflow:project-branch-board",
        kind: "collection",
        window: {
          limit: 25,
        },
      },
      version: serializedQueryVersion,
    },
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
  readonly target: QueryWorkbenchRouteTarget;
}): ResolvedQueryWorkbenchState {
  const { catalog, target } = input;
  if (target.kind === "invalid") {
    return { target };
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
          code: "stale-view",
          kind: "invalid",
          message: `Saved view "${target.view.id}" no longer matches the current query surfaces.`,
        },
      };
    }
    if (target.kind === "saved-query") {
      return {
        target: {
          code: "stale-query",
          kind: "invalid",
          message: `Saved query "${target.query.id}" no longer matches the current query surfaces.`,
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
        id,
        name: input.name,
        parameterDefinitions: [...input.parameterDefinitions],
        request: input.request,
        surfaceId: input.surfaceId,
        updatedAt: new Date().toISOString(),
      } satisfies QueryWorkbenchSavedQuery);
      queries.set(id, saved);
      return saved;
    },
    saveView(input) {
      const id = input.id ?? `saved-view:${++viewCount}`;
      const saved = Object.freeze({
        id,
        name: input.name,
        queryId: input.queryId,
        spec: input.spec,
        surfaceId: input.surfaceId,
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
  const validation = validateQueryEditorDraft(input.draft, input.catalog);
  if (!validation.ok) {
    throw new QueryWorkbenchSaveError(
      validation.issues[0]?.code ?? "invalid-draft",
      validation.issues[0]?.message ?? "Query draft is invalid.",
      {
        issues: validation.issues,
      },
    );
  }
  const serialized = serializeQueryEditorDraft(input.draft, input.catalog);
  return input.store.saveQuery({
    ...(input.id ? { id: input.id } : {}),
    name: input.name.trim() || "Untitled query",
    parameterDefinitions: serialized.parameterDefinitions,
    request: serialized.request,
    surfaceId: serialized.surface.surfaceId,
  });
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
  readonly surface: QuerySurfaceRendererCompatibility;
}): {
  readonly query: QueryWorkbenchSavedQuery;
  readonly view: QueryWorkbenchSavedView;
} {
  const validation = validateQueryEditorDraft(input.draft, input.catalog);
  if (!validation.ok) {
    throw new QueryWorkbenchSaveError(
      validation.issues[0]?.code ?? "invalid-draft",
      validation.issues[0]?.message ?? "Query draft is invalid.",
      {
        issues: validation.issues,
      },
    );
  }
  const serialized = serializeQueryEditorDraft(input.draft, input.catalog);
  const spec = {
    ...input.spec,
    query: {
      kind: "saved",
      queryId: "pending",
    },
  } satisfies QueryWorkbenchSavedView["spec"];
  const containerValidation = validateQueryContainerSpec(spec, {
    rendererCapabilities: input.rendererCapabilities,
    surface: input.surface,
  });
  if (!containerValidation.ok) {
    throw new QueryWorkbenchSaveError(
      containerValidation.issues[0]?.code ?? "invalid-view",
      containerValidation.issues[0]?.message ?? "Saved view is invalid.",
      {
        issues: containerValidation.issues,
      },
    );
  }
  const query = input.store.saveQuery({
    ...(input.queryId ? { id: input.queryId } : {}),
    name: input.queryName.trim() || "Untitled query",
    parameterDefinitions: serialized.parameterDefinitions,
    request: serialized.request,
    surfaceId: serialized.surface.surfaceId,
  });
  const view = input.store.saveView({
    ...(input.viewId ? { id: input.viewId } : {}),
    name: input.viewName.trim() || "Untitled view",
    queryId: query.id,
    spec: {
      ...spec,
      query: {
        ...spec.query,
        queryId: query.id,
      },
    },
    surfaceId: input.surface.surfaceId,
  });
  return { query, view };
}

export function createQueryWorkbenchSourceResolver(
  store: Pick<QueryWorkbenchStore, "getQuery">,
): QueryContainerSourceResolver {
  return async (source) => {
    if (source.kind === "inline") {
      return { request: source.request };
    }
    const saved = store.getQuery(source.queryId);
    if (!saved) {
      const error = new Error(`Saved query "${source.queryId}" is no longer available.`);
      (error as Error & { code: string }).code = "saved-query-stale";
      throw error;
    }
    const request = mergeQueryParams(saved.request, source.params);
    validateSerializedQueryRequest(request);
    return {
      request,
      sourceCacheKey: `saved:${saved.id}`,
    };
  };
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
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.surfaceId === "string" &&
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
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.queryId === "string" &&
    typeof candidate.surfaceId === "string" &&
    typeof candidate.updatedAt === "string" &&
    Boolean(candidate.spec)
  );
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
