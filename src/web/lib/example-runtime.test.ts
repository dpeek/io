import { describe, expect, it, setDefaultTimeout } from "bun:test";

import { GraphValidationError, edgeId, type GraphWriteTransaction } from "@io/core/graph";
import { pkm } from "@io/core/graph/modules/pkm";

import { createWorkflowProjectionIndex } from "../../graph/modules/ops/workflow/query.js";
import { createExampleRuntime } from "./example-runtime.js";

setDefaultTimeout(20_000);

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
  const retractOps = store.facts(topicId, edgeId(pkm.topic.fields.name)).map((edge) => ({
    op: "retract" as const,
    edgeId: edge.id,
  }));
  const assertOp = {
    op: "assert" as const,
    edge: {
      id: options.edgeId ?? store.newNode(),
      s: topicId,
      p: edgeId(pkm.topic.fields.name),
      o: name,
    },
  };

  return {
    id: txId,
    ops: options.assertFirst ? [assertOp, ...retractOps] : [...retractOps, assertOp],
  };
}

describe("example runtime sync integration", () => {
  it("seeds a workflow projection that the TUI can hydrate", () => {
    const runtime = createExampleRuntime();
    const projection = createWorkflowProjectionIndex(runtime.graph);

    const branchBoard = projection.readProjectBranchScope({
      projectId: runtime.ids.workflowProject,
      filter: {
        showUnmanagedRepositoryBranches: true,
      },
    });
    const commitQueue = projection.readCommitQueueScope({
      branchId: runtime.ids.workflowBranch,
    });

    expect(branchBoard.project.id).toBe(runtime.ids.workflowProject);
    expect(branchBoard.repository?.id).toBe(runtime.ids.workflowRepository);
    expect(branchBoard.rows.map((row) => row.workflowBranch.id)).toEqual([
      runtime.ids.workflowBranch,
    ]);
    expect(commitQueue.rows.map((row) => row.workflowCommit.id)).toEqual([
      runtime.ids.workflowCommit,
    ]);
    expect(commitQueue.branch.latestSession?.id).toBe(runtime.ids.agentSession);
  });

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

  it("records zero-transaction incremental activity when hidden-only authority work advances the cursor", async () => {
    const runtime = createExampleRuntime();
    const peer = runtime.createPeer();
    const baseCursor = peer.sync.getState().cursor;

    if (!baseCursor) throw new Error("Expected peer bootstrap cursor.");
    expect(peer.graph.hiddenCursorProbe.get(runtime.ids.hiddenCursorProbe).hiddenState).toBe(
      undefined,
    );

    const hidden = runtime.authority.applyHiddenOnlyCursorAdvance("tx:hidden:1");
    const applied = await peer.sync.sync();

    expect(applied.mode).toBe("incremental");
    expect("fallback" in applied).toBe(false);
    if (applied.mode !== "incremental" || "fallback" in applied) {
      throw new Error("Expected an incremental sync result.");
    }
    expect(applied.after).toBe(baseCursor);
    expect(applied.cursor).toBe(hidden.cursor);
    expect(applied.transactions).toEqual([]);

    const activity = peer.sync.getState().recentActivities.at(-1);

    if (!activity || activity.kind !== "incremental") {
      throw new Error("Expected the latest peer activity to be incremental.");
    }
    expect(activity.after).toBe(baseCursor);
    expect(activity.after).not.toBe(activity.cursor);
    expect(activity.cursor).toBe(hidden.cursor);
    expect(activity.transactionCount).toBe(0);
    expect(activity.txIds).toEqual([]);
    expect(activity.writeScopes).toEqual([]);
    expect(peer.sync.getState()).toMatchObject({
      status: "ready",
      cursor: hidden.cursor,
      completeness: "complete",
      freshness: "current",
    });
    expect(peer.graph.hiddenCursorProbe.get(runtime.ids.hiddenCursorProbe).hiddenState).toBe(
      undefined,
    );
  });

  it("records a reset fallback instead of another incremental activity after a hidden-only cursor advance", async () => {
    const runtime = createExampleRuntime();
    const peer = runtime.createPeer();
    const baseCursor = peer.sync.getState().cursor;

    if (!baseCursor) throw new Error("Expected peer bootstrap cursor.");

    const hidden = runtime.authority.applyHiddenOnlyCursorAdvance("tx:hidden:reset:1");
    const retained = await peer.sync.sync();

    expect(retained.mode).toBe("incremental");
    expect("fallback" in retained).toBe(false);
    if (retained.mode !== "incremental" || "fallback" in retained) {
      throw new Error("Expected a retained zero-transaction incremental sync result.");
    }
    expect(retained).toMatchObject({
      after: baseCursor,
      cursor: hidden.cursor,
      transactions: [],
    });

    const resetCursor = runtime.authority.resetAuthorityStream("reset:");

    let error: unknown;
    try {
      await peer.sync.sync();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    expect(peer.sync.getState()).toMatchObject({
      status: "error",
      cursor: hidden.cursor,
      completeness: "complete",
      freshness: "stale",
    });

    const activities = peer.sync.getState().recentActivities;
    const retainedActivity = activities.at(-2);
    const resetActivity = activities.at(-1);

    if (!retainedActivity || retainedActivity.kind !== "incremental") {
      throw new Error("Expected the retained hidden-only sync to record an incremental activity.");
    }
    if (!resetActivity || resetActivity.kind !== "fallback") {
      throw new Error("Expected the reset sync to record a fallback activity.");
    }

    expect(retainedActivity).toMatchObject({
      after: baseCursor,
      cursor: hidden.cursor,
      transactionCount: 0,
      freshness: "current",
    });
    expect(retainedActivity.txIds).toEqual([]);
    expect(retainedActivity.writeScopes).toEqual([]);
    expect(resetActivity).toMatchObject({
      after: hidden.cursor,
      cursor: resetCursor,
      reason: "reset",
      freshness: "current",
    });
    expect(activities.filter((activity) => activity.kind === "incremental")).toHaveLength(1);
    expect(resetActivity.cursor).not.toBe(resetActivity.after);

    const recovered = peer.sync.apply(runtime.authority.createSyncPayload());

    expect(recovered).toMatchObject({
      mode: "total",
      cursor: resetCursor,
      freshness: "current",
    });
    expect(peer.sync.getState()).toMatchObject({
      status: "ready",
      cursor: resetCursor,
      completeness: "complete",
      freshness: "current",
    });
  });

  it("records a gap fallback instead of another incremental activity after hidden-only history is pruned", async () => {
    const runtime = createExampleRuntime({
      retainedHistoryPolicy: {
        kind: "transaction-count",
        maxTransactions: 1,
      },
    });
    const peer = runtime.createPeer();
    const baseCursor = peer.sync.getState().cursor;

    if (!baseCursor) throw new Error("Expected peer bootstrap cursor.");

    const firstHidden = runtime.authority.applyHiddenOnlyCursorAdvance("tx:hidden:gap:1");
    const retained = await peer.sync.sync();

    expect(retained.mode).toBe("incremental");
    expect("fallback" in retained).toBe(false);
    if (retained.mode !== "incremental" || "fallback" in retained) {
      throw new Error("Expected a retained zero-transaction incremental sync result.");
    }
    expect(retained).toMatchObject({
      after: baseCursor,
      cursor: firstHidden.cursor,
      transactions: [],
    });

    runtime.authority.applyHiddenOnlyCursorAdvance("tx:hidden:gap:2");
    const thirdHidden = runtime.authority.applyHiddenOnlyCursorAdvance("tx:hidden:gap:3");

    let error: unknown;
    try {
      await peer.sync.sync();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    expect(peer.sync.getState()).toMatchObject({
      status: "error",
      cursor: firstHidden.cursor,
      completeness: "complete",
      freshness: "stale",
    });

    const activities = peer.sync.getState().recentActivities;
    const retainedActivity = activities.at(-2);
    const gapActivity = activities.at(-1);

    if (!retainedActivity || retainedActivity.kind !== "incremental") {
      throw new Error("Expected the retained hidden-only sync to record an incremental activity.");
    }
    if (!gapActivity || gapActivity.kind !== "fallback") {
      throw new Error("Expected the pruned hidden-only sync to record a fallback activity.");
    }

    expect(retainedActivity).toMatchObject({
      after: baseCursor,
      cursor: firstHidden.cursor,
      transactionCount: 0,
      freshness: "current",
    });
    expect(retainedActivity.txIds).toEqual([]);
    expect(retainedActivity.writeScopes).toEqual([]);
    expect(gapActivity).toMatchObject({
      after: firstHidden.cursor,
      cursor: thirdHidden.cursor,
      reason: "gap",
      freshness: "current",
    });
    expect(activities.filter((activity) => activity.kind === "incremental")).toHaveLength(1);
    expect(gapActivity.cursor).not.toBe(gapActivity.after);

    const recovered = peer.sync.apply(runtime.authority.createSyncPayload());

    expect(recovered).toMatchObject({
      mode: "total",
      cursor: thirdHidden.cursor,
      freshness: "current",
    });
    expect(peer.sync.getState()).toMatchObject({
      status: "ready",
      cursor: thirdHidden.cursor,
      completeness: "complete",
      freshness: "current",
    });
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
      {
        writeScope: "server-command",
      },
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
          writeScopes: [result.writeScope],
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
