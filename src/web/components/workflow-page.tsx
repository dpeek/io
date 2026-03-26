"use client";

import type { WorkflowRouteSearch } from "../lib/workflow-review-contract.js";
import { createWorkflowReviewStartupContract } from "../lib/workflow-review-contract.js";
import { GraphAccessGate } from "./auth-shell.js";
import { GraphRuntimeBootstrap } from "./graph-runtime-bootstrap.js";
import { WorkflowReviewPage } from "./workflow-review-page.js";

export function WorkflowPage({
  onSearchChange,
  search = {},
}: {
  readonly onSearchChange?: (search: WorkflowRouteSearch) => void | Promise<void>;
  readonly search?: WorkflowRouteSearch;
}) {
  const contract = createWorkflowReviewStartupContract(search);

  return (
    <GraphAccessGate
      description="Resolve an authenticated Better Auth session before booting the workflow review route against the shipped scoped sync and workflow read transports."
      title="Sign in to open workflow"
    >
      <GraphRuntimeBootstrap
        loadingDescription={contract.loading.bootstrapDescription}
        loadingTitle={contract.loading.bootstrapTitle}
        requestedScope={contract.graph.requestedScope}
      >
        <WorkflowReviewPage onSearchChange={onSearchChange} search={search} />
      </GraphRuntimeBootstrap>
    </GraphAccessGate>
  );
}
