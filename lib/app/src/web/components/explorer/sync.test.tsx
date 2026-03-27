import { describe, expect, it } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import type { ExplorerSync } from "./model.js";
import { ExplorerSyncInspector } from "./sync-inspector.js";
import {
  formatRetainedHistoryPolicy,
  formatStreamActivityDetail,
  formatStreamActivityTitle,
} from "./sync.js";

type ExplorerStreamActivity = ReturnType<ExplorerSync["getState"]>["recentActivities"][number];

function createSyncFixture(
  recentActivities: readonly ExplorerStreamActivity[],
  diagnostics?: ReturnType<ExplorerSync["getState"]>["diagnostics"],
): ExplorerSync {
  const state: ReturnType<ExplorerSync["getState"]> = {
    mode: "total",
    requestedScope: { kind: "graph" },
    scope: { kind: "graph" },
    status: "ready",
    completeness: "complete",
    freshness: "current",
    pendingCount: 0,
    recentActivities,
    cursor: "example:2",
    lastSyncedAt: new Date("2026-03-22T00:00:00.000Z"),
    diagnostics,
  };

  return {
    getPendingTransactions: () => [],
    getState: () => state,
    subscribe: () => () => {},
  } as unknown as ExplorerSync;
}

describe("explorer sync inspector", () => {
  it("formats direct write activity details with authoritative write scope", () => {
    const activity: ExplorerStreamActivity = {
      kind: "write",
      txId: "tx:write:1",
      cursor: "example:1",
      freshness: "current",
      replayed: false,
      writeScope: "client-tx",
      at: new Date("2026-03-22T00:00:00.000Z"),
    };

    expect(formatStreamActivityDetail(activity)).toBe("scope client-tx; cursor example:1");
  });

  it("formats incremental activity details with mixed write scope summaries", () => {
    const activity: ExplorerStreamActivity = {
      kind: "incremental",
      after: "example:1",
      cursor: "example:3",
      freshness: "current",
      transactionCount: 2,
      txIds: ["tx:batch:1", "tx:batch:2"],
      writeScopes: ["server-command", "client-tx"],
      at: new Date("2026-03-22T00:00:00.000Z"),
    };

    expect(formatStreamActivityDetail(activity)).toBe(
      "after example:1 -> example:3; mixed scopes: server-command, client-tx",
    );
  });

  it("formats zero-transaction incremental cursor advances without treating them as head polls", () => {
    const activity: ExplorerStreamActivity = {
      kind: "incremental",
      after: "example:1",
      cursor: "example:2",
      freshness: "current",
      transactionCount: 0,
      txIds: [],
      writeScopes: [],
      at: new Date("2026-03-22T00:00:00.000Z"),
    };

    expect(formatStreamActivityTitle(activity)).toBe(
      "Incremental cursor advanced without replicated writes",
    );
    expect(formatStreamActivityDetail(activity)).toBe("after example:1 -> example:2");
  });

  it("keeps zero-transaction head polls labeled as head confirmation", () => {
    const activity: ExplorerStreamActivity = {
      kind: "incremental",
      after: "example:2",
      cursor: "example:2",
      freshness: "current",
      transactionCount: 0,
      txIds: [],
      writeScopes: [],
      at: new Date("2026-03-22T00:00:00.000Z"),
    };

    expect(formatStreamActivityTitle(activity)).toBe("Incremental poll confirmed head cursor");
    expect(formatStreamActivityDetail(activity)).toBe("after example:2 -> example:2");
  });

  it("renders scoped write activity badges for direct and incremental activity", () => {
    const html = renderToStaticMarkup(
      <ExplorerSyncInspector
        sync={createSyncFixture([
          {
            kind: "write",
            txId: "tx:write:1",
            cursor: "example:1",
            freshness: "current",
            replayed: false,
            writeScope: "client-tx",
            at: new Date("2026-03-22T00:00:00.000Z"),
          },
          {
            kind: "incremental",
            after: "example:1",
            cursor: "example:2",
            freshness: "current",
            transactionCount: 2,
            txIds: ["tx:batch:1", "tx:batch:2"],
            writeScopes: ["server-command", "client-tx"],
            at: new Date("2026-03-22T00:00:01.000Z"),
          },
        ])}
      />,
    );

    expect(html).toContain("tx:write:1 (client-tx)");
    expect(html).toContain("tx:batch:1 (server-command)");
    expect(html).toContain("tx:batch:2 (client-tx)");
  });

  it("renders distinct zero-transaction incremental diagnostics for head polls and cursor advances", () => {
    const html = renderToStaticMarkup(
      <ExplorerSyncInspector
        sync={createSyncFixture([
          {
            kind: "incremental",
            after: "example:1",
            cursor: "example:2",
            freshness: "current",
            transactionCount: 0,
            txIds: [],
            writeScopes: [],
            at: new Date("2026-03-22T00:00:00.000Z"),
          },
          {
            kind: "incremental",
            after: "example:2",
            cursor: "example:2",
            freshness: "current",
            transactionCount: 0,
            txIds: [],
            writeScopes: [],
            at: new Date("2026-03-22T00:00:01.000Z"),
          },
        ])}
      />,
    );

    expect(html).toContain("Incremental cursor advanced without replicated writes");
    expect(html).toContain("after example:1 -&gt; example:2");
    expect(html).toContain("Incremental poll confirmed head cursor");
    expect(html).toContain("after example:2 -&gt; example:2");
  });

  it("formats retained-history policies for operator-facing diagnostics", () => {
    expect(formatRetainedHistoryPolicy({ kind: "all" })).toBe("all transactions");
    expect(
      formatRetainedHistoryPolicy({
        kind: "transaction-count",
        maxTransactions: 2,
      }),
    ).toBe("last 2 transactions");
  });

  it("renders retained cursor and retention diagnostics when the authority exposes them", () => {
    const html = renderToStaticMarkup(
      <ExplorerSyncInspector
        sync={createSyncFixture([], {
          retainedBaseCursor: "example:1",
          retainedHistoryPolicy: {
            kind: "transaction-count",
            maxTransactions: 2,
          },
        })}
      />,
    );

    expect(html).toContain("Retained base");
    expect(html).toContain("example:1");
    expect(html).toContain("Retention");
    expect(html).toContain("last 2 transactions");
  });
});
