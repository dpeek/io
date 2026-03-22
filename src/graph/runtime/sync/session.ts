import { createBootstrappedSnapshot } from "../bootstrap";
import {
  GraphValidationError,
  createTypeClient,
  validateGraphStore,
  type NamespaceClient,
} from "../client";
import { core } from "../core";
import type { AnyTypeOutput } from "../schema";
import { createStore, type Store, type StoreSnapshot } from "../store";
import {
  GraphSyncWriteError,
  appendSyncActivity,
  cloneAuthoritativeGraphWriteResult,
  cloneGraphWriteTransaction,
  cloneState,
  graphSyncScope,
  isObjectRecord,
  sameSyncActivity,
  type AuthoritativeGraphWriteResultValidator,
  type AuthoritativeGraphWriteResult,
  type GraphWriteSink,
  type GraphWriteTransaction,
  type IncrementalSyncResult,
  type SyncFreshness,
  type SyncState,
  type SyncStateListener,
  type SyncStatus,
  type SyncPayload,
  type SyncSource,
  type SyncedTypeClient,
  type TotalSyncController,
  type TotalSyncPayload,
  type TotalSyncPayloadValidator,
  type TotalSyncSession,
} from "./contracts";
import { filterReplicatedSnapshot } from "./replication";
import {
  applyGraphWriteTransaction,
  createGraphWriteTransactionFromSnapshots,
  materializeGraphWriteTransactionSnapshot,
} from "./transactions";
import {
  createAuthoritativeGraphWriteResultValidator,
  createAuthoritativeTotalSyncValidator,
  prepareAuthoritativeGraphWriteResult,
  prepareIncrementalSyncResultForApply,
  prepareTotalSyncPayload,
  validateIncrementalSyncResult,
} from "./validation";
import { invalidGraphWriteResult, prefixGraphWriteResultIssues } from "./validation-helpers";

export function createTotalSyncSession(
  store: Store,
  options: {
    validate?: TotalSyncPayloadValidator;
    validateWriteResult?: AuthoritativeGraphWriteResultValidator;
    preserveSnapshot?: StoreSnapshot;
  } = {},
): TotalSyncSession {
  let state: SyncState = {
    mode: "total",
    scope: graphSyncScope,
    status: "idle",
    completeness: "incomplete",
    freshness: "stale",
    pendingCount: 0,
    recentActivities: [],
  };
  const listeners = new Set<SyncStateListener>();

  function recordActivity(activity: SyncState["recentActivities"][number]): void {
    state = {
      ...state,
      recentActivities: appendSyncActivity(state.recentActivities, activity),
    };
  }

  function publish(next: SyncState): void {
    state = {
      ...next,
      recentActivities: state.recentActivities,
    };
    const snapshot = cloneState(state);
    for (const listener of new Set(listeners)) listener(snapshot);
  }

  function applyTotalPayload(payload: TotalSyncPayload) {
    const prepared = prepareTotalSyncPayload(payload, options);
    if (!prepared.ok) throw new GraphValidationError(prepared.result);

    const materialized = prepared.value;
    options.validate?.(materialized);
    store.replace(materialized.snapshot);
    const syncedAt = new Date();
    recordActivity({
      kind: "total",
      cursor: materialized.cursor,
      freshness: materialized.freshness,
      at: syncedAt,
    });
    publish({
      mode: materialized.mode,
      scope: materialized.scope,
      status: "ready",
      completeness: materialized.completeness,
      freshness: materialized.freshness,
      pendingCount: 0,
      recentActivities: state.recentActivities,
      cursor: materialized.cursor,
      lastSyncedAt: syncedAt,
    });
    return materialized;
  }

  function applyIncrementalResult(result: IncrementalSyncResult) {
    if ("fallback" in result) {
      const validation = validateIncrementalSyncResult(result);
      if (validation.ok && "fallback" in validation.value) {
        recordActivity({
          kind: "fallback",
          after: validation.value.after,
          cursor: validation.value.cursor,
          freshness: validation.value.freshness,
          reason: validation.value.fallback,
          at: new Date(),
        });
      }
    }

    const prepared = prepareIncrementalSyncResultForApply(store, result, state.cursor, {
      validateWriteResult: options.validateWriteResult,
    });
    if (!prepared.ok) {
      throw new GraphValidationError<SyncPayload | AuthoritativeGraphWriteResult>(
        prepared.result as never,
      );
    }

    if (prepared.snapshot) {
      store.replace(prepared.snapshot);
    }

    const syncedAt = new Date();
    recordActivity({
      kind: "incremental",
      after: prepared.value.after,
      cursor: prepared.value.cursor,
      freshness: prepared.value.freshness,
      transactionCount: prepared.value.transactions.length,
      txIds: prepared.value.transactions.map((transaction) => transaction.txId),
      writeScopes: prepared.value.transactions.map((transaction) => transaction.writeScope),
      at: syncedAt,
    });
    publish({
      ...state,
      status: "ready",
      completeness: prepared.value.completeness,
      freshness: prepared.value.freshness,
      recentActivities: state.recentActivities,
      cursor: prepared.value.cursor,
      lastSyncedAt: syncedAt,
      error: undefined,
    });
    return prepared.value;
  }

  function apply(payload: SyncPayload): SyncPayload {
    return payload.mode === "incremental"
      ? applyIncrementalResult(payload)
      : applyTotalPayload(payload);
  }

  function applyWriteResult(result: AuthoritativeGraphWriteResult): AuthoritativeGraphWriteResult {
    const prepared = prepareAuthoritativeGraphWriteResult(result);
    if (!prepared.ok) throw new GraphValidationError(prepared.result);

    const materialized = prepared.value;
    const candidateSnapshot = materializeGraphWriteTransactionSnapshot(
      store,
      materialized.transaction,
      {
        allowExistingAssertEdgeIds: true,
      },
    );
    if (!candidateSnapshot.ok) {
      throw new GraphValidationError(
        invalidGraphWriteResult(
          materialized,
          prefixGraphWriteResultIssues(candidateSnapshot.result.issues),
        ),
      );
    }
    options.validateWriteResult?.(materialized);
    applyGraphWriteTransaction(store, materialized.transaction);
    const syncedAt = new Date();
    recordActivity({
      kind: "write",
      txId: materialized.txId,
      cursor: materialized.cursor,
      freshness: "current",
      replayed: materialized.replayed,
      writeScope: materialized.writeScope,
      at: syncedAt,
    });
    publish({
      ...state,
      status: "ready",
      freshness: "current",
      recentActivities: state.recentActivities,
      cursor: materialized.cursor,
      lastSyncedAt: syncedAt,
      error: undefined,
    });
    return cloneAuthoritativeGraphWriteResult(materialized);
  }

  async function pull(source: SyncSource): Promise<SyncPayload> {
    const sourceState = cloneState(state);
    publish({
      ...state,
      status: "syncing",
      error: undefined,
    });

    try {
      return apply(await source(sourceState));
    } catch (error) {
      publish({
        ...state,
        status: "error",
        freshness: "stale",
        error,
      });
      throw error;
    }
  }

  function getState(): SyncState {
    return cloneState(state);
  }

  function subscribe(listener: SyncStateListener): () => void {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }

  return {
    apply,
    applyWriteResult,
    pull,
    getState,
    subscribe,
  };
}

export function createTotalSyncPayload<const T extends Record<string, AnyTypeOutput>>(
  store: Store,
  options: {
    cursor?: string;
    freshness?: SyncFreshness;
    namespace?: T;
  } = {},
) {
  return {
    mode: "total" as const,
    scope: graphSyncScope,
    snapshot: options.namespace
      ? filterReplicatedSnapshot(store, options.namespace)
      : store.snapshot(),
    cursor: options.cursor ?? "full",
    completeness: "complete" as const,
    freshness: options.freshness ?? "current",
  };
}

export function createTotalSyncController(
  store: Store,
  options: {
    pull: SyncSource;
    validate?: TotalSyncPayloadValidator;
    validateWriteResult?: AuthoritativeGraphWriteResultValidator;
    preserveSnapshot?: StoreSnapshot;
  },
): TotalSyncController {
  const session = createTotalSyncSession(store, {
    preserveSnapshot: options.preserveSnapshot,
    validate: options.validate,
    validateWriteResult: options.validateWriteResult,
  });

  return {
    apply: session.apply,
    applyWriteResult: session.applyWriteResult,
    sync() {
      return session.pull(options.pull);
    },
    getState: session.getState,
    subscribe: session.subscribe,
  };
}

export function createSyncedTypeClient<const T extends Record<string, AnyTypeOutput>>(
  namespace: T,
  options: {
    pull: SyncSource;
    push?: GraphWriteSink;
    createTxId?: () => string;
  },
): SyncedTypeClient<T> {
  const schemaSnapshot = createBootstrappedSnapshot(namespace);
  const store = createStore(schemaSnapshot);
  const authoritativeStore = createStore(schemaSnapshot);
  const preserveSnapshot = schemaSnapshot;
  const rawGraph = createTypeClient(store, { ...core, ...namespace }) as NamespaceClient<
    typeof core & T
  >;
  const session = createTotalSyncSession(authoritativeStore, {
    preserveSnapshot,
    validate: createAuthoritativeTotalSyncValidator(namespace),
    validateWriteResult: createAuthoritativeGraphWriteResultValidator(
      authoritativeStore,
      namespace,
    ),
  });
  let txSequence = 0;
  let pendingTransactions: GraphWriteTransaction[] = [];
  let captureDepth = 0;
  let captureSnapshot: StoreSnapshot | undefined;
  let statusOverride: SyncStatus | undefined;
  let freshnessOverride: SyncFreshness | undefined;
  let errorOverride: unknown | undefined;
  const listeners = new Set<SyncStateListener>();
  const typeHandleCache = new WeakMap<object, object>();
  const entityRefCache = new WeakMap<object, object>();
  const fieldGroupCache = new WeakMap<object, object>();
  const predicateRefCache = new WeakMap<object, object>();
  let lastPublishedState: SyncState | undefined;

  function matchesLastPublishedState(state: SyncState): boolean {
    if (!lastPublishedState) return false;
    if (lastPublishedState.recentActivities.length !== state.recentActivities.length) return false;

    for (let index = 0; index < state.recentActivities.length; index += 1) {
      const left = lastPublishedState.recentActivities[index];
      const right = state.recentActivities[index];
      if (!left || !right || !sameSyncActivity(left, right)) return false;
    }

    return (
      lastPublishedState.mode === state.mode &&
      lastPublishedState.scope.kind === state.scope.kind &&
      lastPublishedState.status === state.status &&
      lastPublishedState.completeness === state.completeness &&
      lastPublishedState.freshness === state.freshness &&
      lastPublishedState.pendingCount === state.pendingCount &&
      lastPublishedState.cursor === state.cursor &&
      lastPublishedState.error === state.error &&
      (lastPublishedState.lastSyncedAt?.getTime() ?? undefined) ===
        (state.lastSyncedAt?.getTime() ?? undefined)
    );
  }

  function clonePendingTransactions(): GraphWriteTransaction[] {
    return pendingTransactions.map((transaction) => cloneGraphWriteTransaction(transaction));
  }

  function nextTxId(): string {
    if (options.createTxId) return options.createTxId();
    txSequence += 1;
    return `local:${txSequence}`;
  }

  function currentState(): SyncState {
    const state = session.getState();
    return cloneState({
      ...state,
      status: statusOverride ?? state.status,
      freshness: freshnessOverride ?? state.freshness,
      pendingCount: pendingTransactions.length,
      error: errorOverride ?? state.error,
    });
  }

  function publishState(): void {
    const state = currentState();
    if (matchesLastPublishedState(state)) return;
    lastPublishedState = state;
    for (const listener of new Set(listeners)) listener(state);
  }

  function clearOverrides(): void {
    statusOverride = undefined;
    freshnessOverride = undefined;
    errorOverride = undefined;
  }

  function materializeLocalSnapshot(): StoreSnapshot {
    const replayStore = createStore(authoritativeStore.snapshot());
    for (const transaction of pendingTransactions) {
      applyGraphWriteTransaction(replayStore, transaction);
    }
    const validation = validateGraphStore(replayStore, namespace);
    if (!validation.ok) throw new GraphValidationError(validation);
    return replayStore.snapshot();
  }

  function replaceLocalFromAuthority(): void {
    store.replace(materializeLocalSnapshot());
  }

  function recordCommittedMutation<TResult>(fn: () => TResult): TResult {
    const isRoot = captureDepth === 0;
    if (isRoot) captureSnapshot = store.snapshot();
    captureDepth += 1;
    let succeeded = false;
    let before: StoreSnapshot | undefined;
    let result!: TResult;

    try {
      result = fn();
      succeeded = true;
    } finally {
      captureDepth -= 1;
      if (isRoot) {
        before = captureSnapshot;
        captureSnapshot = undefined;
      }
    }

    if (!isRoot || !succeeded || before === undefined) return result;

    const transaction = createGraphWriteTransactionFromSnapshots(
      before,
      store.snapshot(),
      nextTxId(),
    );
    if (transaction.ops.length === 0) return result;
    pendingTransactions = [...pendingTransactions, transaction];
    publishState();
    return result;
  }

  function reconcileWriteResult(
    result: AuthoritativeGraphWriteResult,
    options: {
      acknowledgePending?: boolean;
    } = {},
  ): AuthoritativeGraphWriteResult {
    const applied = session.applyWriteResult(result);

    if (options.acknowledgePending && pendingTransactions[0]?.id === applied.txId) {
      pendingTransactions = pendingTransactions.slice(1);
    }

    replaceLocalFromAuthority();
    return applied;
  }

  function wrapPredicateRef<TValue extends object>(predicateRef: TValue): TValue {
    const cached = predicateRefCache.get(predicateRef);
    if (cached) return cached as TValue;

    const wrapped = new Proxy(predicateRef, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (typeof key !== "string") return value;
        if (typeof value !== "function") return value;

        if (
          key === "set" ||
          key === "clear" ||
          key === "replace" ||
          key === "add" ||
          key === "remove" ||
          key === "batch"
        ) {
          return (...args: unknown[]) => recordCommittedMutation(() => value.apply(target, args));
        }

        return value.bind(target);
      },
    });

    predicateRefCache.set(predicateRef, wrapped);
    return wrapped as TValue;
  }

  function wrapFieldGroup<TValue extends object>(fieldGroup: TValue): TValue {
    const cached = fieldGroupCache.get(fieldGroup);
    if (cached) return cached as TValue;

    const wrapped = new Proxy(fieldGroup, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (typeof key !== "string") return value;
        if (!isObjectRecord(value)) return value;
        if ("predicateId" in value && typeof value.predicateId === "string") {
          return wrapPredicateRef(value);
        }
        return wrapFieldGroup(value);
      },
    });

    fieldGroupCache.set(fieldGroup, wrapped);
    return wrapped as TValue;
  }

  function wrapEntityRef<TValue extends object>(entityRef: TValue): TValue {
    const cached = entityRefCache.get(entityRef);
    if (cached) return cached as TValue;

    const wrapped = new Proxy(entityRef, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (typeof key !== "string") return value;
        if (key === "fields" && isObjectRecord(value)) return wrapFieldGroup(value);
        if (typeof value !== "function") return value;

        if (key === "update" || key === "delete" || key === "batch") {
          return (...args: unknown[]) => recordCommittedMutation(() => value.apply(target, args));
        }

        return value.bind(target);
      },
    });

    entityRefCache.set(entityRef, wrapped);
    return wrapped as TValue;
  }

  function wrapTypeHandle<TValue extends object>(typeHandle: TValue): TValue {
    const cached = typeHandleCache.get(typeHandle);
    if (cached) return cached as TValue;

    const wrapped = new Proxy(typeHandle, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (typeof key !== "string") return value;
        if (typeof value !== "function") return value;

        if (key === "create" || key === "update" || key === "delete") {
          return (...args: unknown[]) => recordCommittedMutation(() => value.apply(target, args));
        }

        if (key === "ref" || key === "node") {
          return (...args: unknown[]) => wrapEntityRef(value.apply(target, args));
        }

        return value.bind(target);
      },
    });

    typeHandleCache.set(typeHandle, wrapped);
    return wrapped as TValue;
  }

  const graph = new Proxy(rawGraph as object, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof key !== "string") return value;
      if (!isObjectRecord(value)) return value;
      return wrapTypeHandle(value);
    },
  }) as NamespaceClient<typeof core & T>;

  session.subscribe(() => {
    publishState();
  });

  return {
    store,
    graph,
    sync: {
      apply(payload) {
        clearOverrides();
        try {
          const applied = session.apply(payload);
          if (applied.mode === "total") pendingTransactions = [];
          replaceLocalFromAuthority();
          publishState();
          return applied;
        } catch (error) {
          publishState();
          throw error;
        }
      },
      applyWriteResult(result) {
        clearOverrides();
        try {
          const applied = reconcileWriteResult(result, { acknowledgePending: true });
          publishState();
          return applied;
        } catch (error) {
          publishState();
          throw error;
        }
      },
      async flush() {
        if (pendingTransactions.length === 0) return [];
        if (!options.push) {
          throw new Error("Synced client cannot flush pending writes without a push transport.");
        }

        const results: AuthoritativeGraphWriteResult[] = [];
        statusOverride = "pushing";
        freshnessOverride = undefined;
        errorOverride = undefined;
        publishState();

        while (pendingTransactions[0]) {
          const transaction = pendingTransactions[0];
          if (!transaction) break;

          try {
            const result = await options.push(transaction);
            results.push(reconcileWriteResult(result, { acknowledgePending: true }));
            if (pendingTransactions.length > 0) {
              statusOverride = "pushing";
              freshnessOverride = undefined;
              errorOverride = undefined;
              publishState();
            }
          } catch (cause) {
            const error =
              cause instanceof GraphSyncWriteError
                ? cause
                : new GraphSyncWriteError(transaction, cause);
            statusOverride = "error";
            freshnessOverride = "stale";
            errorOverride = error;
            publishState();
            throw error;
          }
        }

        clearOverrides();
        publishState();
        return results;
      },
      async sync() {
        clearOverrides();
        try {
          const applied = await session.pull(options.pull);
          if (applied.mode === "total") pendingTransactions = [];
          replaceLocalFromAuthority();
          publishState();
          return applied;
        } catch (error) {
          publishState();
          throw error;
        }
      },
      getPendingTransactions() {
        return clonePendingTransactions();
      },
      getState() {
        return currentState();
      },
      subscribe(listener) {
        listeners.add(listener);

        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
}
