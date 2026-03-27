import {
  workflowReviewModuleReadScope,
  workflowReviewSyncScopeRequest,
} from "@io/graph-module-workflow";
import { matchesModuleReadScopeRequest } from "@io/graph-projection";
import { graphSyncScope, type SyncScope, type SyncScopeRequest } from "@io/graph-sync";

export { workflowReviewModuleReadScope, workflowReviewSyncScopeRequest };

export type WebSyncProofScopeKey = "graph" | "workflow-review";

export const webSyncProofScopeOptions = [
  {
    key: "graph",
    label: "Whole graph",
    description: "Bootstrap and recover against the full replicated graph.",
    requestedScope: graphSyncScope,
  },
  {
    key: "workflow-review",
    label: "Workflow review scope",
    description: "Bootstrap and refresh the first named workflow review scope.",
    requestedScope: workflowReviewSyncScopeRequest,
  },
] as const satisfies readonly {
  readonly key: WebSyncProofScopeKey;
  readonly label: string;
  readonly description: string;
  readonly requestedScope: SyncScopeRequest;
}[];

export function isWebSyncProofScopeKey(value: unknown): value is WebSyncProofScopeKey {
  return value === "graph" || value === "workflow-review";
}

export function resolveWebSyncProofRequestedScope(
  key: WebSyncProofScopeKey | undefined,
): SyncScopeRequest {
  return key === "workflow-review" ? workflowReviewSyncScopeRequest : graphSyncScope;
}

export function resolveWebSyncProofScopeKey(
  scope: SyncScope | SyncScopeRequest,
): WebSyncProofScopeKey {
  return matchesModuleReadScopeRequest(scope, workflowReviewModuleReadScope)
    ? "workflow-review"
    : "graph";
}
