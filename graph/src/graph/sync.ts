import { createTypeClient, type NamespaceClient } from "./client"
import type { AnyTypeOutput } from "./schema"
import { createStore, type Store, type StoreSnapshot } from "./store"

export type SyncCompleteness = "complete" | "incomplete"
export type SyncFreshness = "current" | "stale"
export type SyncStatus = "idle" | "syncing" | "ready" | "error"

export type SyncScope = {
  readonly kind: "graph"
}

export const graphSyncScope: SyncScope = Object.freeze({ kind: "graph" })

export type TotalSyncPayload = {
  readonly mode: "total"
  readonly scope: SyncScope
  readonly snapshot: StoreSnapshot
  readonly cursor: string
  readonly completeness: "complete"
  readonly freshness: SyncFreshness
}

export type SyncState = {
  readonly mode: "total"
  readonly scope: SyncScope
  readonly status: SyncStatus
  readonly completeness: SyncCompleteness
  readonly freshness: SyncFreshness
  readonly cursor?: string
  readonly lastSyncedAt?: Date
  readonly error?: unknown
}

export type SyncStateListener = (state: SyncState) => void
export type TotalSyncSource = () => TotalSyncPayload | Promise<TotalSyncPayload>

export interface TotalSyncController {
  apply(payload: TotalSyncPayload): TotalSyncPayload
  sync(): Promise<TotalSyncPayload>
  getState(): SyncState
  subscribe(listener: SyncStateListener): () => void
}

export type SyncedTypeClient<T extends Record<string, AnyTypeOutput>> = {
  store: Store
  graph: NamespaceClient<T>
  sync: TotalSyncController
}

export interface TotalSyncSession {
  apply(payload: TotalSyncPayload): TotalSyncPayload
  pull(source: TotalSyncSource): Promise<TotalSyncPayload>
  getState(): SyncState
  subscribe(listener: SyncStateListener): () => void
}

function cloneState(state: SyncState): SyncState {
  return {
    ...state,
    scope: graphSyncScope,
    lastSyncedAt: state.lastSyncedAt ? new Date(state.lastSyncedAt.getTime()) : undefined,
  }
}

export function createTotalSyncSession(store: Store): TotalSyncSession {
  let state: SyncState = {
    mode: "total",
    scope: graphSyncScope,
    status: "idle",
    completeness: "incomplete",
    freshness: "stale",
  }
  const listeners = new Set<SyncStateListener>()

  function publish(next: SyncState): void {
    state = next
    const snapshot = cloneState(state)
    for (const listener of new Set(listeners)) listener(snapshot)
  }

  function apply(payload: TotalSyncPayload): TotalSyncPayload {
    store.replace(payload.snapshot)
    publish({
      mode: payload.mode,
      scope: payload.scope,
      status: "ready",
      completeness: payload.completeness,
      freshness: payload.freshness,
      cursor: payload.cursor,
      lastSyncedAt: new Date(),
    })
    return payload
  }

  async function pull(source: TotalSyncSource): Promise<TotalSyncPayload> {
    publish({
      ...state,
      status: "syncing",
      error: undefined,
    })

    try {
      return apply(await source())
    } catch (error) {
      publish({
        ...state,
        status: "error",
        freshness: "stale",
        error,
      })
      throw error
    }
  }

  function getState(): SyncState {
    return cloneState(state)
  }

  function subscribe(listener: SyncStateListener): () => void {
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  }

  return {
    apply,
    pull,
    getState,
    subscribe,
  }
}

export function createTotalSyncPayload(
  store: Store,
  options: {
    cursor?: string
    freshness?: SyncFreshness
  } = {},
): TotalSyncPayload {
  return {
    mode: "total",
    scope: graphSyncScope,
    snapshot: store.snapshot(),
    cursor: options.cursor ?? "full",
    completeness: "complete",
    freshness: options.freshness ?? "current",
  }
}

export function createTotalSyncController(
  store: Store,
  options: {
    pull: TotalSyncSource
  },
): TotalSyncController {
  const session = createTotalSyncSession(store)

  return {
    apply: session.apply,
    sync() {
      return session.pull(options.pull)
    },
    getState: session.getState,
    subscribe: session.subscribe,
  }
}

export function createSyncedTypeClient<const T extends Record<string, AnyTypeOutput>>(
  namespace: T,
  options: {
    pull: TotalSyncSource
  },
): SyncedTypeClient<T> {
  const store = createStore()

  return {
    store,
    graph: createTypeClient(store, namespace),
    sync: createTotalSyncController(store, options),
  }
}
