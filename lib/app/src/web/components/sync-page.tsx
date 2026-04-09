"use client";

import { type SyncScope, type SyncScopeRequest } from "@io/graph-sync";
import { Badge } from "@io/web/badge";
import { Button } from "@io/web/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@io/web/card";
import { Link } from "@tanstack/react-router";

import {
  resolveWebSyncProofRequestedScope,
  resolveWebSyncProofScopeKey,
  webSyncProofScopeOptions,
  type WebSyncProofScopeKey,
} from "../lib/sync-scopes.js";
import { GraphAccessGate } from "./auth-shell.js";
import { ExplorerSyncInspector } from "./explorer/index.js";
import { useExplorerSyncSnapshot } from "./explorer/sync.js";
import {
  GraphRuntimeBootstrap,
  useGraphRuntime,
  type GraphRuntime,
} from "./graph-runtime-bootstrap.js";

function describeRequestedScope(scope: SyncScopeRequest): string {
  if (scope.kind === "graph") {
    return "Whole graph";
  }

  return `${scope.moduleId} / ${scope.scopeId}`;
}

function describeDeliveredScope(scope: SyncScope): string {
  if (scope.kind === "graph") {
    return "Whole graph";
  }

  return `${scope.moduleId} / ${scope.scopeId}`;
}

function ScopeSelection({ activeScopeKey }: { activeScopeKey: WebSyncProofScopeKey }) {
  return (
    <div className="flex flex-wrap gap-2">
      {webSyncProofScopeOptions.map((option) => (
        <Button
          key={option.key}
          render={<Link search={{ scope: option.key }} to="/sync" />}
          size="sm"
          variant={option.key === activeScopeKey ? "default" : "outline"}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function SyncPageSurface({
  runtime,
  scopeKey,
}: {
  runtime: GraphRuntime;
  scopeKey: WebSyncProofScopeKey;
}) {
  const { state } = useExplorerSyncSnapshot(runtime.sync);
  const activeScopeKey = resolveWebSyncProofScopeKey(state.scope);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-sync-page="">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Scoped Sync Proof</CardTitle>
              <CardDescription>
                Exercise whole-graph recovery plus the installed workflow review and core catalog
                module scopes over the current `/api/sync` transport.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline">{state.status}</Badge>
              <Badge variant="outline">{state.freshness}</Badge>
              <Badge variant="outline">{state.completeness}</Badge>
              {state.fallbackReason ? (
                <Badge variant="destructive">{state.fallbackReason}</Badge>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <ScopeSelection activeScopeKey={scopeKey} />
            <Button
              onClick={() => {
                void runtime.sync.sync().catch(() => undefined);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              {state.status === "syncing" ? "Refreshing..." : "Pull latest"}
            </Button>
            {scopeKey !== "graph" ? (
              <Button
                render={<Link search={{ scope: "graph" }} to="/sync" />}
                size="sm"
                type="button"
                variant="outline"
              >
                Recover with whole graph
              </Button>
            ) : null}
          </div>

          <div className="grid gap-3 text-sm">
            <div className="grid gap-1">
              <span className="text-muted-foreground text-xs font-medium tracking-[0.16em] uppercase">
                Requested scope
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <span>{describeRequestedScope(state.requestedScope)}</span>
                <Badge variant={scopeKey === "graph" ? "secondary" : "outline"}>
                  {webSyncProofScopeOptions.find((option) => option.key === scopeKey)?.label ??
                    "Whole graph"}
                </Badge>
              </div>
            </div>

            <div className="grid gap-1">
              <span className="text-muted-foreground text-xs font-medium tracking-[0.16em] uppercase">
                Delivered scope
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <span>{describeDeliveredScope(state.scope)}</span>
                <Badge variant={activeScopeKey === "graph" ? "secondary" : "outline"}>
                  {webSyncProofScopeOptions.find((option) => option.key === activeScopeKey)
                    ?.label ?? "Whole graph"}
                </Badge>
              </div>
            </div>

            {state.scope.kind === "module" ? (
              <>
                <div className="grid gap-1">
                  <span className="text-muted-foreground text-xs font-medium tracking-[0.16em] uppercase">
                    Definition hash
                  </span>
                  <code className="text-xs">{state.scope.definitionHash}</code>
                </div>
                <div className="grid gap-1">
                  <span className="text-muted-foreground text-xs font-medium tracking-[0.16em] uppercase">
                    Policy filter version
                  </span>
                  <code className="text-xs">{state.scope.policyFilterVersion}</code>
                </div>
              </>
            ) : null}
          </div>

          <p className="text-muted-foreground text-xs">
            Each registered module scope keeps whole-graph sync available as the explicit recovery
            path when a scoped cursor reports `scope-changed`, `policy-changed`, or another
            fallback-only incremental result.
          </p>
        </CardContent>
      </Card>

      <div className="min-h-0 flex-1">
        <ExplorerSyncInspector sync={runtime.sync} />
      </div>
    </div>
  );
}

function SyncPageSurfaceFromRuntime({ scopeKey }: { scopeKey: WebSyncProofScopeKey }) {
  const runtime = useGraphRuntime();
  return <SyncPageSurface runtime={runtime} scopeKey={scopeKey} />;
}

export function SyncPage({ scopeKey = "graph" }: { scopeKey?: WebSyncProofScopeKey }) {
  const requestedScope = resolveWebSyncProofRequestedScope(scopeKey);

  return (
    <GraphAccessGate
      description="The sync inspector only mounts after the shell resolves the principal bootstrap contract."
      title="Sign in to inspect graph sync"
    >
      <GraphRuntimeBootstrap requestedScope={requestedScope}>
        <SyncPageSurfaceFromRuntime scopeKey={scopeKey} />
      </GraphRuntimeBootstrap>
    </GraphAccessGate>
  );
}
