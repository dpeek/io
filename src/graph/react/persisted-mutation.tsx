import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { MutationCallbacks } from "./mutation-validation.js";

type PersistableGraphSync = {
  flush(): Promise<unknown>;
  getPendingTransactions(): readonly unknown[];
};

export type PersistedMutationRuntime = {
  graph?: unknown;
  sync: PersistableGraphSync;
};

const pendingMutationFlushes = new WeakMap<object, Promise<void>>();
const MutationRuntimeContext = createContext<PersistedMutationRuntime | null>(null);

export function GraphMutationRuntimeProvider({
  children,
  runtime,
}: {
  children: ReactNode;
  runtime: PersistedMutationRuntime | null;
}) {
  return (
    <MutationRuntimeContext.Provider value={runtime}>{children}</MutationRuntimeContext.Provider>
  );
}

export function useOptionalMutationRuntime(): PersistedMutationRuntime | null {
  return useContext(MutationRuntimeContext);
}

export function persistSyncedGraphChanges(runtime: PersistedMutationRuntime): Promise<void> {
  const sync = runtime.sync;
  const current = pendingMutationFlushes.get(sync) ?? Promise.resolve();
  const queued = current
    .catch(() => undefined)
    .then(async () => {
      if (sync.getPendingTransactions().length === 0) return;
      await sync.flush();
    });
  const tracked = queued.finally(() => {
    if (pendingMutationFlushes.get(sync) === tracked) {
      pendingMutationFlushes.delete(sync);
    }
  });
  pendingMutationFlushes.set(sync, tracked);
  return tracked;
}

export function usePersistedMutationCallbacks(
  callbacks: MutationCallbacks = {},
  runtime?: PersistedMutationRuntime | null,
): MutationCallbacks {
  const contextRuntime = useOptionalMutationRuntime();
  const resolvedRuntime = runtime ?? contextRuntime;

  return useMemo(
    () => ({
      onMutationError: callbacks.onMutationError,
      onMutationSuccess: () => {
        callbacks.onMutationSuccess?.();
        if (!resolvedRuntime) return;
        void persistSyncedGraphChanges(resolvedRuntime).catch((error) => {
          callbacks.onMutationError?.(error);
        });
      },
    }),
    [callbacks.onMutationError, callbacks.onMutationSuccess, resolvedRuntime],
  );
}
