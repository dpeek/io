import { describe, expect, it } from "bun:test";

import {
  canonicalizeGraphWriteTransaction,
  createGraphWriteOperationsFromSnapshots,
  createGraphStore,
  createGraphWriteTransactionFromSnapshots,
} from "@io/graph-kernel";

import {
  applyGraphWriteTransaction,
  materializeGraphWriteTransactionSnapshot,
  prepareGraphWriteTransaction,
} from "./transactions";

describe("graph write transactions", () => {
  it("derives canonical operations and transactions from snapshot changes", () => {
    const before = {
      edges: [
        {
          id: "edge:existing",
          s: "node:existing",
          p: "predicate:existing",
          o: "value:existing",
        },
      ],
      retracted: ["edge:2"],
    };
    const after = {
      edges: [
        {
          id: "edge:z",
          s: "node:z",
          p: "predicate:z",
          o: "value:z",
        },
        {
          id: "edge:existing",
          s: "node:existing",
          p: "predicate:existing",
          o: "value:existing",
        },
        {
          id: "edge:a",
          s: "node:a",
          p: "predicate:a",
          o: "value:a",
        },
      ],
      retracted: ["edge:3", "edge:1", "edge:2"],
    };

    const ops = createGraphWriteOperationsFromSnapshots(before, after);
    const transaction = createGraphWriteTransactionFromSnapshots(before, after, "tx:derived");

    expect(ops).toEqual([
      {
        op: "retract",
        edgeId: "edge:1",
      },
      {
        op: "retract",
        edgeId: "edge:3",
      },
      {
        op: "assert",
        edge: {
          id: "edge:a",
          s: "node:a",
          p: "predicate:a",
          o: "value:a",
        },
      },
      {
        op: "assert",
        edge: {
          id: "edge:z",
          s: "node:z",
          p: "predicate:z",
          o: "value:z",
        },
      },
    ]);
    expect(transaction).toEqual({
      id: "tx:derived",
      ops,
    });
  });

  it("canonicalizes duplicate operations into a stable order", () => {
    const transaction = canonicalizeGraphWriteTransaction({
      id: "tx:1",
      ops: [
        { op: "retract", edgeId: "edge:b" },
        {
          op: "assert",
          edge: { id: "edge:2", s: "n:2", p: "p:type", o: "t:task" },
        },
        { op: "retract", edgeId: "edge:a" },
        { op: "retract", edgeId: "edge:b" },
        {
          op: "assert",
          edge: { id: "edge:1", s: "n:1", p: "p:type", o: "t:task" },
        },
        {
          op: "assert",
          edge: { id: "edge:1", s: "n:1", p: "p:type", o: "t:task" },
        },
      ],
    });

    expect(transaction).toEqual({
      id: "tx:1",
      ops: [
        { op: "retract", edgeId: "edge:a" },
        { op: "retract", edgeId: "edge:b" },
        {
          op: "assert",
          edge: { id: "edge:1", s: "n:1", p: "p:type", o: "t:task" },
        },
        {
          op: "assert",
          edge: { id: "edge:2", s: "n:2", p: "p:type", o: "t:task" },
        },
      ],
    });
  });

  it("surfaces materialization failures when a retract references a missing edge", () => {
    const store = createGraphStore();

    const result = materializeGraphWriteTransactionSnapshot(store, {
      id: "tx:1",
      ops: [{ op: "retract", edgeId: "edge:missing" }],
    });

    expect(result).toMatchObject({
      ok: false,
    });
    if (result.ok) throw new Error("Expected missing retract edges to fail materialization.");
    expect(result.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "sync.tx.op.retract.missing",
        }),
      ]),
    );
  });

  it("applies valid transactions by replacing the target store snapshot", () => {
    const store = createGraphStore();
    store.assertEdge({ id: "edge:old", s: "n:1", p: "p:name", o: "Old" });

    applyGraphWriteTransaction(store, {
      id: "tx:1",
      ops: [
        { op: "retract", edgeId: "edge:old" },
        {
          op: "assert",
          edge: { id: "edge:new", s: "n:1", p: "p:name", o: "New" },
        },
      ],
    });

    expect(store.facts("n:1", "p:name")).toEqual([
      {
        id: "edge:new",
        s: "n:1",
        p: "p:name",
        o: "New",
      },
    ]);
    expect(store.snapshot().retracted).toContain("edge:old");
  });

  it("validates basic transaction shape before canonicalization", () => {
    const result = prepareGraphWriteTransaction({
      id: "",
      ops: [],
    });

    expect(result).toMatchObject({
      ok: false,
    });
    if (result.ok) throw new Error("Expected an empty transaction to fail validation.");
    expect(result.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "sync.tx.id.empty",
        }),
        expect.objectContaining({
          code: "sync.tx.ops.empty",
        }),
      ]),
    );
  });
});
