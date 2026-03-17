import { describe, expect, it } from "bun:test";

import { GraphValidationError, edgeId, type GraphWriteTransaction } from "@io/core/graph";
import { app } from "@io/core/graph/schema/app";

import { createExampleRuntime } from "./example-runtime.js";

function createTopicNameWriteTransaction(
  store: ReturnType<typeof createExampleRuntime>["authority"]["store"],
  topicId: string,
  name: string,
  txId: string,
  options: {
    assertFirst?: boolean;
    edgeId?: string;
  } = {},
): GraphWriteTransaction {
  const retractOps = store.facts(topicId, edgeId(app.topic.fields.name)).map((edge) => ({
    op: "retract" as const,
    edgeId: edge.id,
  }));
  const assertOp = {
    op: "assert" as const,
    edge: {
      id: options.edgeId ?? store.newNode(),
      s: topicId,
      p: edgeId(app.topic.fields.name),
      o: name,
    },
  };

  return {
    id: txId,
    ops: options.assertFirst ? [assertOp, ...retractOps] : [...retractOps, assertOp],
  };
}

describe("example runtime sync integration", () => {
  it("proves peers catch up through ordered incremental delivery without extra total snapshots", async () => {
    const runtime = createExampleRuntime();
    const peer = runtime.createPeer();
    const baseCursor = peer.sync.getState().cursor;
    const syncPayloadCount = runtime.authority.getSyncPayloadCount();

    if (!baseCursor) throw new Error("Expected peer bootstrap cursor.");
    expect(runtime.graph.topic.get(runtime.ids.graphExplorer).name).toBe("Graph Explorer");
    expect(peer.graph.topic.get(runtime.ids.graphExplorer).name).toBe("Graph Explorer");

    const first = await runtime.commitLocalMutation(runtime, "tx:runtime:1", (graph) => {
      graph.topic.update(runtime.ids.graphExplorer, {
        name: "Graph Explorer Runtime",
      });
    });
    const second = await runtime.commitLocalMutation(runtime, "tx:runtime:2", (graph) => {
      graph.topic.update(runtime.ids.graphExplorer, {
        name: "Graph Explorer Runtime Two",
      });
    });

    expect(first).toMatchObject({
      txId: "tx:runtime:1",
      cursor: "example:1",
      replayed: false,
    });
    expect(second).toMatchObject({
      txId: "tx:runtime:2",
      cursor: "example:2",
      replayed: false,
    });
    expect(runtime.authority.graph.topic.get(runtime.ids.graphExplorer).name).toBe(
      "Graph Explorer Runtime Two",
    );
    expect(runtime.graph.topic.get(runtime.ids.graphExplorer).name).toBe(
      "Graph Explorer Runtime Two",
    );
    expect(peer.graph.topic.get(runtime.ids.graphExplorer).name).toBe("Graph Explorer");

    const applied = await peer.sync.sync();

    expect(applied.mode).toBe("incremental");
    expect("fallback" in applied).toBe(false);
    if (applied.mode !== "incremental" || "fallback" in applied) {
      throw new Error("Expected a data-bearing incremental sync result.");
    }
    expect(applied.after).toBe(baseCursor);
    expect(applied.cursor).toBe(second.cursor);
    expect(applied.transactions).toEqual([first, second]);
    expect(runtime.authority.getSyncPayloadCount()).toBe(syncPayloadCount);
    expect(runtime.sync.getState()).toMatchObject({
      status: "ready",
      cursor: second.cursor,
      completeness: "complete",
      freshness: "current",
    });
    expect(peer.graph.topic.get(runtime.ids.graphExplorer).name).toBe("Graph Explorer Runtime Two");
    expect(peer.sync.getState()).toMatchObject({
      status: "ready",
      cursor: second.cursor,
      completeness: "complete",
      freshness: "current",
    });
    expect(peer.sync.getState().recentActivities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "incremental",
          after: baseCursor,
          cursor: second.cursor,
          txIds: [first.txId, second.txId],
          transactionCount: 2,
          freshness: "current",
        }),
      ]),
    );
  });

  it("bootstraps the example runtime on the authority base cursor and records incremental pull activity", async () => {
    const runtime = createExampleRuntime();
    const baseCursor = runtime.authority.getBaseCursor();

    expect(runtime.sync.getState()).toMatchObject({
      status: "ready",
      cursor: baseCursor,
      completeness: "complete",
      freshness: "current",
    });
    expect(runtime.sync.getState().recentActivities).toEqual([
      expect.objectContaining({
        kind: "total",
        cursor: baseCursor,
        freshness: "current",
      }),
    ]);

    const result = runtime.authority.applyTransaction(
      createTopicNameWriteTransaction(
        runtime.authority.store,
        runtime.ids.graphExplorer,
        "Graph Explorer Pull",
        "tx:pull:1",
      ),
    );

    const applied = await runtime.sync.sync();

    expect(applied.mode).toBe("incremental");
    expect("fallback" in applied).toBe(false);
    if (applied.mode !== "incremental" || "fallback" in applied) {
      throw new Error("Expected an incremental sync result.");
    }
    expect(applied.after).toBe(baseCursor);
    expect(applied.cursor).toBe(result.cursor);
    expect(applied.transactions).toEqual([result]);
    expect(runtime.graph.topic.get(runtime.ids.graphExplorer).name).toBe("Graph Explorer Pull");
    expect(runtime.sync.getState()).toMatchObject({
      status: "ready",
      cursor: result.cursor,
      completeness: "complete",
      freshness: "current",
    });
    expect(runtime.sync.getState().recentActivities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "incremental",
          after: baseCursor,
          cursor: result.cursor,
          transactionCount: 1,
          txIds: [result.txId],
          freshness: "current",
        }),
      ]),
    );
  });

  it("records reset fallbacks until the caller recovers with a total snapshot", async () => {
    const runtime = createExampleRuntime();
    const acknowledged = await runtime.commitLocalMutation(runtime, "tx:runtime:reset", (graph) => {
      graph.topic.update(runtime.ids.graphExplorer, {
        name: "Graph Explorer Reset",
      });
    });

    const resetCursor = runtime.authority.resetAuthorityStream("reset:");

    let error: unknown;
    try {
      await runtime.sync.sync();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    expect(runtime.sync.getState()).toMatchObject({
      status: "error",
      cursor: acknowledged.cursor,
      completeness: "complete",
      freshness: "stale",
    });
    expect(runtime.sync.getState().recentActivities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "fallback",
          after: acknowledged.cursor,
          cursor: resetCursor,
          reason: "reset",
          freshness: "current",
        }),
      ]),
    );

    const recovered = runtime.sync.apply(runtime.authority.createSyncPayload());

    expect(recovered).toMatchObject({
      mode: "total",
      cursor: resetCursor,
      freshness: "current",
    });
    expect(runtime.sync.getState()).toMatchObject({
      status: "ready",
      cursor: resetCursor,
      completeness: "complete",
      freshness: "current",
    });
  });
});
