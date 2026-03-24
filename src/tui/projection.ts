import { useMemo } from "react";

import { useGraphQuery, type GraphRuntime } from "../graph/adapters/react-opentui/index.js";
import {
  createWorkflowProjectionIndex,
  type CommitQueueScopeQuery,
  type CommitQueueScopeResult,
  type ProjectBranchScopeQuery,
  type ProjectBranchScopeResult,
  type WorkflowProjectionIndex,
  type WorkflowProjectionIndexOptions,
  workflowSchema,
} from "../graph/modules/ops/workflow/schema.js";

type WorkflowProjectionSchema = typeof workflowSchema;

export interface WorkflowProjectionQueryOptions {
  readonly options?: WorkflowProjectionIndexOptions;
  readonly runtime?: GraphRuntime<WorkflowProjectionSchema> | null;
}

export function useWorkflowProjectionIndex(
  options: WorkflowProjectionQueryOptions = {},
): WorkflowProjectionIndex {
  return useGraphQuery(
    (runtime: GraphRuntime<WorkflowProjectionSchema>) =>
      createWorkflowProjectionIndex(runtime.graph, options.options),
    {
      deps: [options.options],
      runtime: options.runtime,
    },
  );
}

export function useProjectBranchScope(
  query: ProjectBranchScopeQuery,
  options: WorkflowProjectionQueryOptions = {},
): ProjectBranchScopeResult {
  const projection = useWorkflowProjectionIndex(options);
  return useMemo(() => projection.readProjectBranchScope(query), [projection, query]);
}

export function useCommitQueueScope(
  query: CommitQueueScopeQuery,
  options: WorkflowProjectionQueryOptions = {},
): CommitQueueScopeResult {
  const projection = useWorkflowProjectionIndex(options);
  return useMemo(() => projection.readCommitQueueScope(query), [projection, query]);
}
