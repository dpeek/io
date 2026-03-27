import type {
  GraphClientSyncController,
  GraphClientSyncState,
  SyncedGraphClient,
} from "@io/graph-client";
import type { AnyTypeOutput } from "@io/graph-kernel";
import {
  sameSyncActivity,
  sameSyncDiagnostics,
  sameSyncScope,
  sameSyncScopeRequest,
} from "@io/graph-sync";
import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { GraphMutationRuntimeProvider } from "./persisted-mutation.js";

type GraphSchema = Record<string, AnyTypeOutput>;
type AnyGraphRuntime = SyncedGraphClient<GraphSchema, GraphSchema>;

export type GraphRuntime<
  TNamespace extends GraphSchema,
  TDefs extends GraphSchema = TNamespace,
> = SyncedGraphClient<TNamespace, TDefs>;

export interface GraphRuntimeProviderProps<
  TNamespace extends GraphSchema,
  TDefs extends GraphSchema = TNamespace,
> {
  readonly children: ReactNode;
  readonly runtime: GraphRuntime<TNamespace, TDefs> | null;
}

export interface GraphQueryOptions<
  TNamespace extends GraphSchema,
  TDefs extends GraphSchema = TNamespace,
> {
  readonly deps?: readonly unknown[];
  readonly runtime?: GraphRuntime<TNamespace, TDefs> | null;
}

const GraphRuntimeContext = createContext<AnyGraphRuntime | null>(null);

function sameGraphSyncState(
  left: GraphClientSyncState | undefined,
  right: GraphClientSyncState,
): boolean {
  if (!left) return false;
  if (
    left.mode !== right.mode ||
    !sameSyncScopeRequest(left.requestedScope, right.requestedScope) ||
    !sameSyncScope(left.scope, right.scope) ||
    left.status !== right.status ||
    left.completeness !== right.completeness ||
    left.freshness !== right.freshness ||
    left.fallbackReason !== right.fallbackReason ||
    !sameSyncDiagnostics(left.diagnostics, right.diagnostics) ||
    left.pendingCount !== right.pendingCount ||
    left.cursor !== right.cursor ||
    left.error !== right.error ||
    (left.lastSyncedAt?.getTime() ?? undefined) !== (right.lastSyncedAt?.getTime() ?? undefined) ||
    left.recentActivities.length !== right.recentActivities.length
  ) {
    return false;
  }

  for (let index = 0; index < left.recentActivities.length; index += 1) {
    const leftActivity = left.recentActivities[index];
    const rightActivity = right.recentActivities[index];
    if (!leftActivity || !rightActivity || !sameSyncActivity(leftActivity, rightActivity)) {
      return false;
    }
  }

  return true;
}

function useResolvedGraphRuntime<TNamespace extends GraphSchema, TDefs extends GraphSchema>(
  runtime?: GraphRuntime<TNamespace, TDefs> | null,
): GraphRuntime<TNamespace, TDefs> {
  const contextRuntime = useOptionalGraphRuntime<TNamespace, TDefs>();
  const resolvedRuntime = runtime ?? contextRuntime;
  if (!resolvedRuntime) {
    throw new Error("Graph runtime is not available outside the graph runtime provider.");
  }
  return resolvedRuntime;
}

function useStableSyncState(sync: GraphClientSyncController): GraphClientSyncState {
  const hasSnapshotRef = useRef(false);
  const snapshotRef = useRef<GraphClientSyncState | undefined>(undefined);

  function readSnapshot(): GraphClientSyncState {
    const next = sync.getState();
    if (hasSnapshotRef.current && sameGraphSyncState(snapshotRef.current, next)) {
      return snapshotRef.current as GraphClientSyncState;
    }
    snapshotRef.current = next;
    hasSnapshotRef.current = true;
    return next;
  }

  return useSyncExternalStore(sync.subscribe, readSnapshot, readSnapshot);
}

/**
 * Shares one synced graph runtime through React context for host-neutral hooks.
 */
export function GraphRuntimeProvider<TNamespace extends GraphSchema, TDefs extends GraphSchema>({
  children,
  runtime,
}: GraphRuntimeProviderProps<TNamespace, TDefs>) {
  const sharedRuntime = runtime as AnyGraphRuntime | null;

  return (
    <GraphRuntimeContext.Provider value={sharedRuntime}>
      <GraphMutationRuntimeProvider runtime={sharedRuntime}>
        {children}
      </GraphMutationRuntimeProvider>
    </GraphRuntimeContext.Provider>
  );
}

export function useOptionalGraphRuntime<
  TNamespace extends GraphSchema,
  TDefs extends GraphSchema = TNamespace,
>(): GraphRuntime<TNamespace, TDefs> | null {
  return useContext(GraphRuntimeContext) as GraphRuntime<TNamespace, TDefs> | null;
}

export function useGraphRuntime<
  TNamespace extends GraphSchema,
  TDefs extends GraphSchema = TNamespace,
>(): GraphRuntime<TNamespace, TDefs> {
  return useResolvedGraphRuntime<TNamespace, TDefs>();
}

export function useGraphSyncState<T extends GraphSchema>(
  runtime?: GraphRuntime<T> | null,
): GraphClientSyncState {
  return useStableSyncState(useResolvedGraphRuntime(runtime).sync);
}

export function useGraphQuery<T extends GraphSchema, TResult>(
  query: (runtime: GraphRuntime<T>) => TResult,
  options: GraphQueryOptions<T> = {},
): TResult {
  const resolvedRuntime = useResolvedGraphRuntime(options.runtime);
  const syncState = useGraphSyncState(resolvedRuntime);

  return useMemo(
    () => query(resolvedRuntime),
    [query, resolvedRuntime, syncState, ...(options.deps ?? [])],
  );
}
