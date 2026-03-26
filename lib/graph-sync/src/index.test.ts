import { describe, expect, it } from "bun:test";

import { createGraphWriteTransactionFromSnapshots, createStore } from "@io/graph-kernel";

import {
  createIncrementalSyncFallback,
  createIncrementalSyncPayload,
  createTotalSyncPayload,
  createTotalSyncSession,
  graphSyncScope,
  validateIncrementalSyncResult,
} from "./index";

describe("@io/graph-sync", () => {
  it("applies a total payload through the package root API", () => {
    const server = createStore();
    server.assert("n:1", "p:type", "t:task");

    const session = createTotalSyncSession(createStore());
    const applied = session.apply(
      createTotalSyncPayload(server, {
        cursor: "server:1",
        scope: graphSyncScope,
      }),
    );

    expect(applied).toMatchObject({
      mode: "total",
      cursor: "server:1",
      scope: graphSyncScope,
      completeness: "complete",
      freshness: "current",
    });
    expect(session.getState()).toMatchObject({
      status: "ready",
      cursor: "server:1",
      scope: graphSyncScope,
      completeness: "complete",
      freshness: "current",
    });
  });

  it("derives a write transaction from snapshots through the package root API", () => {
    const store = createStore();
    const before = store.snapshot();
    store.assertEdge({ id: "edge:1", s: "n:1", p: "p:type", o: "t:task" });
    const after = store.snapshot();

    const transaction = createGraphWriteTransactionFromSnapshots(before, after, "tx:1");

    expect(transaction).toEqual({
      id: "tx:1",
      ops: [
        {
          op: "assert",
          edge: {
            id: "edge:1",
            s: "n:1",
            p: "p:type",
            o: "t:task",
          },
        },
      ],
    });
  });

  it("treats an empty incremental payload as a successful sync result", () => {
    const result = createIncrementalSyncPayload([], {
      after: "cursor:1",
      cursor: "cursor:2",
    });

    expect(validateIncrementalSyncResult(result)).toMatchObject({
      ok: true,
      value: {
        after: "cursor:1",
        cursor: "cursor:2",
        transactions: [],
      },
    });
  });

  it("keeps fallback distinct from an empty successful incremental result", () => {
    const result = createIncrementalSyncFallback("unknown-cursor", {
      after: "cursor:1",
      cursor: "cursor:2",
    });

    expect(validateIncrementalSyncResult(result)).toMatchObject({
      ok: true,
      value: {
        fallback: "unknown-cursor",
        transactions: [],
      },
    });
  });
});
