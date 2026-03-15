import type { WorkspaceManagementRuntime } from "@io/graph/react";
import { WorkspaceManagementSurface } from "@io/graph/react-dom";

import { useAppRuntime } from "../../web/runtime.js";

export function WorkspaceManagementScreen({
  runtime,
}: {
  readonly runtime?: WorkspaceManagementRuntime;
}) {
  const resolvedRuntime = runtime ?? useAppRuntime();
  return <WorkspaceManagementSurface runtime={resolvedRuntime} />;
}
