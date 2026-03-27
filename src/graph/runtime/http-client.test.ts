import { describe, expect, it } from "bun:test";

import {
  createAuthoritativeGraphWriteSession,
  createAuthoritativeTotalSyncPayload,
} from "@io/graph-authority";
import { bootstrap } from "@io/graph-bootstrap";
import {
  createHttpGraphClient,
  createSyncedGraphClient,
  defaultHttpGraphUrl,
  defaultHttpSerializedQueryPath,
  GraphValidationError,
  HttpSerializedQueryClientError,
  requestSerializedQuery,
  serializedQueryVersion,
  type FetchImpl,
  type QueryResultPage,
} from "@io/graph-client";
import { createGraphClient } from "@io/graph-client";
import {
  applyGraphIdMap as applyIdMap,
  createGraphIdMap as createIdMap,
  createGraphStore as createStore,
  defineType,
  edgeId,
  createGraphWriteTransactionFromSnapshots,
  type GraphStoreSnapshot,
  type AuthoritativeGraphRetainedHistoryPolicy,
  type AuthoritativeGraphWriteResult,
  type GraphWriteTransaction,
  typeId,
} from "@io/graph-kernel";
import {
  createIncrementalSyncFallback,
  createIncrementalSyncPayload,
  createModuleSyncScope,
  createTotalSyncPayload,
  type SyncPayload,
} from "@io/graph-sync";

import { core } from "../modules/core.js";
import { coreGraphBootstrapOptions } from "../modules/index.js";
import { workflow } from "../modules/workflow.js";

const item = defineType({
  values: { key: "test:item", name: "Item" },
  fields: {
    ...core.node.fields,
  },
});

const testGraph = applyIdMap(createIdMap({ item }).map, { item });
const testDefs = { ...core, ...testGraph } as const;

const hiddenCursorProbe = defineType({
  values: { key: "test:hiddenCursorProbe", name: "Hidden Cursor Probe" },
  fields: {
    name: core.node.fields.name,
    hiddenState: {
      ...core.node.fields.description,
      key: "test:hiddenCursorProbe:hiddenState",
      authority: {
        visibility: "authority-only",
        write: "authority-only",
      },
      meta: {
        ...core.node.fields.description.meta,
        label: "Hidden state",
      },
    },
  },
});

const hiddenCursorNamespace = applyIdMap(createIdMap({ hiddenCursorProbe }).map, {
  hiddenCursorProbe,
});
const hiddenGraph = { ...core, ...hiddenCursorNamespace } as const;

function createAuthority() {
  const store = createStore();
  bootstrap(store, core, coreGraphBootstrapOptions);
  bootstrap(store, testGraph, coreGraphBootstrapOptions);
  const graph = createGraphClient(store, testGraph, testDefs);
  graph.item.create({ name: "Seeded item" });
  const writes = createAuthoritativeGraphWriteSession(store, testGraph, {
    cursorPrefix: "server:",
    definitions: testDefs,
  });

  return {
    store,
    graph,
    writes,
  };
}

function createAuthoritySyncDiagnostics(input: {
  writes: {
    getRetainedHistoryPolicy(): AuthoritativeGraphRetainedHistoryPolicy;
    getBaseCursor(): string;
  };
}) {
  return {
    retainedHistoryPolicy: input.writes.getRetainedHistoryPolicy(),
    retainedBaseCursor: input.writes.getBaseCursor(),
  };
}

function createMockFetch(authority: ReturnType<typeof createAuthority>): FetchImpl {
  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);

    if (url.pathname === "/api/sync") {
      const after = url.searchParams.get("after") ?? undefined;
      const payload: SyncPayload = after
        ? authority.writes.getIncrementalSyncResult(after)
        : createTotalSyncPayload(authority.store, {
            cursor: authority.writes.getCursor() ?? authority.writes.getBaseCursor(),
            diagnostics: createAuthoritySyncDiagnostics(authority),
          });
      return Response.json(payload);
    }

    if (url.pathname === "/api/tx" && request.method === "POST") {
      const transaction = (await request.json()) as GraphWriteTransaction;
      const result: AuthoritativeGraphWriteResult = authority.writes.apply(transaction);
      return Response.json(result);
    }

    return Response.json({ error: `Unhandled ${request.method} ${url.pathname}` }, { status: 404 });
  };
}

function createHiddenCursorAuthority(
  options: {
    retainedHistoryPolicy?: AuthoritativeGraphRetainedHistoryPolicy;
  } = {},
) {
  const store = createStore();
  bootstrap(store, hiddenGraph, coreGraphBootstrapOptions);
  const graph = createGraphClient(store, hiddenGraph);
  const probeId = graph.hiddenCursorProbe.create({
    name: "Hidden Cursor Probe",
  });
  const writes = createAuthoritativeGraphWriteSession(store, hiddenGraph, {
    cursorPrefix: "server:hidden:",
    definitions: hiddenGraph,
    retainedHistoryPolicy: options.retainedHistoryPolicy,
  });

  return {
    store,
    graph,
    probeId,
    writes,
  };
}

function createHiddenCursorAdvanceTransaction(
  snapshot: GraphStoreSnapshot,
  probeId: string,
  hiddenState: string,
  txId: string,
): GraphWriteTransaction {
  const mutationStore = createStore(snapshot);
  const mutationGraph = createGraphClient(mutationStore, hiddenGraph);
  mutationGraph.hiddenCursorProbe.update(probeId, { hiddenState });
  return createGraphWriteTransactionFromSnapshots(snapshot, mutationStore.snapshot(), txId);
}

describe("createHttpGraphClient", () => {
  it("uses the localhost default base url", () => {
    expect(defaultHttpGraphUrl).toBe("http://io.localhost:1355/");
  });

  it("bootstraps from sync and pushes writes over http", async () => {
    const authority = createAuthority();
    const fetch = createMockFetch(authority);

    const client = await createHttpGraphClient(testGraph, {
      bootstrap: coreGraphBootstrapOptions,
      definitions: testDefs,
      fetch,
      createTxId: () => "cli:1",
    });

    expect(client.graph.item.list().map((entity) => entity.name)).toEqual(["Seeded item"]);

    client.graph.item.create({ name: "Created from client" });
    const results = await client.sync.flush();

    expect(results.map((result) => result.txId)).toEqual(["cli:1"]);
    expect(authority.graph.item.list().map((entity) => entity.name)).toEqual([
      "Seeded item",
      "Created from client",
    ]);

    const peer = await createHttpGraphClient(testGraph, {
      bootstrap: coreGraphBootstrapOptions,
      definitions: testDefs,
      fetch,
      createTxId: () => "cli:2",
    });

    expect(peer.graph.item.list().map((entity) => entity.name)).toEqual([
      "Seeded item",
      "Created from client",
    ]);
  });

  it("sends the bearer authorization header on sync and transaction requests", async () => {
    const authority = createAuthority();
    const authorizationHeaders: string[] = [];
    const fetch: FetchImpl = async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      authorizationHeaders.push(request.headers.get("authorization") ?? "");
      const url = new URL(request.url);

      if (url.pathname === "/api/sync") {
        return Response.json(
          createTotalSyncPayload(authority.store, {
            cursor: authority.writes.getCursor() ?? authority.writes.getBaseCursor(),
            diagnostics: createAuthoritySyncDiagnostics({ writes: authority.writes }),
          }),
        );
      }

      if (url.pathname === "/api/tx" && request.method === "POST") {
        const transaction = (await request.json()) as GraphWriteTransaction;
        return Response.json(authority.writes.apply(transaction));
      }

      return Response.json(
        { error: `Unhandled ${request.method} ${url.pathname}` },
        { status: 404 },
      );
    };

    const client = await createHttpGraphClient(testGraph, {
      bearerToken: "share-token",
      bootstrap: coreGraphBootstrapOptions,
      createTxId: () => "cli:auth:1",
      definitions: testDefs,
      fetch,
    });

    client.graph.item.create({ name: "Created from client" });
    await client.sync.flush();

    expect(authorizationHeaders).toEqual(["Bearer share-token", "Bearer share-token"]);
  });

  it("sends same-origin credentials on sync and transaction requests", async () => {
    const authority = createAuthority();
    const credentials: RequestCredentials[] = [];
    const fetch: FetchImpl = async (input, init) => {
      if (init?.credentials) {
        credentials.push(init.credentials);
      }
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);

      if (url.pathname === "/api/sync") {
        return Response.json(
          createTotalSyncPayload(authority.store, {
            cursor: authority.writes.getCursor() ?? authority.writes.getBaseCursor(),
            diagnostics: createAuthoritySyncDiagnostics({ writes: authority.writes }),
          }),
        );
      }

      if (url.pathname === "/api/tx" && request.method === "POST") {
        const transaction = (await request.json()) as GraphWriteTransaction;
        return Response.json(authority.writes.apply(transaction));
      }

      return Response.json(
        { error: `Unhandled ${request.method} ${url.pathname}` },
        { status: 404 },
      );
    };

    const client = await createHttpGraphClient(testGraph, {
      bootstrap: coreGraphBootstrapOptions,
      definitions: testDefs,
      fetch,
      createTxId: () => "cli:credentials:1",
    });

    client.graph.item.create({ name: "Created from client" });
    await client.sync.flush();

    expect(credentials).toEqual(["same-origin", "same-origin"]);
  });

  it("preserves one requested module scope across scoped bootstrap and refresh requests", async () => {
    const authority = createAuthority();
    const requestedScope = {
      kind: "module" as const,
      moduleId: "workflow",
      scopeId: "scope:workflow:review",
    };
    const deliveredScope = createModuleSyncScope({
      moduleId: requestedScope.moduleId,
      scopeId: requestedScope.scopeId,
      definitionHash: "scope-def:v1",
      policyFilterVersion: "policy:v1",
    });
    const requestedUrls: string[] = [];
    let syncCount = 0;
    const fetch: FetchImpl = async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);

      if (url.pathname === "/api/sync") {
        requestedUrls.push(url.toString());
        syncCount += 1;
        const payload: SyncPayload =
          syncCount === 1
            ? createTotalSyncPayload(authority.store, {
                scope: deliveredScope,
                cursor: "module:1",
                freshness: "stale",
              })
            : createIncrementalSyncPayload([], {
                after: "module:1",
                cursor: "module:2",
                scope: deliveredScope,
                freshness: "current",
              });
        return Response.json(payload);
      }

      if (url.pathname === "/api/tx" && request.method === "POST") {
        const transaction = (await request.json()) as GraphWriteTransaction;
        const result: AuthoritativeGraphWriteResult = authority.writes.apply(transaction);
        return Response.json(result);
      }

      return Response.json(
        { error: `Unhandled ${request.method} ${url.pathname}` },
        { status: 404 },
      );
    };

    const client = await createHttpGraphClient(testGraph, {
      bootstrap: coreGraphBootstrapOptions,
      definitions: testDefs,
      fetch,
      requestedScope,
    });

    await client.sync.sync();

    expect(client.sync.getState()).toMatchObject({
      requestedScope,
      scope: deliveredScope,
      cursor: "module:2",
      status: "ready",
    });
    expect(requestedUrls).toEqual([
      "http://io.localhost:1355/api/sync?scopeKind=module&moduleId=workflow&scopeId=scope%3Aworkflow%3Areview",
      "http://io.localhost:1355/api/sync?after=module%3A1&scopeKind=module&moduleId=workflow&scopeId=scope%3Aworkflow%3Areview",
    ]);
  });

  it("surfaces scoped fallback without widening and recovers through a new whole-graph bootstrap", async () => {
    const authority = createAuthority();
    const requestedScope = {
      kind: "module" as const,
      moduleId: "workflow",
      scopeId: "scope:workflow:review",
    };
    const deliveredScope = createModuleSyncScope({
      moduleId: requestedScope.moduleId,
      scopeId: requestedScope.scopeId,
      definitionHash: "scope-def:v1",
      policyFilterVersion: "policy:v1",
    });
    const requestedUrls: string[] = [];

    const fetch: FetchImpl = async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);

      if (url.pathname === "/api/sync") {
        requestedUrls.push(url.toString());
        const after = url.searchParams.get("after");
        const scopeKind = url.searchParams.get("scopeKind");
        const payload: SyncPayload =
          scopeKind === "module" && !after
            ? createTotalSyncPayload(authority.store, {
                scope: deliveredScope,
                cursor: "module:1",
                completeness: "incomplete",
                freshness: "stale",
              })
            : scopeKind === "module" && after === "module:1"
              ? createIncrementalSyncFallback("policy-changed", {
                  after,
                  cursor: "module:2",
                  scope: deliveredScope,
                  completeness: "incomplete",
                  freshness: "current",
                })
              : createTotalSyncPayload(authority.store, {
                  cursor: "graph:1",
                  freshness: "current",
                });
        return Response.json(payload);
      }

      if (url.pathname === "/api/tx" && request.method === "POST") {
        const transaction = (await request.json()) as GraphWriteTransaction;
        const result: AuthoritativeGraphWriteResult = authority.writes.apply(transaction);
        return Response.json(result);
      }

      return Response.json(
        { error: `Unhandled ${request.method} ${url.pathname}` },
        { status: 404 },
      );
    };

    const scopedClient = await createHttpGraphClient(testGraph, {
      bootstrap: coreGraphBootstrapOptions,
      definitions: testDefs,
      fetch,
      requestedScope,
    });

    await expect(scopedClient.sync.sync()).rejects.toBeInstanceOf(GraphValidationError);
    expect(scopedClient.sync.getState()).toMatchObject({
      requestedScope,
      scope: deliveredScope,
      cursor: "module:1",
      completeness: "incomplete",
      freshness: "stale",
      fallbackReason: "policy-changed",
      status: "error",
    });

    const recovered = await createHttpGraphClient(testGraph, {
      bootstrap: coreGraphBootstrapOptions,
      definitions: testDefs,
      fetch,
    });

    expect(recovered.sync.getState()).toMatchObject({
      requestedScope: { kind: "graph" },
      scope: { kind: "graph" },
      cursor: "graph:1",
      freshness: "current",
      status: "ready",
    });
    expect(requestedUrls).toEqual([
      "http://io.localhost:1355/api/sync?scopeKind=module&moduleId=workflow&scopeId=scope%3Aworkflow%3Areview",
      "http://io.localhost:1355/api/sync?after=module%3A1&scopeKind=module&moduleId=workflow&scopeId=scope%3Aworkflow%3Areview",
      "http://io.localhost:1355/api/sync?scopeKind=graph",
    ]);
  });

  it("keeps hidden-only cursor advances explicit over http without materializing replicated writes", async () => {
    const authority = createHiddenCursorAuthority();
    const requestedUrls: string[] = [];
    const fetch: FetchImpl = async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);

      if (url.pathname === "/api/sync") {
        requestedUrls.push(url.toString());
        const after = url.searchParams.get("after") ?? undefined;
        const payload: SyncPayload = after
          ? authority.writes.getIncrementalSyncResult(after)
          : createAuthoritativeTotalSyncPayload(authority.store, hiddenGraph, {
              cursor: authority.writes.getBaseCursor(),
              definitions: hiddenGraph,
              diagnostics: createAuthoritySyncDiagnostics(authority),
            });
        return Response.json(payload);
      }

      return Response.json(
        { error: `Unhandled ${request.method} ${url.pathname}` },
        { status: 404 },
      );
    };

    const client = await createHttpGraphClient(hiddenGraph, {
      bootstrap: coreGraphBootstrapOptions,
      fetch,
    });
    const baseCursor = client.sync.getState().cursor;

    if (!baseCursor) throw new Error("Expected the hidden-cursor client bootstrap cursor.");

    const hidden = authority.writes.apply(
      createHiddenCursorAdvanceTransaction(
        authority.store.snapshot(),
        authority.probeId,
        "hidden:http:1",
        "tx:hidden:http:1",
      ),
      {
        writeScope: "authority-only",
      },
    );
    const applied = await client.sync.sync();

    expect(applied.mode).toBe("incremental");
    expect("fallbackReason" in applied).toBe(false);
    if (applied.mode !== "incremental" || "fallbackReason" in applied) {
      throw new Error("Expected a zero-transaction incremental sync result.");
    }
    expect(applied).toMatchObject({
      after: baseCursor,
      cursor: hidden.cursor,
      transactions: [],
    });
    expect(client.graph.hiddenCursorProbe.get(authority.probeId).hiddenState).toBeUndefined();
    expect(client.sync.getState()).toMatchObject({
      cursor: hidden.cursor,
      status: "ready",
      completeness: "complete",
      freshness: "current",
      diagnostics: {
        retainedBaseCursor: baseCursor,
        retainedHistoryPolicy: {
          kind: "all",
        },
      },
    });

    const activity = client.sync.getState().recentActivities.at(-1);
    if (!activity || activity.kind !== "incremental") {
      throw new Error("Expected the latest HTTP sync activity to be incremental.");
    }
    expect(activity).toMatchObject({
      after: baseCursor,
      cursor: hidden.cursor,
      transactionCount: 0,
      freshness: "current",
    });
    expect(activity.txIds).toEqual([]);
    expect(activity.writeScopes).toEqual([]);
    expect(requestedUrls).toEqual([
      "http://io.localhost:1355/api/sync?scopeKind=graph",
      `http://io.localhost:1355/api/sync?after=${encodeURIComponent(baseCursor)}&scopeKind=graph`,
    ]);
  });

  it("retains count-based fallback diagnostics over http when hidden-only cursors age out", async () => {
    const authority = createHiddenCursorAuthority({
      retainedHistoryPolicy: {
        kind: "transaction-count",
        maxTransactions: 1,
      },
    });
    const fetch: FetchImpl = async (input, init) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);

      if (url.pathname === "/api/sync") {
        const after = url.searchParams.get("after") ?? undefined;
        const payload: SyncPayload = after
          ? authority.writes.getIncrementalSyncResult(after)
          : createAuthoritativeTotalSyncPayload(authority.store, hiddenGraph, {
              cursor: authority.writes.getBaseCursor(),
              definitions: hiddenGraph,
              diagnostics: createAuthoritySyncDiagnostics(authority),
            });
        return Response.json(payload);
      }

      return Response.json(
        { error: `Unhandled ${request.method} ${url.pathname}` },
        { status: 404 },
      );
    };

    const client = await createHttpGraphClient(hiddenGraph, {
      bootstrap: coreGraphBootstrapOptions,
      fetch,
    });
    const baseCursor = client.sync.getState().cursor;

    if (!baseCursor) throw new Error("Expected the hidden-cursor client bootstrap cursor.");

    const firstHidden = authority.writes.apply(
      createHiddenCursorAdvanceTransaction(
        authority.store.snapshot(),
        authority.probeId,
        "hidden:http:gap:1",
        "tx:hidden:http:gap:1",
      ),
      {
        writeScope: "authority-only",
      },
    );
    const retained = await client.sync.sync();

    expect(retained.mode).toBe("incremental");
    expect("fallbackReason" in retained).toBe(false);
    if (retained.mode !== "incremental" || "fallbackReason" in retained) {
      throw new Error("Expected the first hidden-only cursor advance to remain incremental.");
    }
    expect(client.sync.getState()).toMatchObject({
      cursor: firstHidden.cursor,
      diagnostics: {
        retainedBaseCursor: baseCursor,
        retainedHistoryPolicy: {
          kind: "transaction-count",
          maxTransactions: 1,
        },
      },
    });

    const secondHidden = authority.writes.apply(
      createHiddenCursorAdvanceTransaction(
        authority.store.snapshot(),
        authority.probeId,
        "hidden:http:gap:2",
        "tx:hidden:http:gap:2",
      ),
      {
        writeScope: "authority-only",
      },
    );
    authority.writes.apply(
      createHiddenCursorAdvanceTransaction(
        authority.store.snapshot(),
        authority.probeId,
        "hidden:http:gap:3",
        "tx:hidden:http:gap:3",
      ),
      {
        writeScope: "authority-only",
      },
    );

    await expect(client.sync.sync()).rejects.toBeInstanceOf(GraphValidationError);
    expect(client.sync.getState()).toMatchObject({
      cursor: firstHidden.cursor,
      fallbackReason: "gap",
      freshness: "stale",
      status: "error",
      diagnostics: {
        retainedBaseCursor: secondHidden.cursor,
        retainedHistoryPolicy: {
          kind: "transaction-count",
          maxTransactions: 1,
        },
      },
    });
  });

  it("surfaces graph fallback reasons over http until the caller recovers with a new total bootstrap", async () => {
    for (const fallback of ["unknown-cursor", "gap", "reset"] as const) {
      const authority = createAuthority();
      const requestedUrls: string[] = [];
      let syncCount = 0;
      const fallbackCursor = fallback === "reset" ? "reset:0" : "server:2";
      const recoveryCursor = `recovered:${fallback}`;
      const fetch: FetchImpl = async (input, init) => {
        const request = input instanceof Request ? input : new Request(String(input), init);
        const url = new URL(request.url);

        if (url.pathname === "/api/sync") {
          requestedUrls.push(url.toString());
          syncCount += 1;
          const payload: SyncPayload =
            syncCount === 1
              ? createTotalSyncPayload(authority.store, {
                  cursor: "server:1",
                })
              : syncCount === 2
                ? createIncrementalSyncFallback(fallback, {
                    after: "server:1",
                    cursor: fallbackCursor,
                    freshness: "current",
                  })
                : createTotalSyncPayload(authority.store, {
                    cursor: recoveryCursor,
                    freshness: "current",
                  });
          return Response.json(payload);
        }

        return Response.json(
          { error: `Unhandled ${request.method} ${url.pathname}` },
          { status: 404 },
        );
      };

      const client = await createHttpGraphClient(testGraph, {
        bootstrap: coreGraphBootstrapOptions,
        definitions: testDefs,
        fetch,
      });

      await expect(client.sync.sync()).rejects.toBeInstanceOf(GraphValidationError);
      expect(client.sync.getState()).toMatchObject({
        requestedScope: { kind: "graph" },
        scope: { kind: "graph" },
        cursor: "server:1",
        fallbackReason: fallback,
        freshness: "stale",
        status: "error",
      });

      const activity = client.sync.getState().recentActivities.at(-1);
      if (!activity || activity.kind !== "fallback") {
        throw new Error(`Expected the ${fallback} HTTP sync to record a fallback activity.`);
      }
      expect(activity).toMatchObject({
        after: "server:1",
        cursor: fallbackCursor,
        fallbackReason: fallback,
        freshness: "current",
      });

      const recovered = await createHttpGraphClient(testGraph, {
        bootstrap: coreGraphBootstrapOptions,
        definitions: testDefs,
        fetch,
      });

      expect(recovered.sync.getState()).toMatchObject({
        requestedScope: { kind: "graph" },
        scope: { kind: "graph" },
        cursor: recoveryCursor,
        freshness: "current",
        status: "ready",
      });
      expect(requestedUrls).toEqual([
        "http://io.localhost:1355/api/sync?scopeKind=graph",
        "http://io.localhost:1355/api/sync?after=server%3A1&scopeKind=graph",
        "http://io.localhost:1355/api/sync?scopeKind=graph",
      ]);
    }
  });

  it("does not resurrect bootstrapped retracted facts during total sync", async () => {
    const authorityStore = createStore();
    bootstrap(authorityStore, core, coreGraphBootstrapOptions);
    bootstrap(authorityStore, workflow, coreGraphBootstrapOptions);

    const documentTypeId = typeId(workflow.document);
    const documentNamePredicateId = edgeId(core.node.fields.name);
    const currentNameEdge = authorityStore.facts(documentTypeId, documentNamePredicateId)[0];
    if (!currentNameEdge) throw new Error("Expected bootstrapped document name edge.");

    authorityStore.batch(() => {
      authorityStore.retract(currentNameEdge.id);
      authorityStore.assert(documentTypeId, documentNamePredicateId, "Documents");
    });

    const payload = createAuthoritativeTotalSyncPayload(authorityStore, workflow, {
      cursor: "server:1",
      definitions: { ...core, ...workflow },
    });

    const client = createSyncedGraphClient(workflow, {
      bootstrap: coreGraphBootstrapOptions,
      createTxId: () => "cli:1",
      definitions: { ...core, ...workflow },
      pull: async () => payload,
    });

    await expect(client.sync.sync()).resolves.toMatchObject({
      mode: "total",
      cursor: "server:1",
    });
    expect(client.graph.document.get(documentTypeId)?.name).toBe("Documents");
  });
});

describe("requestSerializedQuery", () => {
  it("posts generic serialized queries to the shared query route", async () => {
    const result: QueryResultPage = {
      kind: "entity",
      items: [
        {
          key: "entity:test",
          entityId: "entity:test",
          payload: { name: "Seeded item" },
        },
      ],
      freshness: {
        completeness: "complete",
        freshness: "current",
      },
    };

    const response = await requestSerializedQuery(
      {
        version: serializedQueryVersion,
        query: {
          kind: "entity",
          entityId: "entity:test",
        },
      },
      {
        fetch: async (input, init) => {
          expect(input).toBe(defaultHttpSerializedQueryPath);
          expect(init?.method).toBe("POST");
          expect(init?.credentials).toBe("same-origin");
          expect(init?.headers).toEqual({
            accept: "application/json",
            "content-type": "application/json",
          });
          expect(JSON.parse(String(init?.body))).toEqual({
            version: serializedQueryVersion,
            query: {
              kind: "entity",
              entityId: "entity:test",
            },
          });

          return Response.json({
            ok: true,
            result,
          });
        },
      },
    );

    expect(response).toEqual(result);
  });

  it("surfaces generic serialized query failures with the stable failure code", async () => {
    await expect(
      requestSerializedQuery(
        {
          version: serializedQueryVersion,
          query: {
            kind: "entity",
            entityId: "entity:test",
          },
        },
        {
          fetch: async () =>
            Response.json(
              {
                ok: false,
                error: "Read access to entity:test is denied.",
                code: "policy-denied",
              },
              { status: 403 },
            ),
        },
      ),
    ).rejects.toMatchObject({
      name: HttpSerializedQueryClientError.name,
      status: 403,
      code: "policy-denied",
    });
  });

  it("resolves the generic query route against an explicit base URL and bearer token", async () => {
    const response = await requestSerializedQuery(
      {
        version: serializedQueryVersion,
        query: {
          kind: "entity",
          entityId: "entity:test",
        },
      },
      {
        bearerToken: "share-token",
        url: "https://web.local/app/",
        fetch: async (input, init) => {
          expect(input).toBe("https://web.local/api/query");
          const headers = (init?.headers ?? {}) as Record<string, string>;
          expect(headers.authorization).toBe("Bearer share-token");
          return Response.json({
            ok: true,
            result: {
              kind: "entity",
              items: [],
              freshness: {
                completeness: "complete",
                freshness: "current",
              },
            } satisfies QueryResultPage,
          });
        },
      },
    );

    expect(response).toEqual({
      kind: "entity",
      items: [],
      freshness: {
        completeness: "complete",
        freshness: "current",
      },
    } satisfies QueryResultPage);
  });
});
