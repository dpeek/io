import {
  createSyncedTypeClient,
  type AuthoritativeGraphWriteResult,
  type GraphWriteTransaction,
  type SyncPayload,
  type SyncedTypeClient,
} from "@io/graph";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { app } from "../graph/app.js";
import type { MutationCallbacks } from "./mutation-validation.js";

const syncUrl = "/api/sync";
const transactionUrl = "/api/tx";

export type AppRuntime = SyncedTypeClient<typeof app>;
type PersistableRuntime = Pick<AppRuntime, "sync">;

const runtimeCache = new Map<string, Promise<AppRuntime>>();
const pendingMutationFlushes = new WeakMap<object, Promise<void>>();

const AppRuntimeContext = createContext<AppRuntime | null>(null);

function readErrorMessage(status: number, statusText: string, payload: unknown, fallback: string): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as { error?: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }
  return `${fallback} with ${status} ${statusText}.`;
}

async function fetchSyncPayload(after?: string): Promise<SyncPayload> {
  const requestUrl = after ? `${syncUrl}?after=${encodeURIComponent(after)}` : syncUrl;
  const response = await fetch(requestUrl, {
    cache: "no-store",
    headers: {
      accept: "application/json",
    },
  });

  const payload = (await response.json().catch(() => undefined)) as SyncPayload | { error?: string } | undefined;
  if (!response.ok) {
    throw new Error(
      readErrorMessage(response.status, response.statusText, payload, "Sync request failed"),
    );
  }

  return payload as SyncPayload;
}

async function pushTransaction(
  transaction: GraphWriteTransaction,
): Promise<AuthoritativeGraphWriteResult> {
  const response = await fetch(transactionUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(transaction),
  });

  const payload = (await response.json().catch(() => undefined)) as
    | AuthoritativeGraphWriteResult
    | { error?: string }
    | undefined;
  if (!response.ok) {
    throw new Error(
      readErrorMessage(response.status, response.statusText, payload, "Graph write failed"),
    );
  }

  return payload as AuthoritativeGraphWriteResult;
}

export async function createAppRuntime(): Promise<AppRuntime> {
  const runtime = createSyncedTypeClient(app, {
    pull: (state) => fetchSyncPayload(state.cursor),
    push: pushTransaction,
  });

  await runtime.sync.sync();
  return runtime;
}

export function loadSharedAppRuntime(): Promise<AppRuntime> {
  const cached = runtimeCache.get(syncUrl);
  if (cached) return cached;

  const pending = createAppRuntime().catch((error) => {
    runtimeCache.delete(syncUrl);
    throw error;
  });
  runtimeCache.set(syncUrl, pending);
  return pending;
}

export function resetSharedAppRuntime(): void {
  runtimeCache.delete(syncUrl);
}

export function useOptionalAppRuntime(): AppRuntime | null {
  return useContext(AppRuntimeContext);
}

export function useAppRuntime(): AppRuntime {
  const runtime = useOptionalAppRuntime();
  if (!runtime) {
    throw new Error("App runtime is not available outside the synced runtime provider.");
  }
  return runtime;
}

export function persistRuntimeChanges(runtime: PersistableRuntime): Promise<void> {
  const sync = runtime.sync;
  const current = pendingMutationFlushes.get(sync) ?? Promise.resolve();
  const queued = current.catch(() => undefined).then(async () => {
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
  runtime?: PersistableRuntime | null,
): MutationCallbacks {
  const contextRuntime = useOptionalAppRuntime();
  const resolvedRuntime = runtime ?? contextRuntime;

  return useMemo(
    () => ({
      onMutationError: callbacks.onMutationError,
      onMutationSuccess: () => {
        callbacks.onMutationSuccess?.();
        if (!resolvedRuntime) return;
        void persistRuntimeChanges(resolvedRuntime).catch((error) => {
          callbacks.onMutationError?.(error);
        });
      },
    }),
    [callbacks.onMutationError, callbacks.onMutationSuccess, resolvedRuntime],
  );
}

type AppBootstrapProps = {
  loadRuntime?: () => Promise<AppRuntime>;
  renderApp?: () => ReactNode;
};

type BootstrapState =
  | { status: "loading" }
  | { status: "ready"; runtime: AppRuntime }
  | { status: "error"; error: unknown };

function formatBootstrapError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function LoadingState() {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100"
      data-app-bootstrap="loading"
    >
      <div className="w-full max-w-md rounded-[1.75rem] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-slate-950/30">
        <p className="text-xs tracking-[0.28em] text-cyan-300 uppercase">Graph sync</p>
        <h1 className="mt-3 text-2xl font-semibold">Loading authoritative graph</h1>
        <p className="mt-2 text-sm text-slate-300">
          Waiting for the first total snapshot from <code>{syncUrl}</code>.
        </p>
      </div>
    </main>
  );
}

function ErrorState({ error, onRetry }: { error: unknown; onRetry(): void }) {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-rose-950 px-6 text-rose-50"
      data-app-bootstrap="error"
    >
      <div className="w-full max-w-md rounded-[1.75rem] border border-rose-200/20 bg-black/20 p-6 shadow-2xl shadow-rose-950/30">
        <p className="text-xs tracking-[0.28em] text-rose-200 uppercase">Sync failed</p>
        <h1 className="mt-3 text-2xl font-semibold">Unable to load the graph</h1>
        <p className="mt-2 text-sm text-rose-100/85">{formatBootstrapError(error)}</p>
        <p className="mt-2 text-xs text-rose-100/65">
          Endpoint: <code>{syncUrl}</code>
        </p>
        <button
          className="mt-5 rounded-full border border-rose-100/25 bg-rose-100/10 px-4 py-2 text-sm font-medium"
          onClick={onRetry}
          type="button"
        >
          Retry sync
        </button>
      </div>
    </main>
  );
}

export function AppRuntimeBootstrap({
  loadRuntime = loadSharedAppRuntime,
  renderApp,
}: AppBootstrapProps) {
  const [state, setState] = useState<BootstrapState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    loadRuntime()
      .then((runtime) => {
        if (cancelled) return;
        setState({ status: "ready", runtime });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({ status: "error", error });
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, loadRuntime]);

  if (state.status === "loading") {
    return <LoadingState />;
  }

  if (state.status === "error") {
    return (
      <ErrorState
        error={state.error}
        onRetry={() => {
          resetSharedAppRuntime();
          setAttempt((current) => current + 1);
        }}
      />
    );
  }

  return (
    <AppRuntimeContext.Provider value={state.runtime}>
      {renderApp?.() ?? null}
    </AppRuntimeContext.Provider>
  );
}
