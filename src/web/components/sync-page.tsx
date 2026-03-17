"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@io/web/card";

import { ExplorerSyncInspector } from "./explorer/index.js";
import {
  GraphRuntimeBootstrap,
  useGraphRuntime,
  type GraphRuntime,
} from "./graph-runtime-bootstrap.js";

export function SyncPageSurface({ runtime }: { runtime: GraphRuntime }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-sync-page="">
      <Card className="border-border/70 bg-card/95 border shadow-sm">
        <CardHeader>
          <CardTitle>Graph Sync</CardTitle>
          <CardDescription>
            Inspect the authority cursor, pending local writes, and recent authoritative activity.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          The graph explorer owns graph browsing and editing. This page stays focused on the shared
          sync stream diagnostics.
        </CardContent>
      </Card>

      <div className="min-h-0 flex-1">
        <ExplorerSyncInspector sync={runtime.sync} />
      </div>
    </div>
  );
}

function SyncPageSurfaceFromRuntime() {
  const runtime = useGraphRuntime();
  return <SyncPageSurface runtime={runtime} />;
}

export function SyncPage() {
  return (
    <GraphRuntimeBootstrap>
      <SyncPageSurfaceFromRuntime />
    </GraphRuntimeBootstrap>
  );
}
