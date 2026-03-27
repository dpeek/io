import {
  normalizeSerializedQueryRequest,
  SerializedQueryValidationError,
  validateSerializedQueryRequest,
  type QueryIdentityExecutionContext,
  type QueryLiteral,
  type QueryResultPage,
  type ReadQuery,
  type SerializedQueryRequest,
} from "@io/graph-client";

export const queryContainerPaginationModeValues = ["paged", "infinite"] as const;

export type QueryContainerPaginationMode = (typeof queryContainerPaginationModeValues)[number];

export const queryContainerRefreshModeValues = ["manual", "poll", "push"] as const;

export type QueryContainerRefreshMode = (typeof queryContainerRefreshModeValues)[number];

export const queryContainerStaleRecoveryModeValues = ["reset", "refresh"] as const;

export type QueryContainerStaleRecoveryMode =
  (typeof queryContainerStaleRecoveryModeValues)[number];

export const queryContainerStateKindValues = [
  "loading",
  "empty",
  "error",
  "ready",
  "paginated",
  "stale",
  "refreshing",
] as const;

export type QueryContainerStateKind = (typeof queryContainerStateKindValues)[number];

export const queryContainerResultKindValues = [
  "entity-detail",
  "entity-list",
  "collection",
  "scope",
] as const;

export type QueryContainerResultKind = (typeof queryContainerResultKindValues)[number];

export const queryContainerSourceKindValues = ["saved", "inline"] as const;

export type QueryContainerSourceKind = (typeof queryContainerSourceKindValues)[number];

export const rendererEntityIdSupportValues = ["required", "optional", "forbidden"] as const;

export type RendererEntityIdSupport = (typeof rendererEntityIdSupportValues)[number];

export type SavedQueryContainerSource = {
  readonly kind: "saved";
  readonly params?: Readonly<Record<string, QueryLiteral>>;
  readonly queryId: string;
};

export type InlineQueryContainerSource = {
  readonly kind: "inline";
  readonly request: SerializedQueryRequest;
};

export type QueryContainerQuerySource = SavedQueryContainerSource | InlineQueryContainerSource;

export type QueryRendererFieldDefinition = {
  readonly emptyLabel?: string;
  readonly fieldId: string;
  readonly label?: string;
};

export type QueryListItemRendererDefinition = {
  readonly badgeField?: string;
  readonly descriptionField?: string;
  readonly metaFields?: readonly QueryRendererFieldDefinition[];
  readonly titleField?: string;
};

export type QueryTableRendererColumnDefinition = QueryRendererFieldDefinition & {
  readonly align?: "start" | "center" | "end";
};

export type QueryCardRendererDefinition = {
  readonly badgeField?: string;
  readonly descriptionField?: string;
  readonly fields?: readonly QueryRendererFieldDefinition[];
  readonly titleField?: string;
};

export type QueryRendererDefinition =
  | {
      readonly item: QueryListItemRendererDefinition;
      readonly kind: "list";
    }
  | {
      readonly card: QueryCardRendererDefinition;
      readonly kind: "card-grid";
    }
  | {
      readonly columns: readonly QueryTableRendererColumnDefinition[];
      readonly kind: "table";
    };

export type RendererBinding = {
  readonly definition?: QueryRendererDefinition;
  readonly rendererId: string;
};

export type QueryContainerPagination = {
  readonly mode: QueryContainerPaginationMode;
  readonly pageSize: number;
};

export type QueryContainerRefresh = {
  readonly mode: QueryContainerRefreshMode;
  readonly pollIntervalMs?: number;
};

export type QueryContainerSpec = {
  readonly containerId: string;
  readonly pagination?: QueryContainerPagination;
  readonly query: QueryContainerQuerySource;
  readonly refresh?: QueryContainerRefresh;
  readonly renderer: RendererBinding;
};

export type QueryRendererMountOptions = {
  readonly containerId: string;
  readonly pagination?: QueryContainerPagination;
  readonly refresh?: QueryContainerRefresh;
  readonly renderer: RendererBinding;
};

export function mountInlineQueryRenderer(
  source: SerializedQueryRequest,
  options: QueryRendererMountOptions,
): QueryContainerSpec {
  return {
    containerId: options.containerId,
    ...(options.pagination ? { pagination: options.pagination } : {}),
    query: {
      kind: "inline",
      request: source,
    },
    ...(options.refresh ? { refresh: options.refresh } : {}),
    renderer: options.renderer,
  };
}

export function mountSavedQueryRenderer(
  source: {
    readonly params?: Readonly<Record<string, QueryLiteral>>;
    readonly queryId: string;
  },
  options: QueryRendererMountOptions,
): QueryContainerSpec {
  return {
    containerId: options.containerId,
    ...(options.pagination ? { pagination: options.pagination } : {}),
    query: {
      kind: "saved",
      ...(source.params ? { params: source.params } : {}),
      queryId: source.queryId,
    },
    ...(options.refresh ? { refresh: options.refresh } : {}),
    renderer: options.renderer,
  };
}

export type QueryRendererCapability = {
  readonly rendererId: string;
  readonly supportedPaginationModes?: readonly QueryContainerPaginationMode[];
  readonly supportedQueryKinds: readonly ReadQuery["kind"][];
  readonly supportedResultKinds: readonly QueryContainerResultKind[];
  readonly supportedSourceKinds?: readonly QueryContainerSourceKind[];
  readonly supportsEntityId?: RendererEntityIdSupport;
};

export type QuerySurfaceRendererCompatibility = {
  readonly compatibleRendererIds: readonly string[];
  readonly itemEntityIds?: RendererEntityIdSupport;
  readonly queryKind: ReadQuery["kind"];
  readonly resultKind: QueryContainerResultKind;
  readonly sourceKinds?: readonly QueryContainerSourceKind[];
  readonly surfaceId: string;
};

export type QueryContainerValidationIssueCode =
  | "invalid-container-id"
  | "invalid-page-size"
  | "invalid-poll-interval"
  | "invalid-query-id"
  | "invalid-renderer-id"
  | "missing-poll-interval"
  | "poll-interval-not-supported"
  | "serialized-query-invalid"
  | "unknown-renderer"
  | "renderer-not-compatible"
  | "renderer-query-kind-unsupported"
  | "renderer-result-kind-unsupported"
  | "renderer-source-kind-unsupported"
  | "renderer-pagination-unsupported"
  | "renderer-entity-id-required"
  | "renderer-entity-id-forbidden";

export type QueryContainerValidationIssue = {
  readonly code: QueryContainerValidationIssueCode;
  readonly message: string;
  readonly path: string;
};

export type QueryContainerValidationResult = {
  readonly issues: readonly QueryContainerValidationIssue[];
  readonly ok: boolean;
};

export class QueryContainerValidationError extends Error {
  readonly issues: readonly QueryContainerValidationIssue[];

  constructor(issues: readonly QueryContainerValidationIssue[]) {
    const firstIssue = issues[0];
    super(
      firstIssue
        ? `${firstIssue.path} ${firstIssue.message}`
        : "Query container validation failed.",
    );
    this.name = "QueryContainerValidationError";
    this.issues = issues;
  }
}

export type QueryContainerValidationOptions = {
  readonly rendererCapabilities?: Readonly<Record<string, QueryRendererCapability>>;
  readonly surface?: QuerySurfaceRendererCompatibility;
};

export type QueryContainerRuntimeSnapshot = {
  readonly error?: {
    readonly code?: string;
    readonly message: string;
  };
  readonly isRefreshing?: boolean;
  readonly result?: QueryResultPage;
};

export type QueryContainerState =
  | {
      readonly kind: "loading";
    }
  | {
      readonly error: {
        readonly code?: string;
        readonly message: string;
      };
      readonly kind: "error";
    }
  | {
      readonly kind: "empty";
      readonly result: QueryResultPage;
    }
  | {
      readonly kind: "ready";
      readonly result: QueryResultPage;
    }
  | {
      readonly kind: "paginated";
      readonly nextCursor: string;
      readonly result: QueryResultPage;
    }
  | {
      readonly kind: "stale";
      readonly nextCursor?: string;
      readonly result: QueryResultPage;
    }
  | {
      readonly kind: "refreshing";
      readonly nextCursor?: string;
      readonly result: QueryResultPage;
    };

export type QueryContainerResolvedSource = {
  readonly request: SerializedQueryRequest;
  readonly sourceCacheKey?: string;
};

export type QueryContainerRuntimeError = {
  readonly code?: string;
  readonly message: string;
};

export type QueryContainerRuntimeValue = {
  readonly cacheKey: string;
  readonly instanceKey: string;
  readonly pageKey: string;
  readonly request: SerializedQueryRequest;
  readonly snapshot: QueryContainerRuntimeSnapshot;
  readonly state: QueryContainerState;
  readonly staleRecovery?:
    | {
        readonly code?: string;
        readonly message: string;
        readonly mode: QueryContainerStaleRecoveryMode;
      }
    | undefined;
};

export type QueryContainerPageExecutorOptions = {
  readonly cacheKey: string;
  readonly pageKey: string;
  readonly signal?: AbortSignal;
  readonly source: QueryContainerQuerySource;
};

export type QueryContainerPageExecutor = (
  request: SerializedQueryRequest,
  options: QueryContainerPageExecutorOptions,
) => Promise<QueryResultPage>;

export type QueryContainerSourceResolverOptions = {
  readonly signal?: AbortSignal;
};

export type QueryContainerSourceResolver = (
  source: QueryContainerQuerySource,
  options: QueryContainerSourceResolverOptions,
) => Promise<QueryContainerResolvedSource | SerializedQueryRequest>;

export type QueryContainerRuntimeLoadOptions = {
  readonly executionContext?: QueryIdentityExecutionContext;
  readonly signal?: AbortSignal;
  readonly staleRecovery?: QueryContainerStaleRecoveryMode;
  readonly useCache?: boolean;
};

export type QueryContainerRuntimeController = {
  get(
    spec: QueryContainerSpec,
    options?: QueryContainerRuntimeLoadOptions,
  ): Promise<QueryContainerRuntimeValue | undefined> | QueryContainerRuntimeValue | undefined;
  load(
    spec: QueryContainerSpec,
    options?: QueryContainerRuntimeLoadOptions,
  ): Promise<QueryContainerRuntimeValue>;
  markStale(
    spec: QueryContainerSpec,
    options?: QueryContainerRuntimeLoadOptions,
  ): Promise<QueryContainerRuntimeValue | undefined>;
  paginate(
    spec: QueryContainerSpec,
    options?: QueryContainerRuntimeLoadOptions,
  ): Promise<QueryContainerRuntimeValue>;
  refresh(
    spec: QueryContainerSpec,
    options?: QueryContainerRuntimeLoadOptions,
  ): Promise<QueryContainerRuntimeValue>;
};

type QueryContainerRuntimeContext = {
  readonly baseRequest: SerializedQueryRequest;
  readonly cacheKey: string;
  readonly executionContext?: QueryIdentityExecutionContext;
  readonly firstPageKey: string;
  readonly instanceKey: string;
  readonly spec: QueryContainerSpec;
};

type QueryContainerRuntimeInstanceState = {
  readonly cacheKey: string;
  readonly instanceKey: string;
  request: SerializedQueryRequest;
  readonly spec: QueryContainerSpec;
  currentPageKey: string;
  snapshot: QueryContainerRuntimeSnapshot;
};

function createIssue(
  code: QueryContainerValidationIssueCode,
  path: string,
  message: string,
): QueryContainerValidationIssue {
  return { code, path, message };
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isWindowedQuery(
  query: ReadQuery,
): query is Extract<ReadQuery, { readonly kind: "collection" | "scope" }> {
  return query.kind === "collection" || query.kind === "scope";
}

function readRuntimeError(error: unknown): QueryContainerRuntimeError {
  if (error instanceof Error) {
    const code = (error as unknown as { code?: unknown }).code;
    return {
      ...(typeof code === "string" ? { code } : {}),
      message: error.message,
    };
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    const code = (error as unknown as { code?: unknown }).code;
    return {
      ...(typeof code === "string" ? { code } : {}),
      message: (error as { message: string }).message,
    };
  }
  return {
    message: String(error),
  };
}

function applyQueryContainerPagination(
  request: SerializedQueryRequest,
  pagination: QueryContainerPagination | undefined,
  cursor?: string,
): SerializedQueryRequest {
  if (!isWindowedQuery(request.query)) {
    return request;
  }

  const limit = pagination?.pageSize ?? request.query.window?.limit;
  if (limit === undefined) {
    if (cursor !== undefined) {
      throw new Error(
        `Query container "${request.query.kind}" pagination requires a window limit before paging.`,
      );
    }
    return request;
  }

  return {
    ...request,
    query: {
      ...request.query,
      window: {
        limit,
        ...(cursor === undefined ? {} : { after: cursor }),
      },
    },
  };
}

function resolveSourceCacheKey(
  spec: QueryContainerSpec,
  request: SerializedQueryRequest,
  normalizedQueryHash: string,
  resolvedSource: QueryContainerResolvedSource,
): string {
  if (resolvedSource.sourceCacheKey) {
    return resolvedSource.sourceCacheKey;
  }
  if (spec.query.kind === "saved") {
    return `saved:${spec.query.queryId}:${normalizedQueryHash}`;
  }
  return `inline:${normalizedQueryHash}:${request.query.kind}`;
}

export function createQueryContainerPageCacheKey(cacheKey: string, cursor?: string): string {
  return `${cacheKey}::page:${cursor ?? "first"}`;
}

export async function createQueryContainerCacheKey(
  spec: QueryContainerSpec,
  request: SerializedQueryRequest,
  options: {
    readonly executionContext?: QueryIdentityExecutionContext;
    readonly sourceCacheKey?: string;
  } = {},
): Promise<string> {
  const firstPageRequest = applyQueryContainerPagination(request, spec.pagination);
  const normalized = await normalizeSerializedQueryRequest(firstPageRequest, {
    executionContext: options.executionContext,
  });
  const sourceCacheKey =
    options.sourceCacheKey ??
    resolveSourceCacheKey(spec, firstPageRequest, normalized.metadata.queryHash, {
      request,
    });
  return [
    "query-container",
    sourceCacheKey,
    normalized.metadata.identityHash,
    spec.pagination?.mode ?? "paged",
  ].join(":");
}

async function defaultQueryContainerSourceResolver(
  source: QueryContainerQuerySource,
): Promise<QueryContainerResolvedSource> {
  if (source.kind === "inline") {
    return { request: source.request };
  }
  throw new Error(
    `Query container source "${source.kind}" requires a runtime query resolver before execution.`,
  );
}

function toResolvedSource(
  source: QueryContainerResolvedSource | SerializedQueryRequest,
): QueryContainerResolvedSource {
  if ("request" in source) {
    return source;
  }
  return { request: source };
}

function createRuntimeValue(
  instance: QueryContainerRuntimeInstanceState,
  staleRecovery?: QueryContainerRuntimeValue["staleRecovery"],
): QueryContainerRuntimeValue {
  return {
    cacheKey: instance.cacheKey,
    instanceKey: instance.instanceKey,
    pageKey: instance.currentPageKey,
    request: instance.request,
    snapshot: instance.snapshot,
    state: resolveQueryContainerState(instance.snapshot),
    ...(staleRecovery ? { staleRecovery } : {}),
  };
}

export function createQueryContainerRuntime(input: {
  readonly executePage: QueryContainerPageExecutor;
  readonly resolveSource?: QueryContainerSourceResolver;
}): QueryContainerRuntimeController {
  const resolveSource = input.resolveSource ?? defaultQueryContainerSourceResolver;
  const pageCache = new Map<string, QueryResultPage>();
  const cachePageKeys = new Map<string, Set<string>>();
  const pendingPages = new Map<string, Promise<QueryResultPage>>();
  const instances = new Map<string, QueryContainerRuntimeInstanceState>();

  function rememberPage(cacheKey: string, pageKey: string, page: QueryResultPage): void {
    pageCache.set(pageKey, page);
    const keys = cachePageKeys.get(cacheKey) ?? new Set<string>();
    keys.add(pageKey);
    cachePageKeys.set(cacheKey, keys);
  }

  function clearCachedContinuationPages(cacheKey: string, firstPageKey: string): void {
    const keys = cachePageKeys.get(cacheKey);
    if (!keys) {
      return;
    }
    for (const pageKey of keys) {
      if (pageKey !== firstPageKey) {
        pageCache.delete(pageKey);
        pendingPages.delete(pageKey);
        keys.delete(pageKey);
      }
    }
  }

  async function resolveContext(
    spec: QueryContainerSpec,
    options: QueryContainerRuntimeLoadOptions = {},
  ): Promise<QueryContainerRuntimeContext> {
    const resolvedSource = toResolvedSource(await resolveSource(spec.query, options));
    const cacheKey = await createQueryContainerCacheKey(spec, resolvedSource.request, {
      executionContext: options.executionContext,
      sourceCacheKey: resolvedSource.sourceCacheKey,
    });
    return {
      baseRequest: resolvedSource.request,
      cacheKey,
      executionContext: options.executionContext,
      firstPageKey: createQueryContainerPageCacheKey(cacheKey),
      instanceKey: `${spec.containerId}:${cacheKey}`,
      spec,
    };
  }

  function ensureInstance(
    context: QueryContainerRuntimeContext,
  ): QueryContainerRuntimeInstanceState {
    const existing = instances.get(context.instanceKey);
    if (existing) {
      return existing;
    }
    const initial: QueryContainerRuntimeInstanceState = {
      cacheKey: context.cacheKey,
      currentPageKey: context.firstPageKey,
      instanceKey: context.instanceKey,
      request: context.baseRequest,
      snapshot: {},
      spec: context.spec,
    };
    instances.set(context.instanceKey, initial);
    return initial;
  }

  async function fetchPage(
    context: QueryContainerRuntimeContext,
    cursor: string | undefined,
    options: QueryContainerRuntimeLoadOptions,
  ): Promise<QueryResultPage> {
    const pageKey = createQueryContainerPageCacheKey(context.cacheKey, cursor);
    if (options.useCache !== false) {
      const cached = pageCache.get(pageKey);
      if (cached) {
        return cached;
      }
    }
    const pending = pendingPages.get(pageKey);
    if (pending) {
      return pending;
    }
    const request = applyQueryContainerPagination(
      context.baseRequest,
      context.spec.pagination,
      cursor,
    );
    const next = input
      .executePage(request, {
        cacheKey: context.cacheKey,
        pageKey,
        signal: options.signal,
        source: context.spec.query,
      })
      .then((page) => {
        rememberPage(context.cacheKey, pageKey, page);
        return page;
      })
      .finally(() => {
        pendingPages.delete(pageKey);
      });
    pendingPages.set(pageKey, next);
    return next;
  }

  async function moveToPage(
    context: QueryContainerRuntimeContext,
    cursor: string | undefined,
    options: QueryContainerRuntimeLoadOptions = {},
  ): Promise<QueryContainerRuntimeValue> {
    const instance = ensureInstance(context);
    const pageKey = createQueryContainerPageCacheKey(context.cacheKey, cursor);
    instance.currentPageKey = pageKey;
    instance.request = context.baseRequest;
    const cached = options.useCache !== false ? pageCache.get(pageKey) : undefined;
    if (cached) {
      instance.snapshot = { result: cached };
      return createRuntimeValue(instance);
    }
    try {
      const page = await fetchPage(context, cursor, options);
      instance.snapshot = { result: page };
      return createRuntimeValue(instance);
    } catch (error) {
      instance.snapshot = { error: readRuntimeError(error) };
      return createRuntimeValue(instance);
    }
  }

  return {
    async get(spec, options = {}) {
      const context = await resolveContext(spec, options);
      const instance = instances.get(context.instanceKey);
      if (!instance) {
        const cached = pageCache.get(context.firstPageKey);
        if (!cached) {
          return undefined;
        }
        return {
          cacheKey: context.cacheKey,
          instanceKey: context.instanceKey,
          pageKey: context.firstPageKey,
          request: context.baseRequest,
          snapshot: { result: cached },
          state: resolveQueryContainerState({ result: cached }),
        };
      }
      return createRuntimeValue(instance);
    },

    async load(spec, options = {}) {
      const context = await resolveContext(spec, options);
      const instance = ensureInstance(context);
      if (options.useCache !== false) {
        const current = pageCache.get(instance.currentPageKey);
        if (current) {
          instance.snapshot = { result: current };
          return createRuntimeValue(instance);
        }
      }
      return moveToPage(context, undefined, options);
    },

    async markStale(spec, options = {}) {
      const context = await resolveContext(spec, options);
      const instance = instances.get(context.instanceKey);
      if (!instance) {
        return undefined;
      }
      const current = pageCache.get(instance.currentPageKey);
      if (!current) {
        return createRuntimeValue(instance);
      }
      const stale = {
        ...current,
        freshness: {
          ...current.freshness,
          freshness: "stale" as const,
        },
      };
      rememberPage(context.cacheKey, instance.currentPageKey, stale);
      instance.snapshot = { result: stale };
      return createRuntimeValue(instance);
    },

    async paginate(spec, options = {}) {
      const context = await resolveContext(spec, options);
      const instance = ensureInstance(context);
      const current = pageCache.get(instance.currentPageKey) ?? instance.snapshot.result;
      if (!current?.nextCursor) {
        return createRuntimeValue(instance);
      }
      try {
        const page = await fetchPage(context, current.nextCursor, options);
        instance.currentPageKey = createQueryContainerPageCacheKey(
          context.cacheKey,
          current.nextCursor,
        );
        instance.snapshot = { result: page };
        return createRuntimeValue(instance);
      } catch (error) {
        const runtimeError = readRuntimeError(error);
        if (runtimeError.code !== "projection-stale") {
          instance.snapshot = { error: runtimeError };
          return createRuntimeValue(instance);
        }
        if ((options.staleRecovery ?? "refresh") === "reset") {
          instance.currentPageKey = context.firstPageKey;
          const first = pageCache.get(context.firstPageKey);
          instance.snapshot = first ? { result: first } : {};
          return createRuntimeValue(instance, {
            code: runtimeError.code,
            message: runtimeError.message,
            mode: "reset",
          });
        }
        clearCachedContinuationPages(context.cacheKey, context.firstPageKey);
        const refreshed = await moveToPage(context, undefined, {
          ...options,
          useCache: false,
        });
        return {
          ...refreshed,
          staleRecovery: {
            code: runtimeError.code,
            message: runtimeError.message,
            mode: "refresh",
          },
        };
      }
    },

    async refresh(spec, options = {}) {
      const context = await resolveContext(spec, options);
      const instance = ensureInstance(context);
      instance.currentPageKey = context.firstPageKey;
      instance.snapshot = instance.snapshot.result
        ? { isRefreshing: true, result: instance.snapshot.result }
        : { isRefreshing: true };
      clearCachedContinuationPages(context.cacheKey, context.firstPageKey);
      return moveToPage(context, undefined, {
        ...options,
        useCache: false,
      });
    },
  };
}

function validateQuerySource(
  query: QueryContainerQuerySource,
  issues: QueryContainerValidationIssue[],
): void {
  if (query.kind === "saved") {
    if (query.queryId.trim().length === 0) {
      issues.push(
        createIssue(
          "invalid-query-id",
          "Query container query.queryId",
          "must be a non-empty string.",
        ),
      );
    }
    if (query.params) {
      for (const [name, value] of Object.entries(query.params)) {
        if (name.trim().length === 0) {
          issues.push(
            createIssue(
              "serialized-query-invalid",
              "Query container query.params",
              "must not include blank parameter names.",
            ),
          );
        }
        if (!isQueryLiteralValue(value)) {
          issues.push(
            createIssue(
              "serialized-query-invalid",
              `Query container query.params.${name || "<blank>"}`,
              "must be a query literal value.",
            ),
          );
        }
      }
    }
    return;
  }

  try {
    validateSerializedQueryRequest(query.request);
  } catch (error) {
    if (error instanceof SerializedQueryValidationError) {
      issues.push(
        createIssue(
          "serialized-query-invalid",
          "Query container query.request",
          `is invalid: ${error.message}`,
        ),
      );
      return;
    }
    throw error;
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

export function validateRendererBindingCompatibility(
  spec: QueryContainerSpec,
  surface: QuerySurfaceRendererCompatibility,
  renderer: QueryRendererCapability | undefined,
): readonly QueryContainerValidationIssue[] {
  const issues: QueryContainerValidationIssue[] = [];
  const sourceKind = spec.query.kind;

  if (!renderer) {
    issues.push(
      createIssue(
        "unknown-renderer",
        "Query container renderer.rendererId",
        `references unknown renderer "${spec.renderer.rendererId}".`,
      ),
    );
    return issues;
  }

  if (!surface.compatibleRendererIds.includes(renderer.rendererId)) {
    issues.push(
      createIssue(
        "renderer-not-compatible",
        "Query container renderer.rendererId",
        `is not compatible with query surface "${surface.surfaceId}".`,
      ),
    );
  }

  if (!renderer.supportedQueryKinds.includes(surface.queryKind)) {
    issues.push(
      createIssue(
        "renderer-query-kind-unsupported",
        "Query container renderer.rendererId",
        `does not support query kind "${surface.queryKind}".`,
      ),
    );
  }

  if (!renderer.supportedResultKinds.includes(surface.resultKind)) {
    issues.push(
      createIssue(
        "renderer-result-kind-unsupported",
        "Query container renderer.rendererId",
        `does not support result kind "${surface.resultKind}".`,
      ),
    );
  }

  if (
    surface.sourceKinds &&
    surface.sourceKinds.length > 0 &&
    !surface.sourceKinds.includes(sourceKind)
  ) {
    issues.push(
      createIssue(
        "renderer-source-kind-unsupported",
        "Query container query.kind",
        `source kind "${sourceKind}" is not supported by query surface "${surface.surfaceId}".`,
      ),
    );
  }

  if (
    renderer.supportedSourceKinds &&
    renderer.supportedSourceKinds.length > 0 &&
    !renderer.supportedSourceKinds.includes(sourceKind)
  ) {
    issues.push(
      createIssue(
        "renderer-source-kind-unsupported",
        "Query container renderer.rendererId",
        `does not support query source kind "${sourceKind}".`,
      ),
    );
  }

  const paginationMode = spec.pagination?.mode ?? "paged";
  if (
    renderer.supportedPaginationModes &&
    renderer.supportedPaginationModes.length > 0 &&
    !renderer.supportedPaginationModes.includes(paginationMode)
  ) {
    issues.push(
      createIssue(
        "renderer-pagination-unsupported",
        "Query container pagination.mode",
        `pagination mode "${paginationMode}" is not supported by renderer "${renderer.rendererId}".`,
      ),
    );
  }

  const entityIdSupport = renderer.supportsEntityId ?? "optional";
  const itemEntityIds = surface.itemEntityIds ?? "optional";
  if (entityIdSupport === "required" && itemEntityIds === "forbidden") {
    issues.push(
      createIssue(
        "renderer-entity-id-required",
        "Query container renderer.rendererId",
        `requires entity-backed rows, but query surface "${surface.surfaceId}" does not provide entity ids.`,
      ),
    );
  }
  if (entityIdSupport === "forbidden" && itemEntityIds === "required") {
    issues.push(
      createIssue(
        "renderer-entity-id-forbidden",
        "Query container renderer.rendererId",
        `cannot render entity-backed rows required by query surface "${surface.surfaceId}".`,
      ),
    );
  }

  return issues;
}

export function validateQueryContainerSpec(
  spec: QueryContainerSpec,
  options: QueryContainerValidationOptions = {},
): QueryContainerValidationResult {
  const issues: QueryContainerValidationIssue[] = [];

  if (spec.containerId.trim().length === 0) {
    issues.push(
      createIssue(
        "invalid-container-id",
        "Query container containerId",
        "must be a non-empty string.",
      ),
    );
  }

  validateQuerySource(spec.query, issues);

  if (spec.renderer.rendererId.trim().length === 0) {
    issues.push(
      createIssue(
        "invalid-renderer-id",
        "Query container renderer.rendererId",
        "must be a non-empty string.",
      ),
    );
  }

  if (spec.pagination && !isPositiveInteger(spec.pagination.pageSize)) {
    issues.push(
      createIssue(
        "invalid-page-size",
        "Query container pagination.pageSize",
        "must be a positive integer.",
      ),
    );
  }

  if (spec.refresh?.mode === "poll") {
    if (spec.refresh.pollIntervalMs === undefined) {
      issues.push(
        createIssue(
          "missing-poll-interval",
          "Query container refresh.pollIntervalMs",
          'is required when refresh.mode is "poll".',
        ),
      );
    } else if (!isPositiveInteger(spec.refresh.pollIntervalMs)) {
      issues.push(
        createIssue(
          "invalid-poll-interval",
          "Query container refresh.pollIntervalMs",
          "must be a positive integer.",
        ),
      );
    }
  } else if (spec.refresh?.pollIntervalMs !== undefined) {
    issues.push(
      createIssue(
        "poll-interval-not-supported",
        "Query container refresh.pollIntervalMs",
        'is only supported when refresh.mode is "poll".',
      ),
    );
  }

  if (options.surface) {
    const renderer = options.rendererCapabilities?.[spec.renderer.rendererId];
    issues.push(...validateRendererBindingCompatibility(spec, options.surface, renderer));
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function assertValidQueryContainerSpec(
  spec: QueryContainerSpec,
  options: QueryContainerValidationOptions = {},
): QueryContainerSpec {
  const result = validateQueryContainerSpec(spec, options);
  if (!result.ok) {
    throw new QueryContainerValidationError(result.issues);
  }
  return spec;
}

export function resolveQueryContainerState(
  snapshot: QueryContainerRuntimeSnapshot,
): QueryContainerState {
  if (!snapshot.result) {
    if (snapshot.error) {
      return {
        kind: "error",
        error: snapshot.error,
      };
    }
    return { kind: "loading" };
  }

  const { result } = snapshot;
  const nextCursor = result.nextCursor;

  if (snapshot.isRefreshing) {
    return {
      kind: "refreshing",
      result,
      nextCursor,
    };
  }

  if (result.freshness.freshness === "stale") {
    return {
      kind: "stale",
      result,
      nextCursor,
    };
  }

  if (result.items.length === 0) {
    return {
      kind: "empty",
      result,
    };
  }

  if (nextCursor) {
    return {
      kind: "paginated",
      result,
      nextCursor,
    };
  }

  return {
    kind: "ready",
    result,
  };
}
