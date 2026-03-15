import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bootstrap,
  createStore,
  createTypeClient,
  core,
  edgeId,
  type AuthoritativeGraphWriteHistory,
  type AuthoritativeGraphWriteResult,
  type GraphWriteTransaction,
  type StoreSnapshot,
  type TotalSyncPayload,
  validateAuthoritativeTotalSyncPayload,
} from "@io/graph";

import { createAppAuthority } from "./authority.js";
import { app } from "./graph/app.js";
import {
  createAppServerRoutes,
  handleSyncRequest,
  handleTransactionRequest,
} from "./server-app.js";

const tempDirs: string[] = [];

type PersistedAuthorityState = {
  readonly version: 1;
  readonly snapshot: StoreSnapshot;
  readonly writeHistory: AuthoritativeGraphWriteHistory;
  readonly secretValues?: Record<string, string>;
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
      transaction: createCompanyNameWriteTransaction(
        store,
        companyId,
        "Broken History Co 2",
        "tx:1",
      ),
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

  it("serves incremental sync payloads when the client supplies a cursor", async () => {
    const snapshotPath = await createTempSnapshotPath();
    const authority = await createAppAuthority({ snapshotPath });
    const initial = authority.createSyncPayload();
    const companyId = authority.graph.company.list()[0]?.id;
    if (!companyId) throw new Error("Expected seeded company data.");

    await authority.applyTransaction(
      createCompanyNameWriteTransaction(authority.store, companyId, "Acme Incremental", "tx:1"),
    );

    const response = handleSyncRequest(
      new Request(`http://app.local/api/sync?after=${encodeURIComponent(initial.cursor)}`),
      authority,
    );
    const payload = (await response.json()) as {
      readonly mode: string;
      readonly after: string;
      readonly transactions: readonly AuthoritativeGraphWriteResult[];
      readonly cursor: string;
    };

    expect(response.status).toBe(200);
    expect(payload.mode).toBe("incremental");
    expect(payload.after).toBe(initial.cursor);
    expect(payload.transactions).toHaveLength(1);
    expect(payload.transactions[0]?.txId).toBe("tx:1");
    expect(payload.cursor).not.toBe(initial.cursor);
  });

  it("accepts graph write transactions through the server route and persists the change", async () => {
    const snapshotPath = await createTempSnapshotPath();
    const authority = await createAppAuthority({ snapshotPath });
    const companyId = authority.graph.company.list()[0]?.id;
    if (!companyId) throw new Error("Expected seeded company data.");

    const transaction = createCompanyNameWriteTransaction(
      authority.store,
      companyId,
      "Acme Persisted",
      "tx:route",
    );
    const response = await handleTransactionRequest(
      new Request("http://app.local/api/tx", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(transaction),
      }),
      authority,
    );
    const payload = (await response.json()) as AuthoritativeGraphWriteResult;
    const restarted = await createAppAuthority({ snapshotPath });

    expect(response.status).toBe(200);
    expect(payload.txId).toBe("tx:route");
    expect(authority.graph.company.get(companyId).name).toBe("Acme Persisted");
    expect(restarted.graph.company.get(companyId).name).toBe("Acme Persisted");
  });

  it("stores env-var plaintext only in authority state while syncing opaque metadata", async () => {
    const snapshotPath = await createTempSnapshotPath();
    const authority = await createAppAuthority({ snapshotPath });

    const created = await authority.saveEnvVar({
      name: "OPENAI_API_KEY",
      description: "Primary model credential",
      secretValue: "sk-live-first",
    });
    const createdEnvVar = authority.graph.envVar.get(created.envVarId);
    if (!createdEnvVar?.secret) throw new Error("Expected created env var to reference a secret.");

    const createdSecret = authority.graph.secretRef.get(createdEnvVar.secret);
    const payload = authority.createSyncPayload();
    const persistedAfterCreate = await readPersistedAuthorityState(snapshotPath);

    expect(created.created).toBe(true);
    expect(created.rotated).toBe(true);
    expect(created.secretVersion).toBe(1);
    expect(createdEnvVar.name).toBe("OPENAI_API_KEY");
    expect(createdEnvVar.description).toBe("Primary model credential");
    expect(createdSecret?.version).toBe(1);
    expect(JSON.stringify(payload)).not.toContain("sk-live-first");
    expect(persistedAfterCreate.secretValues?.[createdEnvVar.secret]).toBe("sk-live-first");

    const rotated = await authority.saveEnvVar({
      id: created.envVarId,
      name: "OPENAI_API_KEY",
      description: "Rotated model credential",
      secretValue: "sk-live-second",
    });
    const persistedAfterRotate = await readPersistedAuthorityState(snapshotPath);
    const restarted = await createAppAuthority({ snapshotPath });
    const restartedEnvVar = restarted.graph.envVar.get(created.envVarId);
    if (!restartedEnvVar?.secret)
      throw new Error("Expected restarted env var to reference a secret.");

    expect(rotated.created).toBe(false);
    expect(rotated.rotated).toBe(true);
    expect(rotated.secretVersion).toBe(2);
    expect(restarted.graph.secretRef.get(restartedEnvVar.secret)?.version).toBe(2);
    expect(restarted.graph.envVar.get(created.envVarId).description).toBe(
      "Rotated model credential",
    );
    expect(JSON.stringify(restarted.createSyncPayload())).not.toContain("sk-live-second");
    expect(persistedAfterRotate.secretValues?.[restartedEnvVar.secret]).toBe("sk-live-second");
  });

  it("updates env-var metadata without rotating when no new secret is provided", async () => {
    const snapshotPath = await createTempSnapshotPath();
    const authority = await createAppAuthority({ snapshotPath });

    const created = await authority.saveEnvVar({
      name: "OPENAI_API_KEY",
      description: "Primary model credential",
      secretValue: "sk-live-first",
    });
    const createdEnvVar = authority.graph.envVar.get(created.envVarId);
    if (!createdEnvVar?.secret) throw new Error("Expected created env var to reference a secret.");

    const secretId = createdEnvVar.secret;
    const rotatedAtBefore = authority.graph.secretRef.get(secretId)?.lastRotatedAt?.toISOString();
    const updated = await authority.saveEnvVar({
      id: created.envVarId,
      name: "OPENAI_API_KEY",
      description: "Updated model credential",
    });
    const persistedAfterUpdate = await readPersistedAuthorityState(snapshotPath);
    const updatedEnvVar = authority.graph.envVar.get(created.envVarId);
    if (!updatedEnvVar?.secret) throw new Error("Expected updated env var to retain a secret.");

    expect(updated).toEqual({
      created: false,
      envVarId: created.envVarId,
      rotated: false,
      secretVersion: 1,
    });
    expect(updatedEnvVar.description).toBe("Updated model credential");
    expect(updatedEnvVar.secret).toBe(secretId);
    expect(authority.graph.secretRef.get(secretId)?.version).toBe(1);
    expect(authority.graph.secretRef.get(secretId)?.lastRotatedAt?.toISOString()).toBe(
      rotatedAtBefore,
    );
    expect(persistedAfterUpdate.secretValues?.[secretId]).toBe("sk-live-first");
  });

  it("does not rotate when the submitted secret matches the current authority-only plaintext", async () => {
    const snapshotPath = await createTempSnapshotPath();
    const authority = await createAppAuthority({ snapshotPath });

    const created = await authority.saveEnvVar({
      name: "SLACK_BOT_TOKEN",
      description: "Workspace notifications",
      secretValue: "xapp-secret",
    });
    const createdEnvVar = authority.graph.envVar.get(created.envVarId);
    if (!createdEnvVar?.secret) throw new Error("Expected created env var to reference a secret.");

    const secretId = createdEnvVar.secret;
    const rotatedAtBefore = authority.graph.secretRef.get(secretId)?.lastRotatedAt?.toISOString();
    const updated = await authority.saveEnvVar({
      id: created.envVarId,
      name: "SLACK_BOT_TOKEN",
      description: "Updated notifications integration",
      secretValue: "xapp-secret",
    });
    const persistedAfterUpdate = await readPersistedAuthorityState(snapshotPath);

    expect(updated).toEqual({
      created: false,
      envVarId: created.envVarId,
      rotated: false,
      secretVersion: 1,
    });
    expect(authority.graph.envVar.get(created.envVarId).description).toBe(
      "Updated notifications integration",
    );
    expect(authority.graph.secretRef.get(secretId)?.version).toBe(1);
    expect(authority.graph.secretRef.get(secretId)?.lastRotatedAt?.toISOString()).toBe(
      rotatedAtBefore,
    );
    expect(persistedAfterUpdate.secretValues?.[secretId]).toBe("xapp-secret");
  });

  it("accepts env-var mutations through the server route and syncs the opaque graph state", async () => {
    const snapshotPath = await createTempSnapshotPath();
    const authority = await createAppAuthority({ snapshotPath });
    const routes = createAppServerRoutes(authority);

    const response = await routes["/api/env-vars"](
      new Request("http://app.local/api/env-vars", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "SLACK_BOT_TOKEN",
          description: "Notifications integration",
          secretValue: "xapp-secret",
        }),
      }),
    );
    const payload = (await response.json()) as {
      readonly envVarId: string;
      readonly created: boolean;
      readonly rotated: boolean;
      readonly secretVersion?: number;
    };
    const envVar = authority.graph.envVar.get(payload.envVarId);

    expect(response.status).toBe(201);
    expect(payload.created).toBe(true);
    expect(payload.rotated).toBe(true);
    expect(payload.secretVersion).toBe(1);
    expect(envVar?.name).toBe("SLACK_BOT_TOKEN");
    expect(JSON.stringify(authority.createSyncPayload())).not.toContain("xapp-secret");
  });
});
