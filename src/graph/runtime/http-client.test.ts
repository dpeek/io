import { describe, expect, it } from "bun:test";

import { bootstrap } from "./bootstrap";
import { createTypeClient } from "./client";
import { core } from "./core";
import { createHttpGraphClient, defaultHttpGraphUrl, type FetchImpl } from "./http-client";
import { createIdMap, defineNamespace } from "./identity";
import { defineType } from "./schema";
import { createStore } from "./store";
import {
  createAuthoritativeGraphWriteSession,
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
});
