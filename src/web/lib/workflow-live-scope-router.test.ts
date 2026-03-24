import { describe, expect, it } from "bun:test";

import { createLiveSyncActiveScopeId, defineInvalidationEvent } from "@io/core/graph";

import { createWorkflowReviewLiveScopeRouter } from "./workflow-live-scope-router.js";
import type { WorkflowReviewLiveRegistrationTarget } from "./workflow-live-transport.js";

function createRegistrationTarget(
  overrides: Partial<WorkflowReviewLiveRegistrationTarget> = {},
): WorkflowReviewLiveRegistrationTarget {
  const scopeId = overrides.scopeId ?? "scope:ops/workflow:review";
  const definitionHash = overrides.definitionHash ?? "scope-def:ops/workflow:review:v1";
  const policyFilterVersion = overrides.policyFilterVersion ?? "policy:0";

  return {
    sessionId: "session:review-1",
    principalId: "principal:reviewer-1",
    activeScopeId:
      overrides.activeScopeId ??
      createLiveSyncActiveScopeId({
        scopeId,
        definitionHash,
        policyFilterVersion,
      }),
    scopeId,
    definitionHash,
    policyFilterVersion,
    dependencyKeys: [
      "scope:ops/workflow:review",
      "projection:ops/workflow:project-branch-board",
      "projection:ops/workflow:branch-commit-queue",
    ],
    ...overrides,
  };
}

function createWorkflowReviewInvalidation() {
  return defineInvalidationEvent({
    eventId: "workflow-review:cursor:1",
    graphId: "graph:test",
    sourceCursor: "web-authority:1",
    dependencyKeys: ["scope:ops/workflow:review", "projection:ops/workflow:project-branch-board"],
    affectedScopeIds: ["scope:ops/workflow:review"],
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
      registrationId:
        "workflow-review:session:review-1:scope:ops/workflow:review:scope-def:ops/workflow:review:v1:policy:0",
      sessionId: "session:review-1",
      principalId: "principal:reviewer-1",
      activeScopeId: "scope:ops/workflow:review:scope-def:ops/workflow:review:v1:policy:0",
      scopeId: "scope:ops/workflow:review",
      definitionHash: "scope-def:ops/workflow:review:v1",
      policyFilterVersion: "policy:0",
      dependencyKeys: [
        "scope:ops/workflow:review",
        "projection:ops/workflow:project-branch-board",
        "projection:ops/workflow:branch-commit-queue",
      ],
      expiresAt: "2026-03-24T00:01:00.000Z",
    });
    expect(router.registrationsForSession("session:review-1")).toEqual([registration]);
    expect(router.registrationsForScope("scope:ops/workflow:review")).toEqual([registration]);
    expect(router.registrationsForDependencyKey("scope:ops/workflow:review")).toEqual([
      registration,
    ]);
    expect(
      router.registrationsForDependencyKey("projection:ops/workflow:project-branch-board"),
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
      router.registrationsForDependencyKey("projection:ops/workflow:project-branch-board"),
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
        scopeId: "scope:ops/workflow:review",
      }),
    ).toEqual({
      active: true,
      invalidations: [invalidation],
      scopeId: "scope:ops/workflow:review",
      sessionId: "session:review-1",
    });
    expect(
      router.pull({
        sessionId: "session:review-1",
        scopeId: "scope:ops/workflow:review",
      }),
    ).toEqual({
      active: true,
      invalidations: [],
      scopeId: "scope:ops/workflow:review",
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
        scopeId: "scope:ops/workflow:backlog",
        dependencyKeys: ["scope:ops/workflow:backlog"],
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
        scopeId: "scope:ops/workflow:backlog",
      }),
    ).toEqual({
      active: true,
      invalidations: [],
      scopeId: "scope:ops/workflow:backlog",
      sessionId: "session:review-1",
    });
  });

  it("delivers matching invalidations directly to attached session scopes without queueing them", () => {
    const router = createWorkflowReviewLiveScopeRouter({
      now: () => new Date("2026-03-24T00:00:00.000Z"),
    });
    const registration = router.register(createRegistrationTarget());
    const invalidation = createWorkflowReviewInvalidation();
    const delivered: WorkflowReviewLiveRegistrationTarget[] = [];

    router.attachInvalidationDelivery({
      sessionId: registration.sessionId,
      scopeId: registration.scopeId,
      deliver({ invalidation: deliveredInvalidation, registration: deliveredRegistration }) {
        expect(deliveredInvalidation).toEqual(invalidation);
        delivered.push(deliveredRegistration);
      },
    });

    expect(router.publish(invalidation)).toEqual([registration]);
    expect(delivered).toEqual([registration]);
    expect(
      router.pull({
        sessionId: registration.sessionId,
        scopeId: registration.scopeId,
      }),
    ).toEqual({
      active: true,
      invalidations: [],
      scopeId: registration.scopeId,
      sessionId: registration.sessionId,
    });
  });

  it("drops only the failing scoped registration when attached delivery throws", () => {
    const router = createWorkflowReviewLiveScopeRouter({
      now: () => new Date("2026-03-24T00:00:00.000Z"),
    });
    const failing = router.register(createRegistrationTarget());
    const healthy = router.register(
      createRegistrationTarget({
        sessionId: "session:review-2",
        principalId: "principal:reviewer-2",
      }),
    );
    const invalidation = createWorkflowReviewInvalidation();

    router.attachInvalidationDelivery({
      sessionId: failing.sessionId,
      scopeId: failing.scopeId,
      deliver() {
        throw new Error("socket closed");
      },
    });

    expect(router.publish(invalidation)).toEqual([healthy]);
    expect(router.registrationsForSession(failing.sessionId)).toEqual([]);
    expect(
      router.pull({
        sessionId: failing.sessionId,
        scopeId: failing.scopeId,
      }),
    ).toEqual({
      active: false,
      invalidations: [],
      scopeId: failing.scopeId,
      sessionId: failing.sessionId,
    });
    expect(
      router.pull({
        sessionId: healthy.sessionId,
        scopeId: healthy.scopeId,
      }),
    ).toEqual({
      active: true,
      invalidations: [invalidation],
      scopeId: healthy.scopeId,
      sessionId: healthy.sessionId,
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
    expect(router.registrationsForScope("scope:ops/workflow:review")).toEqual([]);
    expect(router.registrationsForDependencyKey("scope:ops/workflow:review")).toEqual([]);
    expect(
      router.pull({
        sessionId: "session:review-1",
        scopeId: "scope:ops/workflow:review",
      }),
    ).toEqual({
      active: false,
      invalidations: [],
      scopeId: "scope:ops/workflow:review",
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
        scopeId: "scope:ops/workflow:review",
      }),
    ).toBe(true);
    expect(
      router.remove({
        sessionId: "session:review-1",
        scopeId: "scope:ops/workflow:review",
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
    expect(restartedRouter.registrationsForScope("scope:ops/workflow:review")).toEqual([]);
    expect(
      restartedRouter.pull({
        sessionId: "session:review-1",
        scopeId: "scope:ops/workflow:review",
      }),
    ).toEqual({
      active: false,
      invalidations: [],
      scopeId: "scope:ops/workflow:review",
      sessionId: "session:review-1",
    });
  });
});
