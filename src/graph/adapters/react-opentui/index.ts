import {
  createElement,
  createContext,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  createWorkflowProjectionIndex,
  type CommitQueueScopeQuery,
  type CommitQueueScopeResult,
  type ProjectBranchScopeQuery,
  type ProjectBranchScopeResult,
  type WorkflowProjectionGraphClient,
  type WorkflowProjectionIndex,
  type WorkflowProjectionIndexOptions,
} from "../../modules/ops/workflow/query.js";
import { GraphMutationRuntimeProvider } from "../../runtime/react/persisted-mutation.js";
import type { AnyTypeOutput } from "../../runtime/schema.js";
import {
  sameSyncActivity,
  sameSyncScope,
  sameSyncScopeRequest,
  type SyncState,
  type SyncedTypeClient,
  type SyncedTypeSyncController,
} from "../../runtime/sync/contracts.js";

type GraphSchema = Record<string, AnyTypeOutput>;
type AnyGraphRuntime = SyncedTypeClient<GraphSchema>;

export type GraphRuntime<T extends GraphSchema> = SyncedTypeClient<T>;

export interface GraphRuntimeProviderProps<T extends GraphSchema> {
  readonly children: ReactNode;
  readonly runtime: GraphRuntime<T> | null;
}

export interface GraphQueryOptions<T extends GraphSchema> {
  readonly deps?: readonly unknown[];
  readonly runtime?: GraphRuntime<T> | null;
}

export type WorkflowGraphRuntime = {
  readonly graph: WorkflowProjectionGraphClient;
  readonly sync: SyncedTypeSyncController;
};

export interface WorkflowProjectionQueryOptions {
  readonly options?: WorkflowProjectionIndexOptions;
  readonly runtime?: WorkflowGraphRuntime | null;
}

const GraphRuntimeContext = createContext<AnyGraphRuntime | null>(null);

function sameGraphSyncState(left: SyncState | undefined, right: SyncState): boolean {
  if (!left) return false;
  if (
    left.mode !== right.mode ||
    !sameSyncScopeRequest(left.requestedScope, right.requestedScope) ||
    !sameSyncScope(left.scope, right.scope) ||
    left.status !== right.status ||
    left.completeness !== right.completeness ||
    left.freshness !== right.freshness ||
    left.fallback !== right.fallback ||
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

function useResolvedGraphRuntime<T extends GraphSchema>(
  runtime?: GraphRuntime<T> | null,
): GraphRuntime<T> {
  const contextRuntime = useOptionalGraphRuntime<T>();
  const resolvedRuntime = runtime ?? contextRuntime;
  if (!resolvedRuntime) {
    throw new Error("Graph runtime is not available outside the OpenTUI graph runtime provider.");
  }
  return resolvedRuntime;
}

function useStableSyncState(sync: SyncedTypeSyncController): SyncState {
  const hasSnapshotRef = useRef(false);
  const snapshotRef = useRef<SyncState | undefined>(undefined);

  function readSnapshot(): SyncState {
    const next = sync.getState();
    if (hasSnapshotRef.current && sameGraphSyncState(snapshotRef.current, next)) {
      return snapshotRef.current as SyncState;
    }
    snapshotRef.current = next;
    hasSnapshotRef.current = true;
    return next;
  }

  return useSyncExternalStore(sync.subscribe, readSnapshot, readSnapshot);
}

export function GraphRuntimeProvider<T extends GraphSchema>({
  children,
  runtime,
}: GraphRuntimeProviderProps<T>) {
  const sharedRuntime = runtime as AnyGraphRuntime | null;

  return createElement(
    GraphRuntimeContext.Provider,
    { value: sharedRuntime },
    createElement(GraphMutationRuntimeProvider, { children, runtime: sharedRuntime }),
  );
}

export function useOptionalGraphRuntime<T extends GraphSchema>(): GraphRuntime<T> | null {
  return useContext(GraphRuntimeContext) as GraphRuntime<T> | null;
}

export function useGraphRuntime<T extends GraphSchema>(): GraphRuntime<T> {
  return useResolvedGraphRuntime<T>();
}

export function useGraphSyncState<T extends GraphSchema>(
  runtime?: GraphRuntime<T> | null,
): SyncState {
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

export function useWorkflowProjectionIndex(
  options: WorkflowProjectionQueryOptions = {},
): WorkflowProjectionIndex {
  return useGraphQuery(
    (runtime) =>
      createWorkflowProjectionIndex(
        runtime.graph as unknown as WorkflowProjectionGraphClient,
        options.options,
      ),
    {
      deps: [options.options],
      runtime: options.runtime as GraphRuntime<GraphSchema> | null | undefined,
    },
  );
}

export function useProjectBranchScope(
  query: ProjectBranchScopeQuery,
  options: WorkflowProjectionQueryOptions = {},
): ProjectBranchScopeResult {
  const projection = useWorkflowProjectionIndex(options);
  return useMemo(() => projection.readProjectBranchScope(query), [projection, query]);
}

export function useCommitQueueScope(
  query: CommitQueueScopeQuery,
  options: WorkflowProjectionQueryOptions = {},
): CommitQueueScopeResult {
  const projection = useWorkflowProjectionIndex(options);
  return useMemo(() => projection.readCommitQueueScope(query), [projection, query]);
}
