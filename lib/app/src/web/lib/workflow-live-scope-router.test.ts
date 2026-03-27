import { describe, expect, it } from "bun:test";

import { defineInvalidationEvent } from "@io/graph-projection";

import { createWorkflowReviewLiveScopeRouter } from "./workflow-live-scope-router.js";
import type { WorkflowReviewLiveRegistrationTarget } from "./workflow-live-transport.js";

function createRegistrationTarget(
  overrides: Partial<WorkflowReviewLiveRegistrationTarget> = {},
): WorkflowReviewLiveRegistrationTarget {
  return {
    sessionId: "session:review-1",
    principalId: "principal:reviewer-1",
    scopeId: "scope:workflow:review",
    definitionHash: "scope-def:workflow:review:v1",
    policyFilterVersion: "policy:0",
    dependencyKeys: [
      "scope:workflow:review",
      "projection:workflow:project-branch-board",
      "projection:workflow:branch-commit-queue",
    ],
    ...overrides,
  };
}

function createWorkflowReviewInvalidation() {
  return defineInvalidationEvent({
    eventId: "workflow-review:cursor:1",
    graphId: "graph:test",
    sourceCursor: "web-authority:1",
    dependencyKeys: ["scope:workflow:review", "projection:workflow:project-branch-board"],
    affectedScopeIds: ["scope:workflow:review"],
    delivery: { kind: "cursor-advanced" },
  });
}

describe("workflow review live scope router", () => {
  it("registers and indexes workflow review registrations by session, scope, and dependency key", () => {
    const router = createWorkflowReviewLiveScopeRouter({
      now: () => new Date("2026-03-24T00:00:00.000Z"),
    });
    const registration = router.register(createRegistrationTarget());

    expect(registration).toEqual({
      registrationId: "workflow-review:session:review-1:scope:workflow:review",
      sessionId: "session:review-1",
      principalId: "principal:reviewer-1",
      scopeId: "scope:workflow:review",
      definitionHash: "scope-def:workflow:review:v1",
      policyFilterVersion: "policy:0",
      dependencyKeys: [
        "scope:workflow:review",
        "projection:workflow:project-branch-board",
        "projection:workflow:branch-commit-queue",
      ],
      expiresAt: "2026-03-24T00:01:00.000Z",
    });
    expect(router.registrationsForSession("session:review-1")).toEqual([registration]);
    expect(router.registrationsForScope("scope:workflow:review")).toEqual([registration]);
    expect(router.registrationsForDependencyKey("scope:workflow:review")).toEqual([registration]);
    expect(
      router.registrationsForDependencyKey("projection:workflow:project-branch-board"),
    ).toEqual([registration]);
  });

  it("renews an existing session scope registration without duplicating fan-out targets", () => {
    let now = new Date("2026-03-24T00:00:00.000Z");
    const router = createWorkflowReviewLiveScopeRouter({
      now: () => now,
    });
    const initial = router.register(createRegistrationTarget());

    now = new Date("2026-03-24T00:00:30.000Z");
    const renewed = router.register(createRegistrationTarget());

    expect(renewed.registrationId).toBe(initial.registrationId);
    expect(renewed.expiresAt).toBe("2026-03-24T00:01:30.000Z");
    expect(router.registrationsForSession("session:review-1")).toEqual([renewed]);
    expect(
      router.registrationsForDependencyKey("projection:workflow:project-branch-board"),
    ).toEqual([renewed]);
  });

  it("queues compatible invalidations for active registrations and drains them per session scope", () => {
    const router = createWorkflowReviewLiveScopeRouter({
      now: () => new Date("2026-03-24T00:00:00.000Z"),
    });
    const registration = router.register(createRegistrationTarget());
    const invalidation = createWorkflowReviewInvalidation();

    expect(router.publish(invalidation)).toEqual([registration]);
    expect(
      router.pull({
        sessionId: "session:review-1",
        scopeId: "scope:workflow:review",
      }),
    ).toEqual({
      active: true,
      invalidations: [invalidation],
      scopeId: "scope:workflow:review",
      sessionId: "session:review-1",
    });
    expect(
      router.pull({
        sessionId: "session:review-1",
        scopeId: "scope:workflow:review",
      }),
    ).toEqual({
      active: true,
      invalidations: [],
      scopeId: "scope:workflow:review",
      sessionId: "session:review-1",
    });
  });

  it("fans matching invalidations out to every registration that shares the dependency keys", () => {
    const router = createWorkflowReviewLiveScopeRouter({
      now: () => new Date("2026-03-24T00:00:00.000Z"),
    });
    const first = router.register(createRegistrationTarget());
    const second = router.register(
      createRegistrationTarget({
        sessionId: "session:review-2",
        principalId: "principal:reviewer-2",
      }),
    );
    router.register(
      createRegistrationTarget({
        scopeId: "scope:workflow:backlog",
        dependencyKeys: ["scope:workflow:backlog"],
      }),
    );
    const invalidation = createWorkflowReviewInvalidation();

    expect(router.publish(invalidation)).toEqual([first, second]);
    expect(
      router.pull({
        sessionId: first.sessionId,
        scopeId: first.scopeId,
      }),
    ).toEqual({
      active: true,
      invalidations: [invalidation],
      scopeId: first.scopeId,
      sessionId: first.sessionId,
    });
    expect(
      router.pull({
        sessionId: second.sessionId,
        scopeId: second.scopeId,
      }),
    ).toEqual({
      active: true,
      invalidations: [invalidation],
      scopeId: second.scopeId,
      sessionId: second.sessionId,
    });
    expect(
      router.pull({
        sessionId: "session:review-1",
        scopeId: "scope:workflow:backlog",
      }),
    ).toEqual({
      active: true,
      invalidations: [],
      scopeId: "scope:workflow:backlog",
      sessionId: "session:review-1",
    });
  });

  it("expires registrations and clears every index", () => {
    let now = new Date("2026-03-24T00:00:00.000Z");
    const router = createWorkflowReviewLiveScopeRouter({
      now: () => now,
      registrationTtlMs: 10_000,
    });
    const registration = router.register(createRegistrationTarget());

    now = new Date("2026-03-24T00:00:10.000Z");

    expect(router.expire()).toEqual([registration]);
    expect(router.registrationsForSession("session:review-1")).toEqual([]);
    expect(router.registrationsForScope("scope:workflow:review")).toEqual([]);
    expect(router.registrationsForDependencyKey("scope:workflow:review")).toEqual([]);
    expect(
      router.pull({
        sessionId: "session:review-1",
        scopeId: "scope:workflow:review",
      }),
    ).toEqual({
      active: false,
      invalidations: [],
      scopeId: "scope:workflow:review",
      sessionId: "session:review-1",
    });
  });

  it("removes registrations explicitly", () => {
    const router = createWorkflowReviewLiveScopeRouter({
      now: () => new Date("2026-03-24T00:00:00.000Z"),
    });
    router.register(createRegistrationTarget());

    expect(
      router.remove({
        sessionId: "session:review-1",
        scopeId: "scope:workflow:review",
      }),
    ).toBe(true);
    expect(
      router.remove({
        sessionId: "session:review-1",
        scopeId: "scope:workflow:review",
      }),
    ).toBe(false);
    expect(router.registrationsForSession("session:review-1")).toEqual([]);
  });

  it("treats router loss as a freshness-only reset that requires re-registration", () => {
    const firstRouter = createWorkflowReviewLiveScopeRouter({
      now: () => new Date("2026-03-24T00:00:00.000Z"),
    });
    const registration = firstRouter.register(createRegistrationTarget());
    const restartedRouter = createWorkflowReviewLiveScopeRouter({
      now: () => new Date("2026-03-24T00:00:05.000Z"),
    });

    expect(firstRouter.registrationsForSession("session:review-1")).toEqual([registration]);
    expect(restartedRouter.registrationsForSession("session:review-1")).toEqual([]);
    expect(restartedRouter.registrationsForScope("scope:workflow:review")).toEqual([]);
    expect(
      restartedRouter.pull({
        sessionId: "session:review-1",
        scopeId: "scope:workflow:review",
      }),
    ).toEqual({
      active: false,
      invalidations: [],
      scopeId: "scope:workflow:review",
      sessionId: "session:review-1",
    });
  });
});
