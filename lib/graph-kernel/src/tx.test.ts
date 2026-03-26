import { describe, expect, it } from "bun:test";

import {
  canonicalizeGraphWriteTransaction,
  cloneAuthoritativeGraphRetainedHistoryPolicy,
  cloneAuthoritativeGraphWriteResult,
  cloneGraphWriteOperation,
  cloneGraphWriteTransaction,
  createGraphWriteOperationsFromSnapshots,
  createGraphWriteTransactionFromSnapshots,
  graphWriteScopes,
  isAuthoritativeGraphRetainedHistoryPolicy,
  isGraphWriteScope,
  sameAuthoritativeGraphRetainedHistoryPolicy,
  sameGraphWriteTransaction,
  unboundedAuthoritativeGraphRetainedHistoryPolicy,
} from "./tx.js";
import type { GraphWriteTransaction } from "./tx.js";

describe("authoritative write contracts", () => {
  it("publishes stable retained-history and write-scope helpers", () => {
    expect(unboundedAuthoritativeGraphRetainedHistoryPolicy).toEqual({ kind: "all" });
    expect(cloneAuthoritativeGraphRetainedHistoryPolicy({ kind: "all" })).toBe(
      unboundedAuthoritativeGraphRetainedHistoryPolicy,
    );
    expect(
      cloneAuthoritativeGraphRetainedHistoryPolicy({
        kind: "transaction-count",
        maxTransactions: 5,
      }),
    ).toEqual({
      kind: "transaction-count",
      maxTransactions: 5,
    });
    expect(
      sameAuthoritativeGraphRetainedHistoryPolicy(
        { kind: "transaction-count", maxTransactions: 5 },
        { kind: "transaction-count", maxTransactions: 5 },
      ),
    ).toBe(true);
    expect(
      sameAuthoritativeGraphRetainedHistoryPolicy(
        { kind: "all" },
        { kind: "transaction-count", maxTransactions: 5 },
      ),
    ).toBe(false);
    expect(isAuthoritativeGraphRetainedHistoryPolicy({ kind: "all" })).toBe(true);
    expect(
      isAuthoritativeGraphRetainedHistoryPolicy({
        kind: "transaction-count",
        maxTransactions: 0,
      }),
    ).toBe(false);

    expect(graphWriteScopes).toEqual(["client-tx", "server-command", "authority-only"]);
    expect(isGraphWriteScope("server-command")).toBe(true);
    expect(isGraphWriteScope("replicated")).toBe(false);
  });

  it("clones and normalizes write operations, transactions, and results", () => {
    expect(cloneGraphWriteOperation({ op: "retract", edgeId: "edge:1" })).toEqual({
      op: "retract",
      edgeId: "edge:1",
    });
    expect(
      cloneGraphWriteOperation({ op: "assert", edge: { id: "e1", s: "s1", p: "p1" } }),
    ).toEqual({
      op: "assert",
      edge: { id: "e1", s: "s1", p: "p1", o: "" },
    });

    const transaction = cloneGraphWriteTransaction({
      id: "tx:1",
      ops: [{ op: "retract", edgeId: "edge:1" }],
    });
    const result = cloneAuthoritativeGraphWriteResult(
      {
        txId: "tx:1",
        cursor: "server:1",
        replayed: false,
        writeScope: "client-tx",
        transaction,
      },
      { replayed: true },
    );

    expect(transaction).toEqual({
      id: "tx:1",
      ops: [{ op: "retract", edgeId: "edge:1" }],
    });
    expect(result).toEqual({
      txId: "tx:1",
      cursor: "server:1",
      replayed: true,
      writeScope: "client-tx",
      transaction: {
        id: "tx:1",
        ops: [{ op: "retract", edgeId: "edge:1" }],
      },
    });
    expect(result.transaction).not.toBe(transaction);
    expect(result.transaction.ops).not.toBe(transaction.ops);
  });

  it("canonicalizes and compares write transactions deterministically", () => {
    const left = canonicalizeGraphWriteTransaction({
      id: "tx:1",
      ops: [
        { op: "assert", edge: { id: "edge:2", s: "node:a", p: "pred:name", o: "Ada" } },
        { op: "retract", edgeId: "edge:3" },
        { op: "retract", edgeId: "edge:3" },
        { op: "assert", edge: { id: "edge:1", s: "node:a", p: "pred:name", o: "Ada" } },
        { op: "assert", edge: { id: "edge:1", s: "node:a", p: "pred:name", o: "Ada" } },
      ],
    });
    const right: GraphWriteTransaction = {
      id: "tx:1",
      ops: [
        { op: "retract", edgeId: "edge:3" },
        { op: "assert", edge: { id: "edge:1", s: "node:a", p: "pred:name", o: "Ada" } },
        { op: "assert", edge: { id: "edge:2", s: "node:a", p: "pred:name", o: "Ada" } },
      ],
    };

    expect(left).toEqual(right);
    expect(sameGraphWriteTransaction(left, right)).toBe(true);
    expect(
      sameGraphWriteTransaction(left, {
        ...right,
        ops: [...right.ops].reverse(),
      }),
    ).toBe(false);
  });

  it("derives canonical write operations and transactions from snapshots", () => {
    const before = {
      edges: [{ id: "edge:1", s: "node:a", p: "pred:name", o: "Ada" }],
      retracted: [],
    } as const;
    const after = {
      edges: [
        { id: "edge:1", s: "node:a", p: "pred:name", o: "Ada" },
        { id: "edge:2", s: "node:a", p: "pred:role", o: "Engineer" },
      ],
      retracted: ["edge:1"],
    } as const;

    expect(createGraphWriteOperationsFromSnapshots(before, after)).toEqual([
      { op: "retract", edgeId: "edge:1" },
      {
        op: "assert",
        edge: { id: "edge:2", s: "node:a", p: "pred:role", o: "Engineer" },
      },
    ]);
    expect(createGraphWriteTransactionFromSnapshots(before, after, "tx:derived")).toEqual({
      id: "tx:derived",
      ops: [
        { op: "retract", edgeId: "edge:1" },
        {
          op: "assert",
          edge: { id: "edge:2", s: "node:a", p: "pred:role", o: "Engineer" },
        },
      ],
    });
  });
});
