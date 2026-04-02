import {
  workflowReviewModuleReadScope,
  workflowReviewSyncScopeRequest,
} from "@io/graph-module-workflow";
import {
  findWebAppModuleReadScopeBinding,
  webAppModuleReadScopeBindings,
} from "./branch3-registrations.js";
import { graphSyncScope, type SyncScope, type SyncScopeRequest } from "@io/graph-sync";

export { workflowReviewModuleReadScope, workflowReviewSyncScopeRequest };

export type WebSyncProofScopeKey = "graph" | "workflow-review" | "core-catalog";

type WebSyncProofScopeOption = {
  readonly description: string;
  readonly key: WebSyncProofScopeKey;
  readonly label: string;
  readonly requestedScope: SyncScopeRequest;
};

const graphProofScopeOption = {
  key: "graph",
  label: "Whole graph",
  description: "Bootstrap and recover against the full replicated graph.",
  requestedScope: graphSyncScope,
} as const satisfies WebSyncProofScopeOption;

const registeredModuleProofScopeOptions = webAppModuleReadScopeBindings.flatMap((binding) => {
  const syncProof = binding.syncProof;
  if (!syncProof) {
    return [];
  }

  return [
    {
      key: syncProof.key as Exclude<WebSyncProofScopeKey, "graph">,
      label: syncProof.label,
      description: syncProof.description,
      requestedScope: {
        kind: "module",
        moduleId: binding.registration.definition.moduleId,
        scopeId: binding.registration.definition.scopeId,
      },
    } satisfies WebSyncProofScopeOption,
  ];
});

export const webSyncProofScopeOptions = [
  graphProofScopeOption,
  ...registeredModuleProofScopeOptions,
] as const satisfies readonly WebSyncProofScopeOption[];

export function isWebSyncProofScopeKey(value: unknown): value is WebSyncProofScopeKey {
  return (
    typeof value === "string" && webSyncProofScopeOptions.some((option) => option.key === value)
  );
}

export function resolveWebSyncProofRequestedScope(
  key: WebSyncProofScopeKey | undefined,
): SyncScopeRequest {
  return (
    webSyncProofScopeOptions.find((option) => option.key === key)?.requestedScope ?? graphSyncScope
  );
}

export function resolveWebSyncProofScopeKey(
  scope: SyncScope | SyncScopeRequest,
): WebSyncProofScopeKey {
  if (scope.kind !== "module") {
    return "graph";
  }

  const binding = findWebAppModuleReadScopeBinding(scope);
  if (!binding?.syncProof) {
    return "graph";
  }

  return binding.syncProof.key;
}
