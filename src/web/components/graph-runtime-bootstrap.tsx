"use client";

import {
  createGraphId,
  createSyncedTypeClient,
  type AuthoritativeGraphWriteResult,
  type GraphWriteTransaction,
  type SyncPayload,
  type SyncedTypeClient,
} from "@io/core/graph";
import { GraphMutationRuntimeProvider } from "@io/core/graph/react";
import { app } from "@io/core/graph/schema/app";
import { Button } from "@io/web/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@io/web/card";
import { Skeleton } from "@io/web/skeleton";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const syncUrl = "/api/sync";
const transactionUrl = "/api/tx";

export type GraphRuntime = SyncedTypeClient<typeof app>;

const runtimeCache = new Map<string, Promise<GraphRuntime>>();

const GraphRuntimeContext = createContext<GraphRuntime | null>(null);

function readErrorMessage(
  status: number,
  statusText: string,
  payload: unknown,
  fallback: string,
): string {
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

  const payload = (await response.json().catch(() => undefined)) as
    | SyncPayload
    | { error?: string }
    | undefined;

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

export function createWebTxIdFactory(): () => string {
  const sessionId = createGraphId();
  let txSequence = 0;

  return () => {
    txSequence += 1;
    return `web:${sessionId}:${txSequence}`;
  };
}

export async function createGraphRuntime(): Promise<GraphRuntime> {
  const createTxId = createWebTxIdFactory();
  const runtime = createSyncedTypeClient(app, {
    createTxId,
    pull: (state) => fetchSyncPayload(state.cursor),
    push: pushTransaction,
  });

  await runtime.sync.sync();
  return runtime;
}

export function loadSharedGraphRuntime(): Promise<GraphRuntime> {
  const cached = runtimeCache.get(syncUrl);
  if (cached) return cached;

  const pending = createGraphRuntime().catch((error) => {
    runtimeCache.delete(syncUrl);
    throw error;
  });

  runtimeCache.set(syncUrl, pending);
  return pending;
}

export function resetSharedGraphRuntime(): void {
  runtimeCache.delete(syncUrl);
}

export function useOptionalGraphRuntime(): GraphRuntime | null {
  return useContext(GraphRuntimeContext);
}

export function useGraphRuntime(): GraphRuntime {
  const runtime = useOptionalGraphRuntime();
  if (!runtime) {
    throw new Error("Graph runtime is not available outside the synced runtime provider.");
  }
  return runtime;
}

type GraphRuntimeBootstrapProps = {
  children: ReactNode;
  loadRuntime?: () => Promise<GraphRuntime>;
};

type BootstrapState =
  | { status: "loading" }
  | { status: "ready"; runtime: GraphRuntime }
  | { status: "error"; error: unknown };

function formatBootstrapError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function LoadingState() {
  return (
    <main
      className="flex min-h-[60svh] items-center justify-center px-6"
      data-app-bootstrap="loading"
    >
      <Card className="border-border/70 bg-card/95 w-full max-w-lg border shadow-sm">
        <CardHeader>
          <CardTitle>Loading graph runtime</CardTitle>
          <CardDescription>
            Waiting for the first authoritative snapshot from <code>{syncUrl}</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    </main>
  );
}

function ErrorState({ error, onRetry }: { error: unknown; onRetry(): void }) {
  return (
    <main
      className="flex min-h-[60svh] items-center justify-center px-6"
      data-app-bootstrap="error"
    >
      <Card className="border-destructive/20 bg-card/95 w-full max-w-lg border shadow-sm">
        <CardHeader>
          <CardTitle>Unable to load the graph</CardTitle>
          <CardDescription>{formatBootstrapError(error)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-xs">
            Endpoint: <code>{syncUrl}</code>
          </p>
          <div>
            <Button onClick={onRetry} type="button">
              Retry sync
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

export function GraphRuntimeBootstrap({
  children,
  loadRuntime = loadSharedGraphRuntime,
}: GraphRuntimeBootstrapProps) {
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
          resetSharedGraphRuntime();
          setAttempt((current) => current + 1);
        }}
      />
    );
  }

  return (
    <GraphRuntimeContext.Provider value={state.runtime}>
      <GraphMutationRuntimeProvider runtime={state.runtime}>
        {children}
      </GraphMutationRuntimeProvider>
    </GraphRuntimeContext.Provider>
  );
}
