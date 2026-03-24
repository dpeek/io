import { describe, expect, it } from "bun:test";

import { core } from "../../core.js";
import {
  compileWorkflowReviewScopeDependencyKeys,
  compileWorkflowReviewWriteDependencyKeys,
  createWorkflowReviewInvalidationEvent,
  workflowBranchCommitQueueProjection,
  workflowBranchCommitQueueProjectionDependencyKey,
  workflowProjectBranchBoardProjection,
  workflowProjectBranchBoardProjectionDependencyKey,
  workflowReviewDependencyKeys,
  workflowReviewModuleReadScope,
  workflowReviewScopeDependencyKey,
} from "./projection.js";
import { agentSession, workflowBranch } from "./type.js";

function resolvedTypeId(typeDef: {
  readonly values: { readonly id?: string; readonly key: string };
}) {
  return typeDef.values.id ?? typeDef.values.key;
}

describe("workflow review invalidation contracts", () => {
  it("compiles one explicit dependency-key set for the workflow review scope", () => {
    expect(compileWorkflowReviewScopeDependencyKeys()).toEqual(workflowReviewDependencyKeys);
    expect(workflowProjectBranchBoardProjection.dependencyKeys).toEqual([
      workflowProjectBranchBoardProjectionDependencyKey,
      workflowReviewScopeDependencyKey,
    ]);
    expect(workflowBranchCommitQueueProjection.dependencyKeys).toEqual([
      workflowBranchCommitQueueProjectionDependencyKey,
      workflowReviewScopeDependencyKey,
    ]);
  });

  it("conservatively invalidates the review scope for workflow writes", () => {
    expect(
      compileWorkflowReviewWriteDependencyKeys({
        touchedTypeIds: [resolvedTypeId(workflowBranch)],
      }),
    ).toEqual(workflowReviewDependencyKeys);
    expect(
      compileWorkflowReviewWriteDependencyKeys({
        touchedTypeIds: [resolvedTypeId(core.principal)],
      }),
    ).toEqual([]);
    expect(
      compileWorkflowReviewWriteDependencyKeys({
        touchedTypeIds: [resolvedTypeId(core.principal), resolvedTypeId(agentSession)],
      }),
    ).toEqual(workflowReviewDependencyKeys);
  });

  it("builds cursor-advanced invalidation events for workflow review writes", () => {
    expect(
      createWorkflowReviewInvalidationEvent({
        eventId: "evt:workflow-review-1",
        graphId: "graph:global",
        sourceCursor: "cursor:workflow-1",
        touchedTypeIds: [resolvedTypeId(agentSession)],
      }),
    ).toEqual({
      eventId: "evt:workflow-review-1",
      graphId: "graph:global",
      sourceCursor: "cursor:workflow-1",
      dependencyKeys: workflowReviewDependencyKeys,
      affectedProjectionIds: [
        workflowProjectBranchBoardProjection.projectionId,
        workflowBranchCommitQueueProjection.projectionId,
      ],
      affectedScopeIds: [workflowReviewModuleReadScope.scopeId],
      delivery: { kind: "cursor-advanced" },
    });

    expect(
      createWorkflowReviewInvalidationEvent({
        eventId: "evt:workflow-review-2",
        graphId: "graph:global",
        sourceCursor: "cursor:workflow-2",
        touchedTypeIds: [resolvedTypeId(core.principal)],
      }),
    ).toBeUndefined();
  });
});
