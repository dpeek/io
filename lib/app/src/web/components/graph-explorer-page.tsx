"use client";

import { GraphAccessGate } from "./auth-shell.js";
import { Explorer } from "./explorer/index.js";
import { GraphRuntimeBootstrap, useGraphRuntime } from "./graph-runtime-bootstrap.js";

function GraphExplorerSurface() {
  const runtime = useGraphRuntime();
  return <Explorer runtime={runtime} />;
}

export function GraphExplorerPage() {
  return (
    <GraphAccessGate
      description="Resolve the principal bootstrap contract before booting the explorer against /api/sync and /api/tx."
      title="Sign in to open the graph explorer"
    >
      <GraphRuntimeBootstrap>
        <GraphExplorerSurface />
      </GraphRuntimeBootstrap>
    </GraphAccessGate>
  );
}
