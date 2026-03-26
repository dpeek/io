import {
  sameAuthoritativeGraphRetainedHistoryPolicy,
  type AuthoritativeGraphChangesAfterResult,
  type AuthoritativeGraphRetainedHistoryPolicy,
  type AuthoritativeGraphWriteHistory,
  type AuthoritativeWriteScope,
  type AuthoritativeGraphWriteResult,
  type GraphWriteTransaction,
} from "@io/graph-kernel";
import { type IncrementalSyncResult, type SyncFreshness } from "@io/graph-sync";

import {
  createAuthoritativeGraphWriteSession,
  createAuthoritativeTotalSyncPayload,
} from "./authority-session";
import type { ReplicationReadAuthorizer } from "./authority-types";
import { createTypeClient, type NamespaceClient } from "./client";
import type { AnyTypeOutput } from "./schema";
import type { GraphStore, GraphStoreSnapshot } from "./store";

export const persistedAuthoritativeGraphStateVersion = 1 as const;

export type PersistedAuthoritativeGraphStateVersion =
  typeof persistedAuthoritativeGraphStateVersion;

/**
 * Shared durable authority state published by the graph runtime.
 *
 * Storage adapters may persist this shape directly or reconstruct it from a
 * different on-disk layout, but downstream branches should only depend on this
 * snapshot-plus-history contract.
 */
export type PersistedAuthoritativeGraphState = {
  readonly version: PersistedAuthoritativeGraphStateVersion;
  readonly snapshot: GraphStoreSnapshot;
  readonly writeHistory: AuthoritativeGraphWriteHistory;
};

/**
 * Hydrated authority state returned by a storage adapter.
 *
 * `recovery` makes baseline rewrite rules explicit across adapters:
 *
 * - `"none"` means the persisted baseline and retained history can resume as-is
 * - `"repair"` means the retained history still supports the hydrated
 *   snapshot, but adapter metadata or normalized history should be rewritten
 * - `"reset-baseline"` means the hydrated snapshot can no longer be backed by
 *   retained history, so the runtime must publish a fresh baseline cursor
 */
export type PersistedAuthoritativeGraphStorageRecovery = "none" | "repair" | "reset-baseline";

export type PersistedAuthoritativeGraphStartupRepairReason =
  | "retained-history-policy-normalized"
  | "write-history-write-scope-normalized"
  | "head-sequence-mismatch"
  | "head-cursor-mismatch"
  | "retained-history-boundary-mismatch";

export type PersistedAuthoritativeGraphStartupResetReason =
  | "missing-write-history"
  | "retained-history-base-sequence-invalid"
  | "retained-history-sequence-mismatch"
  | "retained-history-head-mismatch"
  | "retained-history-replay-failed";

export type PersistedAuthoritativeGraphStartupDiagnostics = {
  readonly recovery: PersistedAuthoritativeGraphStorageRecovery;
  readonly repairReasons: readonly PersistedAuthoritativeGraphStartupRepairReason[];
  readonly resetReasons: readonly PersistedAuthoritativeGraphStartupResetReason[];
};

export type PersistedAuthoritativeGraphStorageLoadResult = {
  readonly snapshot: GraphStoreSnapshot;
  readonly writeHistory?: AuthoritativeGraphWriteHistory;
  readonly recovery: PersistedAuthoritativeGraphStorageRecovery;
  readonly startupDiagnostics: PersistedAuthoritativeGraphStartupDiagnostics;
};

/**
 * Incremental durable commit for one accepted authoritative transaction.
 *
 * This is the stable shared commit boundary. Adapter-specific row ids, SQL
 * statements, and transport concerns stay outside this input shape.
 */
export type PersistedAuthoritativeGraphStorageCommitInput = {
  readonly snapshot: GraphStoreSnapshot;
  readonly transaction: GraphWriteTransaction;
  readonly result: AuthoritativeGraphWriteResult;
  readonly writeHistory: AuthoritativeGraphWriteHistory;
};

/**
 * Full durable snapshot rewrite for the current authority baseline.
 */
export type PersistedAuthoritativeGraphStoragePersistInput = {
  readonly snapshot: GraphStoreSnapshot;
  readonly writeHistory: AuthoritativeGraphWriteHistory;
};

export type PersistedAuthoritativeGraphSeed<T extends Record<string, AnyTypeOutput>> = (
  graph: NamespaceClient<T>,
) => void | Promise<void>;

export type PersistedAuthoritativeGraphCursorPrefixFactory = () => string;

/**
 * Stable storage boundary between the shared persisted-authority runtime and a
 * durable adapter implementation.
 *
 * The runtime depends only on `load`, per-transaction `commit`, and baseline
 * `persist`. File formats, SQL tables, Durable Object wiring, and secret side
 * storage remain adapter-specific concerns.
 */
export interface PersistedAuthoritativeGraphStorage {
  load(): Promise<PersistedAuthoritativeGraphStorageLoadResult | null>;
  commit(input: PersistedAuthoritativeGraphStorageCommitInput): Promise<void>;
  persist(input: PersistedAuthoritativeGraphStoragePersistInput): Promise<void>;
}

export type JsonPersistedAuthoritativeGraphOptions<T extends Record<string, AnyTypeOutput>> = {
  readonly path: string;
  readonly seed?: PersistedAuthoritativeGraphSeed<T>;
  readonly createCursorPrefix?: PersistedAuthoritativeGraphCursorPrefixFactory;
  readonly retainedHistoryPolicy?: AuthoritativeGraphRetainedHistoryPolicy;
};

export type PersistedAuthoritativeGraphOptions<T extends Record<string, AnyTypeOutput>> = {
  readonly storage: PersistedAuthoritativeGraphStorage;
  readonly seed?: PersistedAuthoritativeGraphSeed<T>;
  readonly createCursorPrefix?: PersistedAuthoritativeGraphCursorPrefixFactory;
  readonly retainedHistoryPolicy?: AuthoritativeGraphRetainedHistoryPolicy;
};

export type PersistedAuthoritativeGraph<T extends Record<string, AnyTypeOutput>> = {
  readonly store: GraphStore;
  readonly graph: NamespaceClient<T>;
  readonly startupDiagnostics: PersistedAuthoritativeGraphStartupDiagnostics;
  createSyncPayload(options?: {
    authorizeRead?: ReplicationReadAuthorizer;
    freshness?: SyncFreshness;
  }): ReturnType<typeof createAuthoritativeTotalSyncPayload>;
  applyTransaction(
    transaction: GraphWriteTransaction,
    options?: {
      writeScope?: AuthoritativeWriteScope;
    },
  ): Promise<AuthoritativeGraphWriteResult>;
  getChangesAfter(cursor?: string): AuthoritativeGraphChangesAfterResult;
  getIncrementalSyncResult(
    after?: string,
    options?: {
      authorizeRead?: ReplicationReadAuthorizer;
      freshness?: SyncFreshness;
    },
  ): IncrementalSyncResult;
  getRetainedHistoryPolicy(): AuthoritativeGraphRetainedHistoryPolicy;
  persist(): Promise<void>;
};

let persistedAuthoritativeGraphCursorEpoch = 0;

function createPersistedAuthoritativeGraphCursorPrefix(): string {
  persistedAuthoritativeGraphCursorEpoch = Math.max(
    persistedAuthoritativeGraphCursorEpoch + 1,
    Date.now(),
  );
  return `tx:${persistedAuthoritativeGraphCursorEpoch}:`;
}

export async function createPersistedAuthoritativeGraph<
  const T extends Record<string, AnyTypeOutput>,
>(
  store: GraphStore,
  namespace: T,
  options: PersistedAuthoritativeGraphOptions<T>,
): Promise<PersistedAuthoritativeGraph<T>> {
  const graph = createTypeClient(store, namespace);
  const createCursorPrefix =
    options.createCursorPrefix ?? createPersistedAuthoritativeGraphCursorPrefix;
  const createFreshWriteSession = () =>
    createAuthoritativeGraphWriteSession(store, namespace, {
      cursorPrefix: createCursorPrefix(),
      retainedHistoryPolicy: options.retainedHistoryPolicy,
    });
  let writes = createFreshWriteSession();
  const configuredRetainedHistoryPolicy = writes.getRetainedHistoryPolicy();
  const createWriteSession = (writeHistory: AuthoritativeGraphWriteHistory) =>
    createAuthoritativeGraphWriteSession(store, namespace, {
      cursorPrefix: writeHistory.cursorPrefix,
      initialSequence: writeHistory.baseSequence,
      history: writeHistory.results,
      retainedHistoryPolicy: configuredRetainedHistoryPolicy,
    });

  async function persistCurrentState(): Promise<void> {
    await options.storage.persist({
      snapshot: store.snapshot(),
      writeHistory: writes.getHistory(),
    });
  }

  async function persist(): Promise<void> {
    const previousHistory = writes.getHistory();
    writes = createFreshWriteSession();
    try {
      await persistCurrentState();
    } catch (error) {
      writes = createWriteSession(previousHistory);
      throw error;
    }
  }

  async function applyTransaction(
    transaction: GraphWriteTransaction,
    applyOptions: {
      writeScope?: AuthoritativeWriteScope;
    } = {},
  ): Promise<AuthoritativeGraphWriteResult> {
    const previousSnapshot = store.snapshot();
    const previousHistory = writes.getHistory();
    const applied = writes.applyWithSnapshot(transaction, {
      ...applyOptions,
      sourceSnapshot: previousSnapshot,
    });
    const currentHistory = writes.getHistory();

    try {
      await options.storage.commit({
        snapshot: applied.snapshot,
        transaction: applied.result.transaction,
        result: applied.result,
        writeHistory: currentHistory,
      });
    } catch (error) {
      store.replace(previousSnapshot);
      writes = createWriteSession(previousHistory);
      throw error;
    }

    return applied.result;
  }

  const persistedState = await options.storage.load();
  let startupDiagnostics: PersistedAuthoritativeGraphStartupDiagnostics = {
    recovery: "none",
    repairReasons: [],
    resetReasons: [],
  };
  if (persistedState) {
    startupDiagnostics = persistedState.startupDiagnostics;
    store.replace(persistedState.snapshot);
    if (persistedState.writeHistory) {
      try {
        writes = createWriteSession(persistedState.writeHistory);
        const hydratedHistory = writes.getHistory();
        if (
          persistedState.recovery === "repair" ||
          !sameAuthoritativeGraphRetainedHistoryPolicy(
            persistedState.writeHistory.retainedHistoryPolicy,
            configuredRetainedHistoryPolicy,
          ) ||
          hydratedHistory.baseSequence !== persistedState.writeHistory.baseSequence ||
          hydratedHistory.results.length !== persistedState.writeHistory.results.length
        ) {
          await persistCurrentState();
        }
      } catch {
        // Any retained-history replay failure is an explicit reset-baseline
        // rewrite because the hydrated snapshot can no longer support the old
        // incremental cursor window.
        startupDiagnostics = {
          recovery: "reset-baseline",
          repairReasons: [],
          resetReasons: ["retained-history-replay-failed"],
        };
        writes = createFreshWriteSession();
        await persistCurrentState();
      }
    } else {
      writes = createFreshWriteSession();
      await persistCurrentState();
    }
  } else {
    if (options.seed) await options.seed(graph);
    writes = createFreshWriteSession();
    await persistCurrentState();
  }

  return {
    store,
    graph,
    startupDiagnostics,
    createSyncPayload(syncOptions = {}) {
      return createAuthoritativeTotalSyncPayload(store, namespace, {
        authorizeRead: syncOptions.authorizeRead,
        cursor: writes.getCursor() ?? writes.getBaseCursor(),
        diagnostics: {
          retainedHistoryPolicy: writes.getRetainedHistoryPolicy(),
          retainedBaseCursor: writes.getBaseCursor(),
        },
        freshness: syncOptions.freshness ?? "current",
      });
    },
    applyTransaction,
    getChangesAfter(cursor) {
      return writes.getChangesAfter(cursor);
    },
    getIncrementalSyncResult(after, syncOptions) {
      return writes.getIncrementalSyncResult(after, syncOptions);
    },
    getRetainedHistoryPolicy() {
      return writes.getRetainedHistoryPolicy();
    },
    persist,
  };
}
