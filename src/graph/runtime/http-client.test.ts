import { describe, expect, it } from "bun:test";

import { pkm } from "../modules/pkm.js";
import { bootstrap } from "./bootstrap";
import { GraphValidationError, createTypeClient } from "./client";
import { core } from "./core";
import { createHttpGraphClient, defaultHttpGraphUrl, type FetchImpl } from "./http-client";
import { createIdMap, defineNamespace } from "./identity";
import { defineType, edgeId, typeId } from "./schema";
import { createStore, type StoreSnapshot } from "./store";
import {
  type AuthoritativeGraphRetainedHistoryPolicy,
  createAuthoritativeGraphWriteSession,
  createGraphWriteTransactionFromSnapshots,
  createIncrementalSyncFallback,
  createIncrementalSyncPayload,
  createModuleSyncScope,
  createSyncedTypeClient,
  createTotalSyncPayload,
  type AuthoritativeGraphWriteResult,
  type GraphWriteTransaction,
  type SyncPayload,
} from "./sync";

const item = defineType({
  values: { key: "test:item", name: "Item" },
  fields: {
    ...core.node.fields,
  },
});

const testGraph = defineNamespace(createIdMap({ item }).map, { item });

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

const hiddenCursorNamespace = defineNamespace(createIdMap({ hiddenCursorProbe }).map, {
  hiddenCursorProbe,
});
const hiddenGraph = { ...core, ...hiddenCursorNamespace } as const;

function createAuthority() {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, testGraph);
  const graph = createTypeClient(store, testGraph);
  graph.item.create({ name: "Seeded item" });
  const writes = createAuthoritativeGraphWriteSession(store, testGraph, {
    cursorPrefix: "server:",
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
  bootstrap(store, hiddenGraph);
  const graph = createTypeClient(store, hiddenGraph);
  const probeId = graph.hiddenCursorProbe.create({
    name: "Hidden Cursor Probe",
  });
  const writes = createAuthoritativeGraphWriteSession(store, hiddenGraph, {
    cursorPrefix: "server:hidden:",
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
  snapshot: StoreSnapshot,
  probeId: string,
  hiddenState: string,
  txId: string,
): GraphWriteTransaction {
  const mutationStore = createStore(snapshot);
  const mutationGraph = createTypeClient(mutationStore, hiddenGraph);
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
      createTxId: () => "cli:auth:1",
      fetch,
    });

    client.graph.item.create({ name: "Created from client" });
    await client.sync.flush();

    expect(authorizationHeaders).toEqual(["Bearer share-token", "Bearer share-token"]);
  });

  it("preserves one requested module scope across scoped bootstrap and refresh requests", async () => {
    const authority = createAuthority();
    const requestedScope = {
      kind: "module" as const,
      moduleId: "ops/workflow",
      scopeId: "scope:ops/workflow:review",
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
      "http://io.localhost:1355/api/sync?scopeKind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview",
      "http://io.localhost:1355/api/sync?after=module%3A1&scopeKind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview",
    ]);
  });

  it("surfaces scoped fallback without widening and recovers through a new whole-graph bootstrap", async () => {
    const authority = createAuthority();
    const requestedScope = {
      kind: "module" as const,
      moduleId: "ops/workflow",
      scopeId: "scope:ops/workflow:review",
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
      fallback: "policy-changed",
      status: "error",
    });

    const recovered = await createHttpGraphClient(testGraph, {
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
      "http://io.localhost:1355/api/sync?scopeKind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview",
      "http://io.localhost:1355/api/sync?after=module%3A1&scopeKind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview",
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
          : createTotalSyncPayload(authority.store, {
              cursor: authority.writes.getBaseCursor(),
              diagnostics: createAuthoritySyncDiagnostics(authority),
              namespace: hiddenGraph,
            });
        return Response.json(payload);
      }

      return Response.json(
        { error: `Unhandled ${request.method} ${url.pathname}` },
        { status: 404 },
      );
    };

    const client = await createHttpGraphClient(hiddenGraph, {
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
    expect("fallback" in applied).toBe(false);
    if (applied.mode !== "incremental" || "fallback" in applied) {
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
          : createTotalSyncPayload(authority.store, {
              cursor: authority.writes.getBaseCursor(),
              diagnostics: createAuthoritySyncDiagnostics(authority),
              namespace: hiddenGraph,
            });
        return Response.json(payload);
      }

      return Response.json(
        { error: `Unhandled ${request.method} ${url.pathname}` },
        { status: 404 },
      );
    };

    const client = await createHttpGraphClient(hiddenGraph, {
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
    expect("fallback" in retained).toBe(false);
    if (retained.mode !== "incremental" || "fallback" in retained) {
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
      fallback: "gap",
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
        fetch,
      });

      await expect(client.sync.sync()).rejects.toBeInstanceOf(GraphValidationError);
      expect(client.sync.getState()).toMatchObject({
        requestedScope: { kind: "graph" },
        scope: { kind: "graph" },
        cursor: "server:1",
        fallback,
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
        reason: fallback,
        freshness: "current",
      });

      const recovered = await createHttpGraphClient(testGraph, {
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
    bootstrap(authorityStore, core);
    bootstrap(authorityStore, pkm);

    const topicTypeId = typeId(pkm.topic);
    const topicNamePredicateId = edgeId(core.node.fields.name);
    const currentNameEdge = authorityStore.facts(topicTypeId, topicNamePredicateId)[0];
    if (!currentNameEdge) throw new Error("Expected bootstrapped topic name edge.");

    authorityStore.batch(() => {
      authorityStore.retract(currentNameEdge.id);
      authorityStore.assert(topicTypeId, topicNamePredicateId, "Topics");
    });

    const payload = createTotalSyncPayload(authorityStore, {
      cursor: "server:1",
      namespace: pkm,
    });

    const client = createSyncedTypeClient(pkm, {
      createTxId: () => "cli:1",
      pull: async () => payload,
    });

    await expect(client.sync.sync()).resolves.toMatchObject({
      mode: "total",
      cursor: "server:1",
    });
    expect(client.graph.topic.get(topicTypeId)?.name).toBe("Topics");
  });
});
