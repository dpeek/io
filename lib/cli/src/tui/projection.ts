import {
  createWorkflowProjectionIndex,
  type CommitQueueScopeQuery,
  type CommitQueueScopeResult,
  type ProjectBranchScopeQuery,
  type ProjectBranchScopeResult,
  type WorkflowProjectionIndex,
  type WorkflowProjectionIndexOptions,
  projectionSchema,
} from "@io/graph-module-workflow";
import { useGraphQuery, type GraphRuntime } from "@io/graph-react";
import { useMemo } from "react";

type WorkflowProjectionSchema = typeof projectionSchema;

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
