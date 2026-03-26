import {
  cloneAuthoritativeGraphWriteResult,
  type AuthoritativeGraphWriteResult,
  type GraphStore,
  type GraphStoreSnapshot,
} from "@io/graph-kernel";

import {
  appendSyncActivity,
  cloneState,
  cloneSyncDiagnostics,
  cloneSyncScope,
  cloneSyncScopeRequest,
  graphSyncScope,
  type AuthoritativeGraphWriteResultValidator,
  type IncrementalSyncFallbackReason,
  type IncrementalSyncResult,
  type SyncCompleteness,
  type SyncDiagnostics,
  type SyncFreshness,
  type SyncPayload,
  type SyncScope,
  type SyncScopeRequest,
  type SyncSource,
  type SyncState,
  type SyncStateListener,
  type TotalSyncController,
  type TotalSyncPayload,
  type TotalSyncPayloadValidator,
  type TotalSyncSession,
  GraphSyncValidationError,
} from "./contracts";
import { applyGraphWriteTransaction } from "./transactions";
import {
  prepareAuthoritativeGraphWriteResult,
  prepareIncrementalSyncResultForApply,
  prepareTotalSyncPayload,
  validateIncrementalSyncResult,
} from "./validation";

/**
 * Creates a total-sync session over an existing store.
 *
 * The session owns payload application and state transitions, but it does not
 * own transport concerns.
 */
export function createTotalSyncSession(
  store: GraphStore,
  options: {
    requestedScope?: SyncScopeRequest;
    validate?: TotalSyncPayloadValidator;
    validateWriteResult?: AuthoritativeGraphWriteResultValidator;
    preserveSnapshot?: GraphStoreSnapshot;
  } = {},
): TotalSyncSession {
  let state: SyncState = {
    mode: "total",
    requestedScope: cloneSyncScopeRequest(options.requestedScope ?? graphSyncScope),
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
    if (!prepared.ok) throw new GraphSyncValidationError(prepared.result);

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
      ...state,
      mode: materialized.mode,
      scope: materialized.scope,
      status: "ready",
      completeness: materialized.completeness,
      freshness: materialized.freshness,
      pendingCount: 0,
      recentActivities: state.recentActivities,
      cursor: materialized.cursor,
      lastSyncedAt: syncedAt,
      fallback: undefined,
      diagnostics: materialized.diagnostics
        ? cloneSyncDiagnostics(materialized.diagnostics)
        : undefined,
      error: undefined,
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

    const prepared = prepareIncrementalSyncResultForApply(store.snapshot(), result, state.cursor, {
      currentScope: state.scope,
      validateWriteResult: options.validateWriteResult,
    });
    if (!prepared.ok) throw new GraphSyncValidationError(prepared.result);

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
      scope: prepared.value.scope,
      status: "ready",
      completeness: prepared.value.completeness,
      freshness: prepared.value.freshness,
      recentActivities: state.recentActivities,
      cursor: prepared.value.cursor,
      lastSyncedAt: syncedAt,
      fallback: "fallback" in prepared.value ? prepared.value.fallback : undefined,
      diagnostics: prepared.value.diagnostics
        ? cloneSyncDiagnostics(prepared.value.diagnostics)
        : undefined,
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
    if (!prepared.ok) throw new GraphSyncValidationError(prepared.result);

    const materialized = prepared.value;
    options.validateWriteResult?.(materialized, store);
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
      fallback: undefined,
      diagnostics: state.diagnostics ? cloneSyncDiagnostics(state.diagnostics) : undefined,
      error: undefined,
    });
    return cloneAuthoritativeGraphWriteResult(materialized);
  }

  async function pull(source: SyncSource): Promise<SyncPayload> {
    const sourceState = cloneState(state);
    let fallback: IncrementalSyncFallbackReason | undefined;
    let diagnostics = sourceState.diagnostics
      ? cloneSyncDiagnostics(sourceState.diagnostics)
      : undefined;
    publish({
      ...state,
      status: "syncing",
      error: undefined,
    });

    try {
      const payload = await source(sourceState);
      if (payload.mode === "incremental") {
        const validation = validateIncrementalSyncResult(payload);
        if (validation.ok) {
          fallback = "fallback" in validation.value ? validation.value.fallback : undefined;
          diagnostics = validation.value.diagnostics
            ? cloneSyncDiagnostics(validation.value.diagnostics)
            : undefined;
        }
      } else {
        const prepared = prepareTotalSyncPayload(payload, {
          preserveSnapshot: options.preserveSnapshot,
        });
        if (prepared.ok) {
          diagnostics = prepared.value.diagnostics
            ? cloneSyncDiagnostics(prepared.value.diagnostics)
            : undefined;
        }
      }
      return apply(payload);
    } catch (error) {
      publish({
        ...state,
        status: "error",
        freshness: "stale",
        fallback: fallback ?? state.fallback,
        diagnostics,
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

/**
 * Creates a simple total-sync payload from the current store snapshot.
 */
export function createTotalSyncPayload(
  store: GraphStore,
  options: {
    completeness?: SyncCompleteness;
    cursor?: string;
    diagnostics?: SyncDiagnostics;
    freshness?: SyncFreshness;
    scope?: SyncScope;
  } = {},
): TotalSyncPayload {
  return {
    mode: "total" as const,
    scope: cloneSyncScope(options.scope ?? graphSyncScope),
    snapshot: store.snapshot(),
    cursor: options.cursor ?? "full",
    completeness: options.completeness ?? "complete",
    freshness: options.freshness ?? "current",
    ...(options.diagnostics ? { diagnostics: cloneSyncDiagnostics(options.diagnostics) } : {}),
  };
}

export function createTotalSyncController(
  store: GraphStore,
  options: {
    pull: SyncSource;
    requestedScope?: SyncScopeRequest;
    validate?: TotalSyncPayloadValidator;
    validateWriteResult?: AuthoritativeGraphWriteResultValidator;
    preserveSnapshot?: GraphStoreSnapshot;
  },
): TotalSyncController {
  const session = createTotalSyncSession(store, {
    requestedScope: options.requestedScope,
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
