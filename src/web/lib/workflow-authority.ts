import { type GraphStore } from "@io/core/graph";
import {
  type WorkflowMutationAction,
  type WorkflowMutationResult,
} from "@io/core/graph/modules/ops/workflow";
import { type AuthoritativeGraphWriteResult, type GraphWriteTransaction } from "@io/graph-kernel";

import type {
  WebAppAuthorityCommandOptions,
  WebAppAuthorityTransactionOptions,
} from "./authority.js";
import { dispatchWorkflowAggregateMutation } from "./workflow-authority-aggregate-handlers.js";
import {
  attachWorkflowCommitResult,
  createWorkflowCommit,
  createWorkflowRepositoryCommit,
  setWorkflowCommitState,
  updateWorkflowCommit,
} from "./workflow-authority-commit-handlers.js";
import {
  WorkflowMutationError,
  planWorkflowMutation,
  type ProductGraphClient,
} from "./workflow-mutation-helpers.js";

type WorkflowMutationAuthority = {
  readonly store: GraphStore;
  applyTransaction(
    transaction: GraphWriteTransaction,
    options: WebAppAuthorityTransactionOptions,
  ): Promise<AuthoritativeGraphWriteResult>;
};

export async function runWorkflowMutationCommand(
  input: WorkflowMutationAction,
  authority: WorkflowMutationAuthority,
  options: WebAppAuthorityCommandOptions,
): Promise<WorkflowMutationResult> {
  const planned = planWorkflowMutation(
    authority.store.snapshot(),
    `workflow-mutation:${input.action}:${Date.now()}`,
    (graph, store) => mutateWorkflow(graph, store, input),
  );

  if (!planned.changed) return planned.result;

  const write = await authority.applyTransaction(planned.transaction, {
    authorization: options.authorization,
    writeScope: "server-command",
  });
  planned.result.cursor = write.cursor;
  planned.result.replayed = write.replayed;
  return planned.result;
}

function mutateWorkflow(
  graph: ProductGraphClient,
  store: GraphStore,
  input: WorkflowMutationAction,
): WorkflowMutationResult {
  const aggregateResult = dispatchWorkflowAggregateMutation(graph, store, input);
  if (aggregateResult) return aggregateResult;

  switch (input.action) {
    case "createCommit":
      return createWorkflowCommit(graph, store, input);
    case "updateCommit":
      return updateWorkflowCommit(graph, store, input);
    case "setCommitState":
      return setWorkflowCommitState(graph, store, input);
    case "createRepositoryCommit":
      return createWorkflowRepositoryCommit(graph, store, input);
    case "attachCommitResult":
      return attachWorkflowCommitResult(graph, store, input);
    default: {
      throw new WorkflowMutationError(400, "Unsupported workflow mutation action.");
    }
  }
}
