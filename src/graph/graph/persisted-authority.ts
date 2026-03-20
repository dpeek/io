import { createTypeClient, type NamespaceClient } from "./client";
import type { AnyTypeOutput } from "./schema";
import type { Store, StoreSnapshot } from "./store";
import {
  createAuthoritativeGraphWriteSession,
  createTotalSyncPayload,
  type AuthoritativeGraphChangesAfterResult,
  type AuthoritativeGraphWriteHistory,
  type AuthoritativeWriteScope,
  type AuthoritativeGraphWriteResult,
  type GraphWriteTransaction,
  type IncrementalSyncResult,
  type SyncFreshness,
} from "./sync";

export const persistedAuthoritativeGraphStateVersion = 1 as const;

export type PersistedAuthoritativeGraphStateVersion =
  typeof persistedAuthoritativeGraphStateVersion;

export type PersistedAuthoritativeGraphState = {
  readonly version: PersistedAuthoritativeGraphStateVersion;
  readonly snapshot: StoreSnapshot;
  readonly writeHistory: AuthoritativeGraphWriteHistory;
};

export type PersistedAuthoritativeGraphStorageLoadResult = {
  readonly snapshot: StoreSnapshot;
  readonly writeHistory?: AuthoritativeGraphWriteHistory;
  readonly needsPersistence: boolean;
};

export type PersistedAuthoritativeGraphStorageCommitInput = {
  readonly snapshot: StoreSnapshot;
  readonly transaction: GraphWriteTransaction;
  readonly result: AuthoritativeGraphWriteResult;
  readonly writeHistory: AuthoritativeGraphWriteHistory;
};

export type PersistedAuthoritativeGraphStoragePersistInput = {
  readonly snapshot: StoreSnapshot;
  readonly writeHistory: AuthoritativeGraphWriteHistory;
};

export type PersistedAuthoritativeGraphSeed<T extends Record<string, AnyTypeOutput>> = (
  graph: NamespaceClient<T>,
) => void | Promise<void>;

export type PersistedAuthoritativeGraphCursorPrefixFactory = () => string;

export interface PersistedAuthoritativeGraphStorage {
  load(): Promise<PersistedAuthoritativeGraphStorageLoadResult | null>;
  commit(input: PersistedAuthoritativeGraphStorageCommitInput): Promise<void>;
  persist(input: PersistedAuthoritativeGraphStoragePersistInput): Promise<void>;
}

export type JsonPersistedAuthoritativeGraphOptions<T extends Record<string, AnyTypeOutput>> = {
  readonly path: string;
  readonly seed?: PersistedAuthoritativeGraphSeed<T>;
  readonly createCursorPrefix?: PersistedAuthoritativeGraphCursorPrefixFactory;
  readonly maxRetainedTransactions?: number;
};

export type PersistedAuthoritativeGraphOptions<T extends Record<string, AnyTypeOutput>> = {
  readonly storage: PersistedAuthoritativeGraphStorage;
  readonly seed?: PersistedAuthoritativeGraphSeed<T>;
  readonly createCursorPrefix?: PersistedAuthoritativeGraphCursorPrefixFactory;
  readonly maxRetainedTransactions?: number;
};

export type PersistedAuthoritativeGraph<T extends Record<string, AnyTypeOutput>> = {
  readonly store: Store;
  readonly graph: NamespaceClient<T>;
  createSyncPayload(options?: {
    freshness?: SyncFreshness;
  }): ReturnType<typeof createTotalSyncPayload>;
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
      freshness?: SyncFreshness;
    },
  ): IncrementalSyncResult;
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
  store: Store,
  namespace: T,
  options: PersistedAuthoritativeGraphOptions<T>,
): Promise<PersistedAuthoritativeGraph<T>> {
  const graph = createTypeClient(store, namespace);
  const createCursorPrefix =
    options.createCursorPrefix ?? createPersistedAuthoritativeGraphCursorPrefix;
  const createFreshWriteSession = () =>
    createAuthoritativeGraphWriteSession(store, namespace, {
      cursorPrefix: createCursorPrefix(),
      maxRetainedResults: options.maxRetainedTransactions,
    });
  const createWriteSession = (writeHistory: AuthoritativeGraphWriteHistory) =>
    createAuthoritativeGraphWriteSession(store, namespace, {
      cursorPrefix: writeHistory.cursorPrefix,
      initialSequence: writeHistory.baseSequence,
      history: writeHistory.results,
      maxRetainedResults: options.maxRetainedTransactions,
    });

  let writes = createFreshWriteSession();

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
    const result = writes.apply(transaction, applyOptions);
    const currentSnapshot = store.snapshot();
    const currentHistory = writes.getHistory();

    try {
      await options.storage.commit({
        snapshot: currentSnapshot,
        transaction: result.transaction,
        result,
        writeHistory: currentHistory,
      });
    } catch (error) {
      store.replace(previousSnapshot);
      writes = createWriteSession(previousHistory);
      throw error;
    }

    return result;
  }

  const persistedState = await options.storage.load();
  if (persistedState) {
    store.replace(persistedState.snapshot);
    if (persistedState.writeHistory) {
      try {
        writes = createWriteSession(persistedState.writeHistory);
        if (
          persistedState.needsPersistence ||
          (options.maxRetainedTransactions !== undefined &&
            persistedState.writeHistory.results.length > options.maxRetainedTransactions)
        ) {
          await persistCurrentState();
        }
      } catch {
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
    createSyncPayload(syncOptions = {}) {
      return createTotalSyncPayload(store, {
        cursor: writes.getCursor() ?? writes.getBaseCursor(),
        freshness: syncOptions.freshness ?? "current",
        namespace,
      });
    },
    applyTransaction,
    getChangesAfter(cursor) {
      return writes.getChangesAfter(cursor);
    },
    getIncrementalSyncResult(after, syncOptions) {
      return writes.getIncrementalSyncResult(after, syncOptions);
    },
    persist,
  };
}
