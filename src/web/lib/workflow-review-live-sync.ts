import { type GraphClientSyncController } from "@io/graph-client";
import { workflowReviewModuleReadScope } from "@io/graph-module-workflow";
import { matchesModuleReadScopeRequest } from "@io/graph-projection";
import { type SyncPayload, type SyncState } from "@io/graph-sync";

import {
  requestWorkflowLive,
  type WorkflowLiveClientOptions,
  type WorkflowReviewLiveInvalidation,
  type WorkflowReviewLiveRegistration,
  type WorkflowReviewPullLiveResult,
  type WorkflowReviewRemoveLiveResponse,
} from "./workflow-live-transport.js";

export type WorkflowReviewLiveSyncPollAction =
  | "none"
  | "scoped-refresh"
  | "reregister-and-scoped-refresh";

export type WorkflowReviewLiveSyncPollResult = {
  readonly action: WorkflowReviewLiveSyncPollAction;
  readonly invalidations: readonly WorkflowReviewLiveInvalidation[];
  readonly live: WorkflowReviewPullLiveResult;
  readonly registration?: WorkflowReviewLiveRegistration;
  readonly syncResult?: SyncPayload;
};

export type WorkflowReviewLiveSync = {
  register(): Promise<WorkflowReviewLiveRegistration>;
  poll(): Promise<WorkflowReviewLiveSyncPollResult>;
  remove(): Promise<WorkflowReviewRemoveLiveResponse["result"]>;
};

type WorkflowReviewLiveSyncController = Pick<GraphClientSyncController, "getState" | "sync">;

function isWorkflowReviewLiveState(state: Pick<SyncState, "requestedScope" | "scope">): boolean {
  return (
    matchesModuleReadScopeRequest(state.requestedScope, workflowReviewModuleReadScope) &&
    matchesModuleReadScopeRequest(state.scope, workflowReviewModuleReadScope)
  );
}

function readWorkflowReviewLiveCursor(
  state: Pick<SyncState, "requestedScope" | "scope"> & {
    cursor?: SyncState["cursor"];
  },
) {
  if (!isWorkflowReviewLiveState(state)) {
    throw new Error(
      "Workflow review live sync requires the shipped workflow-review scope to stay active.",
    );
  }
  if (typeof state.cursor !== "string" || state.cursor.length === 0) {
    throw new Error(
      "Workflow review live sync requires the current scoped workflow-review cursor.",
    );
  }

  return state.cursor;
}

function readWorkflowReviewLiveScopeId(state: Pick<SyncState, "requestedScope" | "scope">): string {
  if (!isWorkflowReviewLiveState(state)) {
    throw new Error(
      "Workflow review live sync requires the shipped workflow-review scope to stay active.",
    );
  }

  return workflowReviewModuleReadScope.scopeId;
}

function hasCursorAdvancedInvalidation(
  invalidations: readonly WorkflowReviewLiveInvalidation[],
): boolean {
  return invalidations.some((invalidation) => invalidation.delivery.kind === "cursor-advanced");
}

export function createWorkflowReviewLiveSync(
  sync: WorkflowReviewLiveSyncController,
  options: WorkflowLiveClientOptions = {},
): WorkflowReviewLiveSync {
  async function register(): Promise<WorkflowReviewLiveRegistration> {
    const cursor = readWorkflowReviewLiveCursor(sync.getState());
    const response = await requestWorkflowLive(
      {
        kind: "workflow-review-register",
        cursor,
      },
      options,
    );

    return response.result;
  }

  return {
    register,
    async poll() {
      const scopeId = readWorkflowReviewLiveScopeId(sync.getState());
      const response = await requestWorkflowLive(
        {
          kind: "workflow-review-pull",
          scopeId,
        },
        options,
      );
      const live = response.result;

      if (!live.active) {
        const registration = await register();
        const syncResult = await sync.sync();
        return Object.freeze({
          action: "reregister-and-scoped-refresh",
          invalidations: Object.freeze([...live.invalidations]),
          live,
          registration,
          syncResult,
        });
      }

      if (hasCursorAdvancedInvalidation(live.invalidations)) {
        const syncResult = await sync.sync();
        return Object.freeze({
          action: "scoped-refresh",
          invalidations: Object.freeze([...live.invalidations]),
          live,
          syncResult,
        });
      }

      return Object.freeze({
        action: "none",
        invalidations: Object.freeze([...live.invalidations]),
        live,
      });
    },
    async remove() {
      const scopeId = readWorkflowReviewLiveScopeId(sync.getState());
      const response = await requestWorkflowLive(
        {
          kind: "workflow-review-remove",
          scopeId,
        },
        options,
      );

      return response.result;
    },
  };
}
