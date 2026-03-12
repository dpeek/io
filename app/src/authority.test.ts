import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { app } from "./graph/app.js";
import { bootstrap } from "./graph/bootstrap.js";
import { createTypeClient } from "./graph/client.js";
import { core } from "./graph/core.js";
import { edgeId } from "./graph/schema.js";
import {
  type AuthoritativeGraphWriteHistory,
  type AuthoritativeGraphWriteResult,
  type GraphWriteTransaction,
  validateAuthoritativeTotalSyncPayload,
  type TotalSyncPayload,
} from "./graph/sync.js";
import { createStore, type StoreSnapshot } from "./graph/store.js";
import { createAppAuthority } from "./authority.js";
import { handleSyncRequest } from "./server-app.js";

const tempDirs: string[] = [];

type PersistedAuthorityState = {
  readonly version: 1;
  readonly snapshot: StoreSnapshot;
  readonly writeHistory: AuthoritativeGraphWriteHistory;
};

async function createTempSnapshotPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "io-app-authority-"));
  tempDirs.push(dir);
  return join(dir, "graph.snapshot.json");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

async function readPersistedAuthorityState(snapshotPath: string): Promise<PersistedAuthorityState> {
  return JSON.parse(await readFile(snapshotPath, "utf8")) as PersistedAuthorityState;
}

function createCompanyNameWriteTransaction(
  store: ReturnType<typeof createStore>,
  companyId: string,
  name: string,
  txId: string,
): GraphWriteTransaction {
  return {
    id: txId,
    ops: [
      ...store.facts(companyId, edgeId(app.company.fields.name)).map((edge) => ({
        op: "retract" as const,
        edgeId: edge.id,
      })),
      {
        op: "assert" as const,
        edge: {
          id: store.newNode(),
          s: companyId,
          p: edgeId(app.company.fields.name),
          o: name,
        },
      },
    ],
  };
}

describe("app authority", () => {
  it("seeds and persists the authority snapshot and empty write history when no snapshot file exists", async () => {
    const snapshotPath = await createTempSnapshotPath();

    const authority = await createAppAuthority({ snapshotPath });
    const persistedState = await readPersistedAuthorityState(snapshotPath);
    const persistedFiles = await readdir(join(snapshotPath, ".."));
    const payload = authority.createSyncPayload();

    expect(authority.graph.company.list().map((company) => company.name)).toEqual([
      "Acme Corp",
      "Estii",
      "Atlas Labs",
    ]);
    expect(authority.graph.person.list().map((person) => person.name)).toEqual(["Alice"]);
    expect(authority.graph.block.list().map((block) => block.text)).toEqual(["Untitled"]);
    expect(persistedState.version).toBe(1);
    expect(persistedState.snapshot.edges.length).toBeGreaterThan(0);
    expect(persistedState.snapshot.retracted.length).toBeGreaterThanOrEqual(0);
    expect(persistedState.writeHistory.baseSequence).toBe(0);
    expect(persistedState.writeHistory.results).toEqual([]);
    expect(payload.cursor).toBe(`${persistedState.writeHistory.cursorPrefix}0`);
    expect(persistedFiles).toEqual(["graph.snapshot.json"]);
  });

  it("loads a legacy snapshot file, rewrites it with a reset history, and preserves the snapshot data", async () => {
    const snapshotPath = await createTempSnapshotPath();
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, app);
    const graph = createTypeClient(store, app);

    graph.company.create({
      name: "Persisted Only Co",
      status: app.status.values.active.id,
      website: new URL("https://persisted-only.example"),
    });

    await writeFile(snapshotPath, JSON.stringify(store.snapshot(), null, 2) + "\n", "utf8");

    const authority = await createAppAuthority({ snapshotPath });
    const persistedState = await readPersistedAuthorityState(snapshotPath);
    const restarted = await createAppAuthority({ snapshotPath });

    expect(authority.graph.company.list().map((company) => company.name)).toEqual([
      "Persisted Only Co",
    ]);
    expect(authority.graph.person.list()).toEqual([]);
    expect(authority.graph.block.list()).toEqual([]);
    expect(persistedState.version).toBe(1);
    expect(persistedState.writeHistory.results).toEqual([]);
    expect(restarted.createSyncPayload().cursor).toBe(authority.createSyncPayload().cursor);
  });

  it("persists accepted authoritative transactions in order and resumes cursor progression after restart", async () => {
    const snapshotPath = await createTempSnapshotPath();
    const authority = await createAppAuthority({ snapshotPath });
    const companyId = authority.graph.company.list()[0]?.id;
    if (!companyId) throw new Error("Expected seeded authority company.");

    const initialCursor = authority.createSyncPayload().cursor;
    const first = await authority.applyTransaction(
      createCompanyNameWriteTransaction(authority.store, companyId, "Acme Durable", "tx:1"),
    );
    const persistedState = await readPersistedAuthorityState(snapshotPath);
    const restarted = await createAppAuthority({ snapshotPath });
    const restartedCursor = restarted.createSyncPayload().cursor;
    const second = await restarted.applyTransaction(
      createCompanyNameWriteTransaction(restarted.store, companyId, "Acme Durable Two", "tx:2"),
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
    expect(restarted.getIncrementalSyncResult(first.cursor)).toEqual({
      mode: "incremental",
      scope: { kind: "graph" },
      after: first.cursor,
      transactions: [second],
      cursor: second.cursor,
      completeness: "complete",
      freshness: "current",
    });
    expect(restarted.graph.company.get(companyId).name).toBe("Acme Durable Two");
  });

  it("uses snapshot persistence as the reset path when direct authority mutations bypass transaction history", async () => {
    const snapshotPath = await createTempSnapshotPath();
    const authority = await createAppAuthority({ snapshotPath });
    const companyId = authority.graph.company.list()[0]?.id;
    if (!companyId) throw new Error("Expected seeded authority company.");

    const first = await authority.applyTransaction(
      createCompanyNameWriteTransaction(authority.store, companyId, "Acme History", "tx:1"),
    );

    authority.graph.company.update(companyId, {
      name: "Acme Snapshot Reset",
    });
    await authority.persist();
    const resetCursor = authority.createSyncPayload().cursor;
    const restarted = await createAppAuthority({ snapshotPath });

    expect(resetCursor).not.toBe(first.cursor);
    expect(authority.getChangesAfter(first.cursor)).toEqual({
      kind: "reset",
      cursor: resetCursor,
      changes: [],
    });
    expect(authority.getIncrementalSyncResult(first.cursor)).toEqual({
      mode: "incremental",
      scope: { kind: "graph" },
      after: first.cursor,
      transactions: [],
      cursor: resetCursor,
      completeness: "complete",
      freshness: "current",
      fallback: "reset",
    });
    expect(restarted.createSyncPayload().cursor).toBe(resetCursor);
    expect(restarted.graph.company.get(companyId).name).toBe("Acme Snapshot Reset");
  });

  it("falls back to snapshot reset when persisted write history is invalid", async () => {
    const snapshotPath = await createTempSnapshotPath();
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, app);
    const graph = createTypeClient(store, app);

    const companyId = graph.company.create({
      name: "Broken History Co",
      status: app.status.values.active.id,
      website: new URL("https://broken-history.example"),
    });
    const brokenResult: AuthoritativeGraphWriteResult = {
      txId: "tx:1",
      cursor: "authority:broken:2",
      replayed: false,
      transaction: createCompanyNameWriteTransaction(store, companyId, "Broken History Co 2", "tx:1"),
    };

    await writeFile(
      snapshotPath,
      JSON.stringify(
        {
          version: 1,
          snapshot: store.snapshot(),
          writeHistory: {
            cursorPrefix: "authority:broken:",
            baseSequence: 0,
            results: [brokenResult],
          },
        } satisfies PersistedAuthorityState,
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const authority = await createAppAuthority({ snapshotPath });
    const rewrittenState = await readPersistedAuthorityState(snapshotPath);
    const payload = authority.createSyncPayload();

    expect(authority.graph.company.list().map((company) => company.name)).toEqual([
      "Broken History Co",
    ]);
    expect(payload.cursor).toBe(`${rewrittenState.writeHistory.cursorPrefix}0`);
    expect(payload.cursor).not.toBe("authority:broken:0");
    expect(authority.getChangesAfter("authority:broken:2")).toEqual({
      kind: "reset",
      cursor: payload.cursor,
      changes: [],
    });
    expect(rewrittenState.writeHistory.results).toEqual([]);
  });

  it("serves a valid total-sync payload from the sync route", async () => {
    const snapshotPath = await createTempSnapshotPath();
    const authority = await createAppAuthority({ snapshotPath });

    const response = handleSyncRequest(new Request("http://app.local/api/sync"), authority);
    const payload = (await response.json()) as TotalSyncPayload;
    const validation = validateAuthoritativeTotalSyncPayload(payload, app);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload.mode).toBe("total");
    expect(payload.scope).toEqual({ kind: "graph" });
    expect(payload.cursor.startsWith("authority:")).toBe(true);
    expect(validation.ok).toBe(true);
  });
});
