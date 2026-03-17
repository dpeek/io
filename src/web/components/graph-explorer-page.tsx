"use client";

import { Explorer } from "./explorer/index.js";
import { GraphRuntimeBootstrap, useGraphRuntime } from "./graph-runtime-bootstrap.js";

function GraphExplorerSurface() {
  const runtime = useGraphRuntime();
  return <Explorer runtime={runtime} showSyncInspector={false} />;
}

export function GraphExplorerPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col xl:overflow-hidden">
      <GraphRuntimeBootstrap>
        <GraphExplorerSurface />
      </GraphRuntimeBootstrap>
    </div>
  );
}
