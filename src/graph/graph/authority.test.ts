import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { kitchenSink } from "../schema/test";
import {
  createJsonPersistedAuthoritativeGraph,
  createPersistedAuthoritativeGraph,
  type PersistedAuthoritativeGraphState,
  type PersistedAuthoritativeGraphStorage,
  type PersistedAuthoritativeGraphStorageLoadResult,
} from "./authority";
import { bootstrap } from "./bootstrap";
import { createTypeClient } from "./client";
import { core } from "./core";
import { createIdMap, defineNamespace } from "./identity";
import { defineType, edgeId } from "./schema";
import { createStore } from "./store";
import {
  createAuthoritativeGraphWriteSession,
  createGraphWriteTransactionFromSnapshots,
  createTotalSyncPayload,
  validateAuthoritativeTotalSyncPayload,
  validateIncrementalSyncResult,
  type AuthoritativeGraphWriteResult,
  type GraphWriteTransaction,
} from "./sync";

const tempDirs: string[] = [];
let testCursorEpoch = 0;

const item = defineType({
  values: { key: "test:item", name: "Item" },
  fields: {
    ...core.node.fields,
  },
});

const testGraph = defineNamespace(createIdMap({ item }).map, { item });

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createTestCursorPrefix(): string {
  testCursorEpoch += 1;
  return `persisted:test:${testCursorEpoch}:`;
}

async function createTempSnapshotPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "io-graph-authority-"));
  tempDirs.push(dir);
  return join(dir, "graph.snapshot.json");
}

async function readPersistedAuthorityState(
  snapshotPath: string,
): Promise<PersistedAuthoritativeGraphState> {
  return JSON.parse(await readFile(snapshotPath, "utf8")) as PersistedAuthoritativeGraphState;
}

function createItemNameWriteTransaction(
  store: ReturnType<typeof createStore>,
  itemId: string,
  name: string,
  txId: string,
): GraphWriteTransaction {
  return {
    id: txId,
    ops: [
      ...store.facts(itemId, edgeId(testGraph.item.fields.name)).map((edge) => ({
        op: "retract" as const,
        edgeId: edge.id,
      })),
      {
        op: "assert" as const,
        edge: {
          id: store.newNode(),
          s: itemId,
          p: edgeId(testGraph.item.fields.name),
          o: name,
        },
      },
    ],
  };
}

async function createJsonAuthority(
  snapshotPath: string,
  options: {
    seedName?: string;
  } = {},
) {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, testGraph);

  return createJsonPersistedAuthoritativeGraph(store, testGraph, {
    path: snapshotPath,
    seed(graph) {
      if (!options.seedName) return;
      graph.item.create({ name: options.seedName });
    },
    createCursorPrefix: createTestCursorPrefix,
  });
}

function createMemoryStorage() {
  let current: PersistedAuthoritativeGraphState | null = null;
  let failNextWrite = false;

  function writeState(
    snapshot: PersistedAuthoritativeGraphState["snapshot"],
    writeHistory: PersistedAuthoritativeGraphState["writeHistory"],
  ): void {
    if (failNextWrite) {
      failNextWrite = false;
      throw new Error("persist failed");
    }
    current = {
      version: 1,
      snapshot: cloneJson(snapshot),
      writeHistory: cloneJson(writeHistory),
    };
  }

  const storage: PersistedAuthoritativeGraphStorage = {
    async load(): Promise<PersistedAuthoritativeGraphStorageLoadResult | null> {
      if (!current) return null;
      return {
        snapshot: cloneJson(current.snapshot),
        writeHistory: cloneJson(current.writeHistory),
        needsPersistence: false,
      };
    },
    async commit(input): Promise<void> {
      writeState(input.snapshot, input.writeHistory);
    },
    async persist(input): Promise<void> {
      writeState(input.snapshot, input.writeHistory);
    },
  };

  return {
    storage,
    getCurrent() {
      return current ? cloneJson(current) : null;
    },
    failOnNextWrite() {
      failNextWrite = true;
    },
  };
}

afterEach(async () => {
  testCursorEpoch = 0;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("persisted authoritative graph", () => {
  it("seeds and persists the snapshot with empty write history when no file exists", async () => {
    const snapshotPath = await createTempSnapshotPath();

    const authority = await createJsonAuthority(snapshotPath, { seedName: "Seeded Item" });
    const persistedState = await readPersistedAuthorityState(snapshotPath);
    const persistedFiles = await readdir(dirname(snapshotPath));
    const payload = authority.createSyncPayload();

    expect(authority.graph.item.list().map((entity) => entity.name)).toEqual(["Seeded Item"]);
    expect(persistedState.version).toBe(1);
    expect(persistedState.snapshot.edges.length).toBeGreaterThan(0);
    expect(persistedState.snapshot.retracted.length).toBeGreaterThanOrEqual(0);
    expect(persistedState.writeHistory.baseSequence).toBe(0);
    expect(persistedState.writeHistory.results).toEqual([]);
    expect(payload.cursor).toBe(`${persistedState.writeHistory.cursorPrefix}0`);
    expect(persistedFiles).toEqual(["graph.snapshot.json"]);
  });

  it("loads a legacy snapshot file, rewrites the persisted format, and preserves snapshot data", async () => {
    const snapshotPath = await createTempSnapshotPath();
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, testGraph);
    const graph = createTypeClient(store, testGraph);

    graph.item.create({ name: "Persisted Only Item" });
    await writeFile(snapshotPath, JSON.stringify(store.snapshot(), null, 2) + "\n", "utf8");

    const authority = await createJsonAuthority(snapshotPath);
    const persistedState = await readPersistedAuthorityState(snapshotPath);
    const restarted = await createJsonAuthority(snapshotPath);

    expect(authority.graph.item.list().map((entity) => entity.name)).toEqual([
      "Persisted Only Item",
    ]);
    expect(persistedState.version).toBe(1);
    expect(persistedState.writeHistory.results).toEqual([]);
    expect(restarted.createSyncPayload().cursor).toBe(authority.createSyncPayload().cursor);
  });

  it("persists accepted transactions in order and resumes cursor progression after restart", async () => {
    const snapshotPath = await createTempSnapshotPath();
    const authority = await createJsonAuthority(snapshotPath, { seedName: "Durable Item" });
    const itemId = authority.graph.item.list()[0]?.id;
    if (!itemId) throw new Error("Expected seeded item.");

    const initialCursor = authority.createSyncPayload().cursor;
    const first = await authority.applyTransaction(
      createItemNameWriteTransaction(authority.store, itemId, "Durable Item One", "tx:1"),
    );
    const persistedState = await readPersistedAuthorityState(snapshotPath);
    const restarted = await createJsonAuthority(snapshotPath);
    const restartedCursor = restarted.createSyncPayload().cursor;
    const second = await restarted.applyTransaction(
      createItemNameWriteTransaction(restarted.store, itemId, "Durable Item Two", "tx:2"),
    );

    expect(first).toMatchObject({
      txId: "tx:1",
      replayed: false,
      cursor: `${persistedState.writeHistory.cursorPrefix}1`,
    });
    expect(authority.getChangesAfter(initialCursor)).toEqual({
      kind: "changes",
      cursor: first.cursor,
      changes: [first],
    });
    expect(persistedState.writeHistory.results).toEqual([first]);
    expect(restartedCursor).toBe(first.cursor);
    expect(restarted.getChangesAfter(initialCursor)).toEqual({
      kind: "changes",
      cursor: second.cursor,
      changes: [first, second],
    });
    expect(restarted.getIncrementalSyncResult(initialCursor)).toEqual({
      mode: "incremental",
      scope: { kind: "graph" },
      after: initialCursor,
      transactions: [first, second],
      cursor: second.cursor,
      completeness: "complete",
      freshness: "current",
    });
    expect(second).toMatchObject({
      txId: "tx:2",
      replayed: false,
      cursor: `${persistedState.writeHistory.cursorPrefix}2`,
    });
    expect(restarted.getChangesAfter(first.cursor)).toEqual({
      kind: "changes",
      cursor: second.cursor,
      changes: [second],
    });
    expect(restarted.graph.item.get(itemId).name).toBe("Durable Item Two");
  });

  it("prunes retained history and falls back for cursors older than the retained window", async () => {
    const retainedStorage = createMemoryStorage();
    const createRetainedAuthority = async () => {
      const store = createStore();
      bootstrap(store, core);
      bootstrap(store, testGraph);

      return createPersistedAuthoritativeGraph(store, testGraph, {
        storage: retainedStorage.storage,
        seed(graph) {
          graph.item.create({ name: "Retained Item" });
        },
        createCursorPrefix: () => "persisted:retained:",
        maxRetainedTransactions: 2,
      });
    };

    const authority = await createRetainedAuthority();
    const itemId = authority.graph.item.list()[0]?.id;
    if (!itemId) throw new Error("Expected retained item.");

    const initialCursor = authority.createSyncPayload().cursor;
    const first = await authority.applyTransaction(
      createItemNameWriteTransaction(authority.store, itemId, "Retained Item One", "tx:retain:1"),
    );
    const second = await authority.applyTransaction(
      createItemNameWriteTransaction(authority.store, itemId, "Retained Item Two", "tx:retain:2"),
    );
    const third = await authority.applyTransaction(
      createItemNameWriteTransaction(authority.store, itemId, "Retained Item Three", "tx:retain:3"),
    );
    const persistedState = retainedStorage.getCurrent();
    const restarted = await createRetainedAuthority();

    if (!persistedState) throw new Error("Expected retained persisted state.");

    expect(persistedState.writeHistory.baseSequence).toBe(1);
    expect(persistedState.writeHistory.results).toEqual([second, third]);
    expect(authority.getIncrementalSyncResult(initialCursor)).toEqual({
      mode: "incremental",
      scope: { kind: "graph" },
      after: initialCursor,
      transactions: [],
      cursor: third.cursor,
      completeness: "complete",
      freshness: "current",
      fallback: "gap",
    });
    expect(authority.getIncrementalSyncResult(first.cursor)).toEqual({
      mode: "incremental",
      scope: { kind: "graph" },
      after: first.cursor,
      transactions: [second, third],
      cursor: third.cursor,
      completeness: "complete",
      freshness: "current",
    });
    expect(restarted.getIncrementalSyncResult(initialCursor)).toEqual({
      mode: "incremental",
      scope: { kind: "graph" },
      after: initialCursor,
      transactions: [],
      cursor: third.cursor,
      completeness: "complete",
      freshness: "current",
      fallback: "gap",
    });
    expect(restarted.getIncrementalSyncResult(first.cursor)).toEqual({
      mode: "incremental",
      scope: { kind: "graph" },
      after: first.cursor,
      transactions: [second, third],
      cursor: third.cursor,
      completeness: "complete",
      freshness: "current",
    });
  });

  it("commits accepted transactions incrementally and reserves persist for snapshot baselines", async () => {
    let commitCount = 0;
    let persistCount = 0;
    let committedTxId: string | null = null;
    let current: PersistedAuthoritativeGraphState | null = null;

    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, testGraph);
    const authority = await createPersistedAuthoritativeGraph(store, testGraph, {
      storage: {
        async load() {
          return current
            ? {
                snapshot: cloneJson(current.snapshot),
                writeHistory: cloneJson(current.writeHistory),
                needsPersistence: false,
              }
            : null;
        },
        async commit(input) {
          commitCount += 1;
          committedTxId = input.result.txId;
          current = {
            version: 1,
            snapshot: cloneJson(input.snapshot),
            writeHistory: cloneJson(input.writeHistory),
          };
        },
        async persist(input) {
          persistCount += 1;
          current = {
            version: 1,
            snapshot: cloneJson(input.snapshot),
            writeHistory: cloneJson(input.writeHistory),
          };
        },
      },
      seed(graph) {
        graph.item.create({ name: "Boundary Item" });
      },
      createCursorPrefix: createTestCursorPrefix,
    });
    const itemId = authority.graph.item.list()[0]?.id;
    if (!itemId) throw new Error("Expected seeded item.");

    expect(commitCount).toBe(0);
    expect(persistCount).toBe(1);

    await authority.applyTransaction(
      createItemNameWriteTransaction(authority.store, itemId, "Boundary Item Updated", "tx:1"),
    );

    expect(commitCount).toBe(1);
    expect(persistCount).toBe(1);
    expect(committedTxId === "tx:1").toBe(true);

    await authority.persist();

    expect(commitCount).toBe(1);
    expect(persistCount).toBe(2);
  });

  it("falls back to a reset when persisted write history cannot be replayed", async () => {
    const snapshotPath = await createTempSnapshotPath();
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, testGraph);
    const graph = createTypeClient(store, testGraph);

    const itemId = graph.item.create({ name: "Broken History Item" });
    const brokenResult: AuthoritativeGraphWriteResult = {
      txId: "tx:1",
      cursor: "persisted:broken:2",
      replayed: false,
      transaction: createItemNameWriteTransaction(store, itemId, "Broken History Item Two", "tx:1"),
    };

    await writeFile(
      snapshotPath,
      JSON.stringify(
        {
          version: 1,
          snapshot: store.snapshot(),
          writeHistory: {
            cursorPrefix: "persisted:broken:",
            baseSequence: 0,
            results: [brokenResult],
          },
        } satisfies PersistedAuthoritativeGraphState,
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const authority = await createJsonAuthority(snapshotPath);
    const rewrittenState = await readPersistedAuthorityState(snapshotPath);
    const payload = authority.createSyncPayload();

    expect(authority.graph.item.list().map((entity) => entity.name)).toEqual([
      "Broken History Item",
    ]);
    expect(payload.cursor).toBe(`${rewrittenState.writeHistory.cursorPrefix}0`);
    expect(payload.cursor).not.toBe("persisted:broken:0");
    expect(authority.getChangesAfter("persisted:broken:2")).toEqual({
      kind: "reset",
      cursor: payload.cursor,
      changes: [],
    });
    expect(rewrittenState.writeHistory.results).toEqual([]);
  });

  it("filters authority-only predicates from total sync snapshots", () => {
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, kitchenSink);
    const graph = createTypeClient(store, kitchenSink);

    const secretId = graph.secret.create({
      name: "Primary API secret",
      version: 1,
      fingerprint: "fp-1",
    });
    const personId = graph.person.create({
      name: "Ada Lovelace",
      status: kitchenSink.status.values.inReview.id,
      confidentialNotes: "Authority-only notes",
    });
    const payload = createTotalSyncPayload(store, {
      cursor: "server:1",
      namespace: kitchenSink,
    });

    expect(validateAuthoritativeTotalSyncPayload(payload, kitchenSink).ok).toBe(true);
    expect(
      payload.snapshot.edges.some(
        (edge) => edge.s === secretId && edge.p === edgeId(kitchenSink.secret.fields.fingerprint),
      ),
    ).toBe(false);
    expect(
      payload.snapshot.edges.some(
        (edge) =>
          edge.s === personId && edge.p === edgeId(kitchenSink.person.fields.confidentialNotes),
      ),
    ).toBe(false);
    expect(
      payload.snapshot.edges.some(
        (edge) => edge.s === secretId && edge.p === edgeId(kitchenSink.secret.fields.version),
      ),
    ).toBe(true);
  });

  it("omits hidden-only incremental writes while still advancing the cursor", () => {
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, kitchenSink);
    const graph = createTypeClient(store, kitchenSink);

    const secretId = graph.secret.create({
      name: "Primary API secret",
      version: 1,
    });
    const before = store.snapshot();
    store.assert(secretId, edgeId(kitchenSink.secret.fields.fingerprint), "fp-1");
    const hiddenWrite = createGraphWriteTransactionFromSnapshots(
      before,
      store.snapshot(),
      "tx:hidden",
    );
    const session = createAuthoritativeGraphWriteSession(store, kitchenSink, {
      cursorPrefix: "server:hidden:",
      history: [
        {
          txId: "tx:hidden",
          cursor: "server:hidden:1",
          replayed: false,
          transaction: hiddenWrite,
        },
      ],
    });
    const result = session.getIncrementalSyncResult(session.getBaseCursor());

    expect(validateIncrementalSyncResult(result).ok).toBe(true);
    if ("fallback" in result) throw new Error("Expected an incremental payload.");
    expect(result.transactions).toEqual([]);
    expect(result.cursor).toBe("server:hidden:1");
  });

  it("keeps visible incremental writes even when hidden writes are skipped", () => {
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, kitchenSink);
    const graph = createTypeClient(store, kitchenSink);

    const secretId = graph.secret.create({
      name: "Primary API secret",
      version: 1,
    });
    const beforeHidden = store.snapshot();
    store.assert(secretId, edgeId(kitchenSink.secret.fields.fingerprint), "fp-1");
    const hiddenWrite = createGraphWriteTransactionFromSnapshots(
      beforeHidden,
      store.snapshot(),
      "tx:hidden",
    );
    const beforeVisible = store.snapshot();
    const versionEdge = store.facts(secretId, edgeId(kitchenSink.secret.fields.version))[0];
    if (!versionEdge) throw new Error("Expected the secret version edge to exist.");
    store.batch(() => {
      store.retract(versionEdge.id);
      store.assert(secretId, edgeId(kitchenSink.secret.fields.version), "2");
    });
    const visibleWrite = createGraphWriteTransactionFromSnapshots(
      beforeVisible,
      store.snapshot(),
      "tx:visible",
    );
    const session = createAuthoritativeGraphWriteSession(store, kitchenSink, {
      cursorPrefix: "server:mixed:",
      history: [
        {
          txId: "tx:hidden",
          cursor: "server:mixed:1",
          replayed: false,
          transaction: hiddenWrite,
        },
        {
          txId: "tx:visible",
          cursor: "server:mixed:2",
          replayed: false,
          transaction: visibleWrite,
        },
      ],
    });
    const result = session.getIncrementalSyncResult(session.getBaseCursor());

    expect(validateIncrementalSyncResult(result).ok).toBe(true);
    if ("fallback" in result) throw new Error("Expected an incremental payload.");
    expect(result.cursor).toBe("server:mixed:2");
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]?.txId).toBe("tx:visible");
    expect(result.transactions[0]?.cursor).toBe("server:mixed:2");
    expect(
      result.transactions[0]?.transaction.ops.some(
        (operation) =>
          operation.op === "assert" &&
          operation.edge.p === edgeId(kitchenSink.secret.fields.fingerprint),
      ),
    ).toBe(false);
  });

  it("rolls back the in-memory authority when persisting an accepted transaction fails", async () => {
    const storage = createMemoryStorage();
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, testGraph);
    const authority = await createPersistedAuthoritativeGraph(store, testGraph, {
      storage: storage.storage,
      seed(graph) {
        graph.item.create({ name: "Rollback Item" });
      },
      createCursorPrefix: createTestCursorPrefix,
    });
    const itemId = authority.graph.item.list()[0]?.id;
    if (!itemId) throw new Error("Expected seeded item.");

    const previousPersistedState = storage.getCurrent();
    const previousCursor = authority.createSyncPayload().cursor;
    storage.failOnNextWrite();

    await expect(
      authority.applyTransaction(
        createItemNameWriteTransaction(authority.store, itemId, "Rollback Failed", "tx:1"),
      ),
    ).rejects.toThrow("persist failed");

    expect(storage.getCurrent()).toEqual(previousPersistedState);
    expect(authority.createSyncPayload().cursor).toBe(previousCursor);
    expect(authority.graph.item.get(itemId).name).toBe("Rollback Item");
    expect(authority.getChangesAfter(previousCursor)).toEqual({
      kind: "changes",
      cursor: previousCursor,
      changes: [],
    });
  });

  it("rolls back the reset cursor change when snapshot persistence fails", async () => {
    const storage = createMemoryStorage();
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, testGraph);
    const authority = await createPersistedAuthoritativeGraph(store, testGraph, {
      storage: storage.storage,
      seed(graph) {
        graph.item.create({ name: "Reset Item" });
      },
      createCursorPrefix: createTestCursorPrefix,
    });
    const itemId = authority.graph.item.list()[0]?.id;
    if (!itemId) throw new Error("Expected seeded item.");

    authority.graph.item.update(itemId, { name: "Reset Item Updated" });
    const previousPersistedState = storage.getCurrent();
    const previousCursor = authority.createSyncPayload().cursor;
    storage.failOnNextWrite();

    await expect(authority.persist()).rejects.toThrow("persist failed");

    expect(storage.getCurrent()).toEqual(previousPersistedState);
    expect(authority.createSyncPayload().cursor).toBe(previousCursor);
    expect(authority.graph.item.get(itemId).name).toBe("Reset Item Updated");
    expect(authority.getChangesAfter(previousCursor)).toEqual({
      kind: "changes",
      cursor: previousCursor,
      changes: [],
    });
  });
});
