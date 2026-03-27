import { describe, expect, it } from "bun:test";

import type { WorkflowReviewLiveRegistration } from "./workflow-live-transport.js";
import type {
  WorkflowReviewLiveSync,
  WorkflowReviewLiveSyncPollResult,
} from "./workflow-review-live-sync.js";
import {
  startWorkflowReviewRefreshLoop,
  type WorkflowReviewRefreshLoopOptions,
} from "./workflow-review-refresh.js";

function createPollResult(
  action: WorkflowReviewLiveSyncPollResult["action"],
): WorkflowReviewLiveSyncPollResult {
  return {
    action,
    invalidations: [],
    live: {
      active: true,
      invalidations: [],
      scopeId: "scope:workflow:review",
      sessionId: "session:test",
    },
  };
}

function createRegistration(): WorkflowReviewLiveRegistration {
  return {
    definitionHash: "definition:workflow-review",
    dependencyKeys: [],
    expiresAt: "2026-03-26T10:05:00.000Z",
    policyFilterVersion: "policy:1",
    principalId: "principal:test",
    registrationId: "workflow-review:session:test:scope:workflow:review",
    scopeId: "scope:workflow:review",
    sessionId: "session:test",
  };
}

function createLiveSync(
  actions: WorkflowReviewLiveSyncPollResult["action"][],
  overrides: Partial<WorkflowReviewRefreshLoopOptions> = {},
): {
  calls: string[];
  liveSync: WorkflowReviewLiveSync;
  onRefresh: () => void;
  refreshes: number;
} {
  const calls: string[] = [];
  let refreshes = 0;
  let index = 0;

  return {
    calls,
    liveSync: {
      async poll() {
        calls.push("poll");
        const action = actions[index] ?? "none";
        index += 1;
        return createPollResult(action);
      },
      async register() {
        calls.push("register");
        return createRegistration();
      },
      async remove() {
        calls.push("remove");
        return {
          removed: true,
          scopeId: "scope:workflow:review",
          sessionId: "session:test",
        };
      },
    },
    onRefresh() {
      overrides.onRefresh?.();
      refreshes += 1;
    },
    get refreshes() {
      return refreshes;
    },
  };
}

describe("workflow review refresh loop", () => {
  it("registers once, refreshes on invalidation-driven actions, and removes on stop", async () => {
    const harness = createLiveSync(["none", "scoped-refresh", "reregister-and-scoped-refresh"]);
    const loop = await startWorkflowReviewRefreshLoop({
      liveSync: harness.liveSync,
      onRefresh: harness.onRefresh,
      pollIntervalMs: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 12));
    await loop.stop();

    expect(harness.calls[0]).toBe("register");
    expect(harness.calls).toContain("poll");
    expect(harness.calls.at(-1)).toBe("remove");
    expect(harness.refreshes).toBe(2);
  });

  it("surfaces polling failures through the optional error callback and keeps polling", async () => {
    const errors: unknown[] = [];
    const calls: string[] = [];
    let pollCount = 0;
    const liveSync: WorkflowReviewLiveSync = {
      async poll() {
        calls.push("poll");
        pollCount += 1;
        if (pollCount === 1) {
          throw new Error("poll failed");
        }
        return createPollResult("none");
      },
      async register() {
        calls.push("register");
        return createRegistration();
      },
      async remove() {
        calls.push("remove");
        return {
          removed: true,
          scopeId: "scope:workflow:review",
          sessionId: "session:test",
        };
      },
    };

    const loop = await startWorkflowReviewRefreshLoop({
      liveSync,
      onError(error) {
        errors.push(error);
      },
      onRefresh() {
        throw new Error("refresh should not run");
      },
      pollIntervalMs: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 12));
    await loop.stop();

    expect(errors).toHaveLength(1);
    expect(calls[0]).toBe("register");
    expect(calls.filter((call) => call === "poll").length).toBeGreaterThan(1);
    expect(calls.at(-1)).toBe("remove");
  });
});
