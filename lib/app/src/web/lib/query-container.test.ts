import { describe, expect, it } from "bun:test";

import { serializedQueryVersion, type QueryResultPage } from "@io/graph-client";

import {
  QueryContainerValidationError,
  assertValidQueryContainerSpec,
  createQueryContainerCacheKey,
  createQueryContainerRuntime,
  createQueryContainerPageCacheKey,
  mountInlineQueryRenderer,
  mountSavedQueryRenderer,
  resolveQueryContainerState,
  validateQueryContainerSpec,
  validateRendererBindingCompatibility,
  type QueryContainerSpec,
  type QueryRendererCapability,
  type QuerySurfaceRendererCompatibility,
} from "./query-container.js";

function createResultPage(overrides: Partial<QueryResultPage> = {}): QueryResultPage {
  return {
    kind: "collection",
    items: [
      {
        key: "row:1",
        entityId: "entity:1",
        payload: { title: "Example" },
      },
    ],
    freshness: {
      completeness: "complete",
      freshness: "current",
    },
    ...overrides,
  };
}

describe("query container validation", () => {
  const rendererCapabilities = {
    "renderer:board": {
      rendererId: "renderer:board",
      supportedPaginationModes: ["paged"],
      supportedQueryKinds: ["collection", "scope"],
      supportedResultKinds: ["collection", "scope"],
      supportedSourceKinds: ["saved", "inline"],
      supportsEntityId: "required",
    },
  } as const satisfies Record<string, QueryRendererCapability>;

  const workflowSurface = {
    compatibleRendererIds: ["renderer:board"],
    itemEntityIds: "required",
    queryKind: "collection",
    resultKind: "collection",
    sourceKinds: ["saved", "inline"],
    surfaceId: "workflow:project-branch-board",
  } as const satisfies QuerySurfaceRendererCompatibility;

  const validSpec = {
    containerId: "workflow-board",
    pagination: {
      mode: "paged",
      pageSize: 25,
    },
    query: {
      kind: "inline",
      request: {
        version: serializedQueryVersion,
        query: {
          kind: "collection",
          indexId: "workflow:project-branch-board",
        },
      },
    },
    refresh: {
      mode: "poll",
      pollIntervalMs: 30_000,
    },
    renderer: {
      rendererId: "renderer:board",
    },
  } as const satisfies QueryContainerSpec;

  it("accepts a valid query container spec", () => {
    expect(
      validateQueryContainerSpec(validSpec, {
        rendererCapabilities,
        surface: workflowSurface,
      }),
    ).toEqual({
      ok: true,
      issues: [],
    });
  });

  it("rejects invalid container settings and malformed inline queries", () => {
    const result = validateQueryContainerSpec({
      ...validSpec,
      containerId: "   ",
      pagination: {
        mode: "paged",
        pageSize: 0,
      },
      query: {
        kind: "inline",
        request: {
          version: 99,
          query: {
            kind: "collection",
            indexId: "workflow:project-branch-board",
          },
        },
      },
      refresh: {
        mode: "manual",
        pollIntervalMs: 30_000,
      },
      renderer: {
        rendererId: "   ",
      },
    } as unknown as QueryContainerSpec);

    expect(result.ok).toBeFalse();
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid-container-id" }),
        expect.objectContaining({ code: "invalid-page-size" }),
        expect.objectContaining({ code: "serialized-query-invalid" }),
        expect.objectContaining({ code: "poll-interval-not-supported" }),
        expect.objectContaining({ code: "invalid-renderer-id" }),
      ]),
    );
  });

  it("validates renderer compatibility explicitly", () => {
    const issues = validateRendererBindingCompatibility(
      {
        ...validSpec,
        query: {
          kind: "saved",
          queryId: "saved-query:1",
        },
        pagination: {
          mode: "infinite",
          pageSize: 25,
        },
        renderer: {
          rendererId: "renderer:board",
        },
      },
      {
        compatibleRendererIds: ["renderer:table"],
        itemEntityIds: "forbidden",
        queryKind: "entity",
        resultKind: "entity-detail",
        sourceKinds: ["inline"],
        surfaceId: "core:entity-detail",
      },
      rendererCapabilities["renderer:board"],
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "renderer-not-compatible" }),
        expect.objectContaining({ code: "renderer-query-kind-unsupported" }),
        expect.objectContaining({ code: "renderer-result-kind-unsupported" }),
        expect.objectContaining({ code: "renderer-source-kind-unsupported" }),
        expect.objectContaining({ code: "renderer-pagination-unsupported" }),
        expect.objectContaining({ code: "renderer-entity-id-required" }),
      ]),
    );
  });

  it("throws a dedicated error from assertValidQueryContainerSpec", () => {
    expect(() =>
      assertValidQueryContainerSpec(
        {
          ...validSpec,
          refresh: {
            mode: "poll",
          },
        },
        {
          rendererCapabilities,
          surface: workflowSurface,
        },
      ),
    ).toThrow(QueryContainerValidationError);
  });
});

describe("query renderer mount helpers", () => {
  it("mounts inline and saved query sources through the shared container contract", () => {
    const renderer = {
      definition: {
        item: {
          titleField: "title",
        },
        kind: "list",
      },
      rendererId: "core:list",
    } as const;

    expect(
      mountInlineQueryRenderer(
        {
          version: serializedQueryVersion,
          query: {
            kind: "collection",
            indexId: "workflow:project-branch-board",
          },
        },
        {
          containerId: "inline-preview",
          pagination: {
            mode: "paged",
            pageSize: 10,
          },
          renderer,
        },
      ),
    ).toEqual({
      containerId: "inline-preview",
      pagination: {
        mode: "paged",
        pageSize: 10,
      },
      query: {
        kind: "inline",
        request: {
          version: serializedQueryVersion,
          query: {
            kind: "collection",
            indexId: "workflow:project-branch-board",
          },
        },
      },
      renderer,
    });

    expect(
      mountSavedQueryRenderer(
        {
          params: {
            owner: "person:avery",
          },
          queryId: "saved-query:1",
        },
        {
          containerId: "saved-preview",
          refresh: {
            mode: "manual",
          },
          renderer,
        },
      ),
    ).toEqual({
      containerId: "saved-preview",
      query: {
        kind: "saved",
        params: {
          owner: "person:avery",
        },
        queryId: "saved-query:1",
      },
      refresh: {
        mode: "manual",
      },
      renderer,
    });
  });
});

describe("query container lifecycle state", () => {
  it("treats missing results as loading or error", () => {
    expect(resolveQueryContainerState({})).toEqual({ kind: "loading" });
    expect(resolveQueryContainerState({ error: { message: "boom", code: "failed" } })).toEqual({
      kind: "error",
      error: { message: "boom", code: "failed" },
    });
  });

  it("prioritizes refreshing and stale snapshots over ready-state chrome", () => {
    const result = createResultPage({
      nextCursor: "cursor:2",
    });

    expect(resolveQueryContainerState({ isRefreshing: true, result })).toEqual({
      kind: "refreshing",
      nextCursor: "cursor:2",
      result,
    });

    const stale = createResultPage({
      freshness: {
        completeness: "complete",
        freshness: "stale",
      },
      nextCursor: "cursor:2",
    });

    expect(resolveQueryContainerState({ result: stale })).toEqual({
      kind: "stale",
      nextCursor: "cursor:2",
      result: stale,
    });
  });

  it("distinguishes empty, paginated, and ready results", () => {
    const empty = createResultPage({ items: [] });
    expect(resolveQueryContainerState({ result: empty })).toEqual({
      kind: "empty",
      result: empty,
    });

    const paginated = createResultPage({ nextCursor: "cursor:2" });
    expect(resolveQueryContainerState({ result: paginated })).toEqual({
      kind: "paginated",
      nextCursor: "cursor:2",
      result: paginated,
    });

    const ready = createResultPage();
    expect(resolveQueryContainerState({ result: ready })).toEqual({
      kind: "ready",
      result: ready,
    });
  });
});

describe("query container runtime", () => {
  const inlineSpec = {
    containerId: "workflow-board",
    pagination: {
      mode: "paged",
      pageSize: 2,
    },
    query: {
      kind: "inline",
      request: {
        version: serializedQueryVersion,
        query: {
          kind: "collection",
          indexId: "workflow:project-branch-board",
        },
      },
    },
    renderer: {
      rendererId: "renderer:board",
    },
  } as const satisfies QueryContainerSpec;

  it("creates renderer-independent cache keys from query identity and page settings", async () => {
    const first = await createQueryContainerCacheKey(inlineSpec, inlineSpec.query.request, {
      executionContext: {
        principalId: "principal:1",
      },
    });
    const second = await createQueryContainerCacheKey(
      {
        ...inlineSpec,
        renderer: { rendererId: "renderer:table" },
      },
      inlineSpec.query.request,
      {
        executionContext: {
          principalId: "principal:1",
        },
      },
    );
    const differentPrincipal = await createQueryContainerCacheKey(
      inlineSpec,
      inlineSpec.query.request,
      {
        executionContext: {
          principalId: "principal:2",
        },
      },
    );

    expect(first).toBe(second);
    expect(differentPrincipal).not.toBe(first);
    expect(createQueryContainerPageCacheKey(first)).toContain("page:first");
  });

  it("executes inline and saved queries through one runtime path and shares cached first pages", async () => {
    const executed: string[] = [];
    const runtime = createQueryContainerRuntime({
      async executePage(request) {
        executed.push(JSON.stringify(request));
        return createResultPage({
          nextCursor: "cursor:2",
        });
      },
      async resolveSource(source) {
        if (source.kind === "saved") {
          return {
            request: inlineSpec.query.request,
            sourceCacheKey: `saved:${source.queryId}`,
          };
        }
        return { request: source.request };
      },
    });

    const inline = await runtime.load(inlineSpec);
    const saved = await runtime.load({
      ...inlineSpec,
      containerId: "saved-board",
      query: {
        kind: "saved",
        queryId: "saved-query:1",
      },
    });
    const repeatedInline = await runtime.load({
      ...inlineSpec,
      containerId: "workflow-board-copy",
    });

    expect(inline.state.kind).toBe("paginated");
    expect(saved.state.kind).toBe("paginated");
    expect(repeatedInline.state.kind).toBe("paginated");
    expect(executed).toHaveLength(2);
  });

  it("keeps page lifecycle per container instance while sharing fetched pages", async () => {
    const requests: readonly string[] = [];
    const runtime = createQueryContainerRuntime({
      async executePage(request) {
        (requests as string[]).push(
          JSON.stringify(
            request.query.kind === "collection" || request.query.kind === "scope"
              ? request.query.window
              : undefined,
          ),
        );
        const after =
          request.query.kind === "collection" || request.query.kind === "scope"
            ? request.query.window?.after
            : undefined;
        return createResultPage({
          items: [
            {
              key: after ? `row:${after}` : "row:first",
              entityId: "entity:1",
              payload: { after: after ?? null },
            },
          ],
          nextCursor: after ? undefined : "cursor:2",
        });
      },
    });

    const first = await runtime.load(inlineSpec);
    const next = await runtime.paginate(inlineSpec);
    const secondInstance = await runtime.load({
      ...inlineSpec,
      containerId: "workflow-board-secondary",
    });

    expect(first.state.kind).toBe("paginated");
    expect(next.state.kind).toBe("ready");
    expect(secondInstance.state.kind).toBe("paginated");
    expect(next.snapshot.result?.items[0]?.key).toBe("row:cursor:2");
    expect(secondInstance.snapshot.result?.items[0]?.key).toBe("row:first");
    expect(requests).toEqual(['{"limit":2}', '{"limit":2,"after":"cursor:2"}']);
  });

  it("marks the current page stale and refreshes from the first page", async () => {
    let executionCount = 0;
    const runtime = createQueryContainerRuntime({
      async executePage(request) {
        executionCount += 1;
        return createResultPage({
          items: [
            {
              key: `row:${executionCount}`,
              entityId: "entity:1",
              payload: {
                count: executionCount,
                after:
                  request.query.kind === "collection"
                    ? (request.query.window?.after ?? null)
                    : null,
              },
            },
          ],
          nextCursor: executionCount === 1 ? "cursor:2" : undefined,
        });
      },
    });

    await runtime.load(inlineSpec);
    const stale = await runtime.markStale(inlineSpec);
    const refreshed = await runtime.refresh(inlineSpec);

    expect(stale?.state.kind).toBe("stale");
    expect(refreshed.state.kind).toBe("ready");
    expect(refreshed.snapshot.result?.items[0]?.key).toBe("row:2");
  });

  it("recovers fail-closed from stale pagination by resetting or refreshing", async () => {
    class ProjectionStaleError extends Error {
      code = "projection-stale" as const;
    }

    let firstPageCount = 0;
    const runtime = createQueryContainerRuntime({
      async executePage(request) {
        const after = request.query.kind === "collection" ? request.query.window?.after : undefined;
        if (after) {
          throw new ProjectionStaleError("Cursor is stale for the current serialized query.");
        }
        firstPageCount += 1;
        return createResultPage({
          items: [
            {
              key: `row:first:${firstPageCount}`,
              entityId: "entity:1",
              payload: { count: firstPageCount },
            },
          ],
          nextCursor: "cursor:2",
        });
      },
    });

    await runtime.load(inlineSpec);
    const reset = await runtime.paginate(inlineSpec, { staleRecovery: "reset" });
    const refreshed = await runtime.paginate(inlineSpec, { staleRecovery: "refresh" });

    expect(reset.staleRecovery).toEqual({
      code: "projection-stale",
      message: "Cursor is stale for the current serialized query.",
      mode: "reset",
    });
    expect(reset.state.kind).toBe("paginated");
    expect(refreshed.staleRecovery).toEqual({
      code: "projection-stale",
      message: "Cursor is stale for the current serialized query.",
      mode: "refresh",
    });
    expect(refreshed.snapshot.result?.items[0]?.key).toBe("row:first:2");
  });

  it("restarts from the first page when saved-query identity changes", async () => {
    const requests: string[] = [];
    const runtime = createQueryContainerRuntime({
      async executePage(request) {
        const collection = request.query.kind === "collection" ? request.query : undefined;
        const owner = typeof request.params?.owner === "string" ? request.params.owner : "unknown";
        const after = collection?.window?.after;
        requests.push(`${owner}:${after ?? "first"}`);
        return createResultPage({
          items: [
            {
              key: `${owner}:${after ?? "first"}`,
              entityId: "entity:1",
              payload: { owner },
            },
          ],
          nextCursor: after ? undefined : "cursor:2",
        });
      },
      async resolveSource(source) {
        const owner =
          source.kind === "saved" && typeof source.params?.owner === "string"
            ? source.params.owner
            : "person:avery";
        if (source.kind === "inline") {
          return { request: source.request };
        }
        return {
          request: {
            params: {
              owner,
            },
            query: {
              filter: {
                fieldId: "ownerId",
                op: "eq",
                value: {
                  kind: "literal",
                  value: owner,
                },
              },
              indexId: "workflow:project-branch-board",
              kind: "collection",
              window: {
                limit: 2,
              },
            },
            version: serializedQueryVersion,
          },
        };
      },
    });

    const initialSpec = {
      ...inlineSpec,
      query: {
        kind: "saved" as const,
        params: {
          owner: "person:avery",
        },
        queryId: "saved-query:owner-board",
      },
    };
    await runtime.load(initialSpec);
    const secondPage = await runtime.paginate(initialSpec);
    const changedIdentity = await runtime.load({
      ...initialSpec,
      query: {
        ...initialSpec.query,
        params: {
          owner: "person:sam",
        },
      },
    });

    expect(secondPage.pageKey).toContain("cursor:2");
    expect(changedIdentity.pageKey).toContain("page:first");
    expect(changedIdentity.snapshot.result?.items[0]?.key).toBe("person:sam:first");
    expect(requests).toEqual(["person:avery:first", "person:avery:cursor:2", "person:sam:first"]);
  });

  it("restarts from the first page when execution context changes", async () => {
    const requests: string[] = [];
    const runtime = createQueryContainerRuntime({
      async executePage(request) {
        const after = request.query.kind === "collection" ? request.query.window?.after : undefined;
        const principal =
          typeof request.params?.principal === "string" ? request.params.principal : "unknown";
        requests.push(`${principal}:${after ?? "first"}`);
        return createResultPage({
          items: [
            {
              key: `${principal}:${after ?? "first"}`,
              entityId: "entity:1",
              payload: { principal },
            },
          ],
          nextCursor: after ? undefined : "cursor:2",
        });
      },
      async resolveSource(source) {
        if (source.kind !== "inline") {
          throw new Error("Expected inline query source.");
        }
        return {
          request: {
            ...source.request,
            params: {
              ...source.request.params,
              principal:
                typeof source.request.params?.principal === "string"
                  ? source.request.params.principal
                  : "unknown",
            },
          },
        };
      },
    });

    const principalOneSpec = {
      ...inlineSpec,
      query: {
        kind: "inline" as const,
        request: {
          ...inlineSpec.query.request,
          params: {
            principal: "principal:1",
          },
        },
      },
    };

    await runtime.load(principalOneSpec, {
      executionContext: {
        principalId: "principal:1",
      },
    });
    const principalOneNext = await runtime.paginate(principalOneSpec, {
      executionContext: {
        principalId: "principal:1",
      },
    });
    const principalTwo = await runtime.load(
      {
        ...principalOneSpec,
        query: {
          kind: "inline",
          request: {
            ...principalOneSpec.query.request,
            params: {
              principal: "principal:2",
            },
          },
        },
      },
      {
        executionContext: {
          principalId: "principal:2",
        },
      },
    );

    expect(principalOneNext.pageKey).toContain("cursor:2");
    expect(principalTwo.pageKey).toContain("page:first");
    expect(principalTwo.snapshot.result?.items[0]?.key).toBe("principal:2:first");
    expect(requests).toEqual(["principal:1:first", "principal:1:cursor:2", "principal:2:first"]);
  });
});

describe("@io/app/web/query-container", () => {
  it("exports the shared query container contract surface", async () => {
    const queryContainerExports = await import("@io/app/web/query-container");

    expect(Object.keys(queryContainerExports)).toEqual(
      expect.arrayContaining([
        "QueryContainerValidationError",
        "assertValidQueryContainerSpec",
        "createQueryContainerCacheKey",
        "createQueryContainerPageCacheKey",
        "createQueryContainerRuntime",
        "resolveQueryContainerState",
        "validateQueryContainerSpec",
        "validateRendererBindingCompatibility",
      ]),
    );
  });
});
