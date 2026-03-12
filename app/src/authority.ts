import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { app } from "./graph/app.js";
import { bootstrap } from "./graph/bootstrap.js";
import { createTypeClient, type NamespaceClient } from "./graph/client.js";
import { core } from "./graph/core.js";
import { seedExampleGraph } from "./graph/example-data.js";
import {
  createAuthoritativeGraphWriteSession,
  createTotalSyncPayload,
  validateAuthoritativeTotalSyncPayload,
  type AuthoritativeGraphChangesAfterResult,
  type AuthoritativeGraphWriteHistory,
  type AuthoritativeGraphWriteResult,
  type GraphWriteTransaction,
  type IncrementalSyncResult,
  type SyncFreshness,
  type TotalSyncPayload,
} from "./graph/sync.js";
import { createStore, type StoreSnapshot } from "./graph/store.js";

export type AppAuthority = {
  readonly snapshotPath: string;
  readonly store: ReturnType<typeof createStore>;
  readonly graph: NamespaceClient<typeof app>;
  createSyncPayload(): TotalSyncPayload;
  applyTransaction(transaction: GraphWriteTransaction): Promise<AuthoritativeGraphWriteResult>;
  getChangesAfter(cursor?: string): AuthoritativeGraphChangesAfterResult;
  getIncrementalSyncResult(
    after?: string,
    options?: {
      freshness?: SyncFreshness;
    },
  ): IncrementalSyncResult;
  persist(): Promise<void>;
};

type PersistedAuthorityState = {
  readonly version: 1;
  readonly snapshot: StoreSnapshot;
  readonly writeHistory: AuthoritativeGraphWriteHistory;
};

type LoadedAuthorityState = {
  readonly snapshot: StoreSnapshot;
  readonly writeHistory?: AuthoritativeGraphWriteHistory;
  readonly needsRewrite: boolean;
};

const defaultAuthoritySnapshotPath = fileURLToPath(
  new URL("../tmp/app-graph.snapshot.json", import.meta.url),
);
let authorityCursorEpoch = 0;

function resolveAuthoritySnapshotPath(configuredSnapshotPath?: string): string {
  const rawPath = configuredSnapshotPath?.trim() ?? Bun.env.IO_APP_SNAPSHOT_PATH?.trim();
  if (!rawPath) return defaultAuthoritySnapshotPath;
  return isAbsolute(rawPath) ? rawPath : resolve(process.cwd(), rawPath);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function createAuthorityCursorPrefix(): string {
  authorityCursorEpoch = Math.max(authorityCursorEpoch + 1, Date.now());
  return `authority:${authorityCursorEpoch}:`;
}

function createAuthoritySnapshotPayload(snapshot: StoreSnapshot): TotalSyncPayload {
  return {
    mode: "total",
    scope: { kind: "graph" },
    snapshot,
    cursor: "authority:snapshot",
    completeness: "complete",
    freshness: "current",
  };
}

function validateAuthoritySnapshot(snapshot: StoreSnapshot, snapshotPath: string): StoreSnapshot {
  const validation = validateAuthoritativeTotalSyncPayload(
    createAuthoritySnapshotPayload(snapshot),
    app,
  );
  if (validation.ok) return snapshot;

  const messages = validation.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "snapshot";
    return `${path}: ${issue.message}`;
  });
  throw new Error(`Invalid authority snapshot in "${snapshotPath}": ${messages.join(" | ")}`);
}

function readPersistedWriteHistory(rawHistory: unknown): AuthoritativeGraphWriteHistory | undefined {
  if (!isObjectRecord(rawHistory)) return undefined;
  const cursorPrefix = rawHistory.cursorPrefix;
  const baseSequence = rawHistory.baseSequence;
  const results = rawHistory.results;
  if (typeof cursorPrefix !== "string") return undefined;
  if (typeof baseSequence !== "number" || !Number.isInteger(baseSequence) || baseSequence < 0) {
    return undefined;
  }
  if (!Array.isArray(results)) return undefined;
  return {
    cursorPrefix,
    baseSequence,
    results: results as AuthoritativeGraphWriteResult[],
  };
}

async function readAuthorityState(snapshotPath: string): Promise<LoadedAuthorityState | null> {
  try {
    const rawSnapshot = await readFile(snapshotPath, "utf8");
    const parsed = JSON.parse(rawSnapshot) as unknown;

    if (isObjectRecord(parsed) && parsed.version === 1 && "snapshot" in parsed) {
      const snapshot = validateAuthoritySnapshot(parsed.snapshot as StoreSnapshot, snapshotPath);
      const writeHistory = readPersistedWriteHistory(parsed.writeHistory);
      return {
        snapshot,
        writeHistory,
        needsRewrite: writeHistory === undefined,
      };
    }

    return {
      snapshot: validateAuthoritySnapshot(parsed as StoreSnapshot, snapshotPath),
      needsRewrite: true,
    };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeAuthorityState(
  snapshotPath: string,
  state: PersistedAuthorityState,
): Promise<void> {
  await mkdir(dirname(snapshotPath), { recursive: true });

  const tempPath = `${snapshotPath}.${process.pid}.${Date.now()}.tmp`;

  try {
    await writeFile(tempPath, JSON.stringify(state, null, 2) + "\n", "utf8");
    await rename(tempPath, snapshotPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function createAppAuthority(
  options: {
    snapshotPath?: string;
  } = {},
): Promise<AppAuthority> {
  const snapshotPath = resolveAuthoritySnapshotPath(options.snapshotPath);
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, app);

  const graph = createTypeClient(store, app);
  const persistedState = await readAuthorityState(snapshotPath);

  function createFreshWriteSession() {
    return createAuthoritativeGraphWriteSession(store, app, {
      cursorPrefix: createAuthorityCursorPrefix(),
    });
  }

  function createWriteSession(writeHistory: AuthoritativeGraphWriteHistory) {
    return createAuthoritativeGraphWriteSession(store, app, {
      cursorPrefix: writeHistory.cursorPrefix,
      initialSequence: writeHistory.baseSequence,
      history: writeHistory.results,
    });
  }

  let writes = createFreshWriteSession();

  async function writeCurrentAuthorityState(): Promise<void> {
    await writeAuthorityState(snapshotPath, {
      version: 1,
      snapshot: store.snapshot(),
      writeHistory: writes.getHistory(),
    });
  }

  async function persist(): Promise<void> {
    writes = createFreshWriteSession();
    await writeCurrentAuthorityState();
  }

  async function applyTransaction(
    transaction: GraphWriteTransaction,
  ): Promise<AuthoritativeGraphWriteResult> {
    const previousSnapshot = store.snapshot();
    const previousHistory = writes.getHistory();
    const result = writes.apply(transaction);

    try {
      await writeCurrentAuthorityState();
    } catch (error) {
      store.replace(previousSnapshot);
      writes = createWriteSession(previousHistory);
      throw error;
    }

    return result;
  }

  if (persistedState) {
    store.replace(persistedState.snapshot);
    if (persistedState.writeHistory) {
      try {
        writes = createWriteSession(persistedState.writeHistory);
      } catch {
        writes = createFreshWriteSession();
        await writeCurrentAuthorityState();
      }
    } else {
      writes = createFreshWriteSession();
      await writeCurrentAuthorityState();
    }
  } else {
    seedExampleGraph(graph);
    writes = createFreshWriteSession();
    await writeCurrentAuthorityState();
  }

  return {
    snapshotPath,
    store,
    graph,
    applyTransaction,
    createSyncPayload() {
      return createTotalSyncPayload(store, {
        cursor: writes.getCursor() ?? writes.getBaseCursor(),
        freshness: "current",
      });
    },
    getChangesAfter(cursor) {
      return writes.getChangesAfter(cursor);
    },
    getIncrementalSyncResult(after, options) {
      return writes.getIncrementalSyncResult(after, options);
    },
    persist,
  };
}
