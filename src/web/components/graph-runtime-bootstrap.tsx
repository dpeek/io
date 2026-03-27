"use client";

import { core, coreGraphBootstrapOptions } from "@io/core/graph/modules";
import { workflow } from "@io/core/graph/modules/workflow";
import {
  applyHttpSyncRequest,
  createHttpGraphClient,
  createHttpGraphTxIdFactory,
  defaultHttpGraphUrl,
  type SyncedGraphClient,
} from "@io/graph-client";
import {
  GraphRuntimeProvider as SharedGraphRuntimeProvider,
  useGraphRuntime as useSharedGraphRuntime,
  useOptionalGraphRuntime as useSharedOptionalGraphRuntime,
} from "@io/graph-react";
import { graphSyncScope, type SyncScopeRequest } from "@io/graph-sync";
import { Button } from "@io/web/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@io/web/card";
import { Skeleton } from "@io/web/skeleton";
import { useEffect, useState, type ReactNode } from "react";

const syncUrl = "/api/sync";
const transactionUrl = "/api/tx";

const graphSchema = { ...core, ...workflow } as const;

export type GraphRuntime = SyncedGraphClient<typeof graphSchema>;

const runtimeCache = new Map<string, Promise<GraphRuntime>>();

function resolveWebGraphBaseUrl(): string {
  if (
    typeof window === "object" &&
    window !== null &&
    typeof window.location?.origin === "string" &&
    window.location.origin.length > 0
  ) {
    return window.location.origin;
  }
  if (
    typeof globalThis.location === "object" &&
    globalThis.location !== null &&
    typeof globalThis.location.origin === "string" &&
    globalThis.location.origin.length > 0
  ) {
    return globalThis.location.origin;
  }
  return defaultHttpGraphUrl;
}

function runtimeCacheKey(requestedScope: SyncScopeRequest): string {
  const requestUrl = new URL(syncUrl, resolveWebGraphBaseUrl());
  applyHttpSyncRequest(requestUrl, {
    scope: requestedScope,
  });
  return requestUrl.toString();
}

export function createWebTxIdFactory(): () => string {
  return createHttpGraphTxIdFactory("web");
}

export async function createGraphRuntime(
  requestedScope: SyncScopeRequest = graphSyncScope,
): Promise<GraphRuntime> {
  return createHttpGraphClient(graphSchema, {
    bootstrap: coreGraphBootstrapOptions,
    url: resolveWebGraphBaseUrl(),
    syncPath: syncUrl,
    transactionPath: transactionUrl,
    createTxId: createWebTxIdFactory(),
    requestedScope,
  });
}

export function loadSharedGraphRuntime(
  requestedScope: SyncScopeRequest = graphSyncScope,
): Promise<GraphRuntime> {
  const key = runtimeCacheKey(requestedScope);
  const cached = runtimeCache.get(key);
  if (cached) return cached;

  const pending = createGraphRuntime(requestedScope).catch((error) => {
    runtimeCache.delete(key);
    throw error;
  });

  runtimeCache.set(key, pending);
  return pending;
}

export function resetSharedGraphRuntime(requestedScope?: SyncScopeRequest): void {
  if (!requestedScope) {
    runtimeCache.clear();
    return;
  }

  runtimeCache.delete(runtimeCacheKey(requestedScope));
}

export function useOptionalGraphRuntime(): GraphRuntime | null {
  return useSharedOptionalGraphRuntime<typeof graphSchema>();
}

export function useGraphRuntime(): GraphRuntime {
  return useSharedGraphRuntime<typeof graphSchema>();
}

type GraphRuntimeBootstrapProps = {
  children: ReactNode;
  loadRuntime?: (requestedScope: SyncScopeRequest) => Promise<GraphRuntime>;
  loadingDescription?: string;
  loadingTitle?: string;
  requestedScope?: SyncScopeRequest;
};

type BootstrapState =
  | { status: "loading" }
  | { status: "ready"; runtime: GraphRuntime }
  | { status: "error"; error: unknown };

function formatBootstrapError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function LoadingState({
  description = `Waiting for the first authoritative snapshot from ${syncUrl}.`,
  title = "Loading graph runtime",
}: {
  readonly description?: string;
  readonly title?: string;
}) {
  return (
    <main
      className="flex min-h-[60svh] items-center justify-center px-6"
      data-app-bootstrap="loading"
    >
      <Card className="border-border/70 bg-card/95 w-full max-w-lg border shadow-sm">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
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

export function GraphRuntimeProvider({
  children,
  runtime,
}: {
  children: ReactNode;
  runtime: GraphRuntime;
}) {
  return <SharedGraphRuntimeProvider runtime={runtime}>{children}</SharedGraphRuntimeProvider>;
}

export function GraphRuntimeBootstrap({
  children,
  loadingDescription,
  loadingTitle,
  requestedScope = graphSyncScope,
  loadRuntime = loadSharedGraphRuntime,
}: GraphRuntimeBootstrapProps) {
  const [state, setState] = useState<BootstrapState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const requestedScopeKey = runtimeCacheKey(requestedScope);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    loadRuntime(requestedScope)
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
  }, [attempt, loadRuntime, requestedScope, requestedScopeKey]);

  if (state.status === "loading") {
    return <LoadingState description={loadingDescription} title={loadingTitle} />;
  }

  if (state.status === "error") {
    return (
      <ErrorState
        error={state.error}
        onRetry={() => {
          resetSharedGraphRuntime(requestedScope);
          setAttempt((current) => current + 1);
        }}
      />
    );
  }

  return <GraphRuntimeProvider runtime={state.runtime}>{children}</GraphRuntimeProvider>;
}
