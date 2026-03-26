import {
  cloneGraphWriteTransaction,
  createGraphWriteTransactionFromSnapshots,
  type AuthoritativeGraphWriteResult,
  type GraphStore,
  type GraphWriteTransaction,
} from "@io/graph-kernel";
import {
  cloneState as clonePackageSyncState,
  createTotalSyncSession,
  sameSyncActivity,
  sameSyncDiagnostics,
  sameSyncScope,
  sameSyncScopeRequest,
  GraphSyncValidationError,
  type GraphSyncValidationIssue,
  type GraphSyncValidationResult,
  type SyncFreshness,
  type SyncPayload,
  type SyncScopeRequest,
  type SyncSource,
  type SyncState as PackageSyncState,
  type SyncStatus as PackageSyncStatus,
} from "@io/graph-sync";
import { applyGraphWriteTransaction } from "@io/graph-sync";

import {
  createAuthoritativeGraphWriteResultValidator,
  createAuthoritativeTotalSyncValidator,
} from "./authority-validation";
import { createBootstrappedSnapshot } from "./bootstrap";
import {
  GraphValidationError,
  createTypeClient,
  validateGraphStore,
  type GraphValidationIssue,
  type GraphValidationResult,
  type NamespaceClient,
} from "./client";
import { core } from "./core";
import type { AnyTypeOutput } from "./schema";
import { createStore, type GraphStoreSnapshot } from "./store";

export type SyncStatus = PackageSyncStatus | "pushing";

export type SyncState = Omit<PackageSyncState, "status"> & {
  readonly status: SyncStatus;
};

export type SyncStateListener = (state: SyncState) => void;

export type GraphWriteSink = (
  transaction: GraphWriteTransaction,
) => AuthoritativeGraphWriteResult | Promise<AuthoritativeGraphWriteResult>;

export interface SyncedTypeSyncController {
  apply(payload: SyncPayload): SyncPayload;
  applyWriteResult(result: AuthoritativeGraphWriteResult): AuthoritativeGraphWriteResult;
  flush(): Promise<readonly AuthoritativeGraphWriteResult[]>;
  sync(): Promise<SyncPayload>;
  getPendingTransactions(): readonly GraphWriteTransaction[];
  getState(): SyncState;
  subscribe(listener: SyncStateListener): () => void;
}

export type SyncedTypeClient<T extends Record<string, AnyTypeOutput>> = {
  store: GraphStore;
  graph: NamespaceClient<typeof core & T>;
  sync: SyncedTypeSyncController;
};

export class GraphSyncWriteError extends Error {
  override readonly name: string;
  readonly transaction: GraphWriteTransaction;
  override readonly cause: unknown;

  constructor(transaction: GraphWriteTransaction, cause: unknown) {
    super(`Failed to push pending graph write "${transaction.id}".`);
    this.name = "GraphSyncWriteError";
    this.transaction = cloneGraphWriteTransaction(transaction);
    this.cause = cause;
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function cloneSyncState(state: SyncState): SyncState {
  const cloned = clonePackageSyncState({
    ...state,
    status: state.status === "pushing" ? "syncing" : state.status,
  });
  return {
    ...cloned,
    status: state.status,
  };
}

function cloneRuntimeSyncValidationIssue(issue: GraphSyncValidationIssue): GraphValidationIssue {
  return {
    code: issue.code,
    message: issue.message,
    source: "runtime",
    path: Object.freeze([...issue.path]),
    predicateKey: issue.predicateKey,
    nodeId: issue.nodeId,
  };
}

function toRuntimeSyncValidationResult<T>(
  result: Extract<GraphSyncValidationResult<T>, { ok: false }>,
): Extract<GraphValidationResult<T>, { ok: false }> {
  return {
    ok: false,
    phase: result.phase,
    event: result.event,
    value: result.value,
    changedPredicateKeys: [...result.changedPredicateKeys],
    issues: result.issues.map((issue) => cloneRuntimeSyncValidationIssue(issue)),
  };
}

function normalizeSessionError(error: unknown): unknown {
  if (error instanceof GraphSyncValidationError) {
    return new GraphValidationError(toRuntimeSyncValidationResult(error.result));
  }

  return error;
}

export function createSyncedTypeClient<const T extends Record<string, AnyTypeOutput>>(
  namespace: T,
  options: {
    pull: SyncSource;
    push?: GraphWriteSink;
    createTxId?: () => string;
    requestedScope?: SyncScopeRequest;
  },
): SyncedTypeClient<T> {
  const schemaSnapshot = createBootstrappedSnapshot(namespace);
  const store = createStore(schemaSnapshot);
  const authoritativeStore = createStore(schemaSnapshot);
  const rawGraph = createTypeClient(store, { ...core, ...namespace }) as NamespaceClient<
    typeof core & T
  >;
  const session = createTotalSyncSession(authoritativeStore, {
    requestedScope: options.requestedScope,
    preserveSnapshot: schemaSnapshot,
    validate: createAuthoritativeTotalSyncValidator(namespace),
    validateWriteResult: createAuthoritativeGraphWriteResultValidator(
      authoritativeStore,
      namespace,
    ),
  });
  let txSequence = 0;
  let pendingTransactions: GraphWriteTransaction[] = [];
  let captureDepth = 0;
  let captureSnapshot: GraphStoreSnapshot | undefined;
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
      sameSyncScopeRequest(lastPublishedState.requestedScope, state.requestedScope) &&
      sameSyncScope(lastPublishedState.scope, state.scope) &&
      lastPublishedState.status === state.status &&
      lastPublishedState.completeness === state.completeness &&
      lastPublishedState.freshness === state.freshness &&
      lastPublishedState.fallback === state.fallback &&
      sameSyncDiagnostics(lastPublishedState.diagnostics, state.diagnostics) &&
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
    return cloneSyncState({
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

  function materializeLocalSnapshot(): GraphStoreSnapshot {
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
    let before: GraphStoreSnapshot | undefined;
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
    let applied: AuthoritativeGraphWriteResult;
    try {
      applied = session.applyWriteResult(result);
    } catch (error) {
      throw normalizeSessionError(error);
    }

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
          throw normalizeSessionError(error);
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
          throw normalizeSessionError(error);
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
          throw normalizeSessionError(error);
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
