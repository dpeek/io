"use client";

import { GraphAccessGate } from "./auth-shell.js";
import { Explorer } from "./explorer/index.js";
import { GraphRuntimeBootstrap, useGraphRuntime } from "./graph-runtime-bootstrap.js";

function GraphExplorerSurface() {
  const runtime = useGraphRuntime();
  return <Explorer runtime={runtime} showSyncInspector={false} />;
}

export function GraphExplorerPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col xl:overflow-hidden">
      <GraphAccessGate
        description="Resolve the principal bootstrap contract before booting the explorer against /api/sync and /api/tx."
        title="Sign in to open the graph explorer"
      >
        <GraphRuntimeBootstrap>
          <GraphExplorerSurface />
        </GraphRuntimeBootstrap>
      </GraphAccessGate>
    </div>
  );
}
