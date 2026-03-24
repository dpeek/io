import { describe, expect, it } from "bun:test";

import {
  createLiveSyncActiveScopeId,
  defineInvalidationEvent,
  type AuthorizationContext,
} from "@io/core/graph";
import { workflowReviewModuleReadScope } from "@io/core/graph/modules/ops/workflow";

import {
  type WebAppAuthority,
  WebAppAuthorityWorkflowLiveScopeError,
  WebAppAuthorityWorkflowReadError,
} from "./authority.js";
import { handleWorkflowLiveRequest, handleWorkflowReadRequest } from "./server-routes.js";
import { createWorkflowReviewLiveScopeRouter } from "./workflow-live-scope-router.js";
import type { WorkflowReviewLiveRegistrationTarget } from "./workflow-live-transport.js";

const authorization: AuthorizationContext = {
  graphId: "graph:test",
  principalId: "principal:test",
  principalKind: "service",
  sessionId: "session:test",
  roleKeys: ["graph:authority"],
  capabilityGrantIds: [],
  capabilityVersion: 0,
  policyVersion: 0,
};

function createWorkflowReadAuthority(
  overrides: {
    readonly readProjectBranchScope?: WebAppAuthority["readProjectBranchScope"];
    readonly readCommitQueueScope?: WebAppAuthority["readCommitQueueScope"];
    readonly planWorkflowReviewLiveRegistration?: WebAppAuthority["planWorkflowReviewLiveRegistration"];
  } = {},
): WebAppAuthority {
  return {
    readProjectBranchScope:
      overrides.readProjectBranchScope ??
      (() => {
        throw new Error("Unexpected project branch scope read.");
      }),
    readCommitQueueScope:
      overrides.readCommitQueueScope ??
      (() => {
        throw new Error("Unexpected commit queue scope read.");
      }),
    planWorkflowReviewLiveRegistration:
      overrides.planWorkflowReviewLiveRegistration ??
      (() => {
        throw new Error("Unexpected workflow live registration.");
      }),
  } as unknown as WebAppAuthority;
}

describe("workflow read server routes", () => {
  it("rejects malformed JSON bodies", async () => {
    const response = await handleWorkflowReadRequest(
      new Request("https://web.local/api/workflow-read", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{not-json",
      }),
      createWorkflowReadAuthority(),
      authorization,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Request body must be valid JSON.",
    });
  });

  it("fails clearly when workflow read inputs are missing required fields", async () => {
    const response = await handleWorkflowReadRequest(
      new Request("https://web.local/api/workflow-read", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "project-branch-scope",
          query: {
            limit: 5,
          },
        }),
      }),
      createWorkflowReadAuthority(),
      authorization,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Workflow read request "query.projectId" must be a non-empty string.',
    });
  });

  it("fails clearly when branch board ordering inputs are malformed", async () => {
    const response = await handleWorkflowReadRequest(
      new Request("https://web.local/api/workflow-read", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "project-branch-scope",
          query: {
            projectId: "project:io",
            order: [{ field: "rank", direction: "desc" }],
          },
        }),
      }),
      createWorkflowReadAuthority(),
      authorization,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        'Workflow read request "query.order"[0].field must be one of: queue-rank, updated-at, created-at, title, state.',
    });
  });

  it("maps stable workflow read failures onto the HTTP response", async () => {
    const response = await handleWorkflowReadRequest(
      new Request("https://web.local/api/workflow-read", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "commit-queue-scope",
          query: {
            branchId: "branch:missing",
          },
        }),
      }),
      createWorkflowReadAuthority({
        readCommitQueueScope() {
          throw new WebAppAuthorityWorkflowReadError(
            404,
            "branch-not-found",
            'Workflow branch "branch:missing" was not found in the current projection.',
          );
        },
      }),
      authorization,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Workflow branch "branch:missing" was not found in the current projection.',
      code: "branch-not-found",
    });
  });
});

describe("workflow live server routes", () => {
  it("fails clearly when workflow live inputs are missing the scoped cursor", async () => {
    const response = await handleWorkflowLiveRequest(
      new Request("https://web.local/api/workflow-live", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "workflow-review-register",
        }),
      }),
      createWorkflowReadAuthority(),
      createWorkflowReviewLiveScopeRouter(),
      authorization,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Workflow live request "cursor" must be a non-empty string.',
    });
  });

  it("registers the first workflow review live scope through the router", async () => {
    const router = createWorkflowReviewLiveScopeRouter({
      now: () => new Date("2026-03-24T00:00:00.000Z"),
    });
    const response = await handleWorkflowLiveRequest(
      new Request("https://web.local/api/workflow-live", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "workflow-review-register",
          cursor:
            "scope:kind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview&definitionHash=scope-def%3Aops%2Fworkflow%3Areview%3Av1&policyFilterVersion=policy%3A0&cursor=web-authority%3A1",
        }),
      }),
      createWorkflowReadAuthority({
        planWorkflowReviewLiveRegistration() {
          return {
            sessionId: "session:test",
            principalId: "principal:test",
            activeScopeId: createLiveSyncActiveScopeId({
              scopeId: workflowReviewModuleReadScope.scopeId,
              definitionHash: workflowReviewModuleReadScope.definitionHash,
              policyFilterVersion: "policy:0",
            }),
            scopeId: workflowReviewModuleReadScope.scopeId,
            definitionHash: workflowReviewModuleReadScope.definitionHash,
            policyFilterVersion: "policy:0",
            dependencyKeys: [
              "scope:ops/workflow:review",
              "projection:ops/workflow:project-branch-board",
            ],
          } satisfies WorkflowReviewLiveRegistrationTarget;
        },
      }),
      router,
      authorization,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      kind: "workflow-review-register",
      result: {
        registrationId:
          "workflow-review:session:test:scope:ops/workflow:review:scope-def:ops/workflow:review:v1:policy:0",
        sessionId: "session:test",
        principalId: "principal:test",
        activeScopeId: "scope:ops/workflow:review:scope-def:ops/workflow:review:v1:policy:0",
        scopeId: workflowReviewModuleReadScope.scopeId,
        definitionHash: workflowReviewModuleReadScope.definitionHash,
        policyFilterVersion: "policy:0",
        dependencyKeys: [
          "scope:ops/workflow:review",
          "projection:ops/workflow:project-branch-board",
        ],
        expiresAt: "2026-03-24T00:01:00.000Z",
      },
    });
    expect(router.registrationsForSession("session:test")).toHaveLength(1);
  });

  it("pulls queued workflow review invalidations through the same route", async () => {
    const router = createWorkflowReviewLiveScopeRouter({
      now: () => new Date("2026-03-24T00:00:00.000Z"),
    });
    router.register({
      sessionId: "session:test",
      principalId: "principal:test",
      activeScopeId: createLiveSyncActiveScopeId({
        scopeId: workflowReviewModuleReadScope.scopeId,
        definitionHash: workflowReviewModuleReadScope.definitionHash,
        policyFilterVersion: "policy:0",
      }),
      scopeId: workflowReviewModuleReadScope.scopeId,
      definitionHash: workflowReviewModuleReadScope.definitionHash,
      policyFilterVersion: "policy:0",
      dependencyKeys: ["scope:ops/workflow:review", "projection:ops/workflow:project-branch-board"],
    });
    const invalidation = defineInvalidationEvent({
      eventId: "workflow-review:cursor:2",
      graphId: "graph:test",
      sourceCursor: "web-authority:2",
      dependencyKeys: ["scope:ops/workflow:review", "projection:ops/workflow:project-branch-board"],
      affectedScopeIds: [workflowReviewModuleReadScope.scopeId],
      delivery: { kind: "cursor-advanced" },
    });
    router.publish(invalidation);

    const response = await handleWorkflowLiveRequest(
      new Request("https://web.local/api/workflow-live", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "workflow-review-pull",
          scopeId: workflowReviewModuleReadScope.scopeId,
        }),
      }),
      createWorkflowReadAuthority(),
      router,
      authorization,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      kind: "workflow-review-pull",
      result: {
        active: true,
        invalidations: [invalidation],
        scopeId: workflowReviewModuleReadScope.scopeId,
        sessionId: authorization.sessionId,
      },
    });
  });

  it("reports expired workflow live registrations as inactive so callers can re-register", async () => {
    let now = new Date("2026-03-24T00:00:00.000Z");
    const router = createWorkflowReviewLiveScopeRouter({
      now: () => now,
      registrationTtlMs: 1_000,
    });
    router.register({
      sessionId: "session:test",
      principalId: "principal:test",
      activeScopeId: createLiveSyncActiveScopeId({
        scopeId: workflowReviewModuleReadScope.scopeId,
        definitionHash: workflowReviewModuleReadScope.definitionHash,
        policyFilterVersion: "policy:0",
      }),
      scopeId: workflowReviewModuleReadScope.scopeId,
      definitionHash: workflowReviewModuleReadScope.definitionHash,
      policyFilterVersion: "policy:0",
      dependencyKeys: ["scope:ops/workflow:review", "projection:ops/workflow:project-branch-board"],
    });

    now = new Date("2026-03-24T00:00:01.000Z");
    router.publish(
      defineInvalidationEvent({
        eventId: "workflow-review:cursor:3",
        graphId: "graph:test",
        sourceCursor: "web-authority:3",
        dependencyKeys: [
          "scope:ops/workflow:review",
          "projection:ops/workflow:project-branch-board",
        ],
        affectedScopeIds: [workflowReviewModuleReadScope.scopeId],
        delivery: { kind: "cursor-advanced" },
      }),
    );

    const response = await handleWorkflowLiveRequest(
      new Request("https://web.local/api/workflow-live", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "workflow-review-pull",
          scopeId: workflowReviewModuleReadScope.scopeId,
        }),
      }),
      createWorkflowReadAuthority(),
      router,
      authorization,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      kind: "workflow-review-pull",
      result: {
        active: false,
        invalidations: [],
        scopeId: workflowReviewModuleReadScope.scopeId,
        sessionId: authorization.sessionId,
      },
    });
  });

  it("maps stable workflow live registration failures onto the HTTP response", async () => {
    const response = await handleWorkflowLiveRequest(
      new Request("https://web.local/api/workflow-live", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "workflow-review-register",
          cursor:
            "scope:kind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview&definitionHash=scope-def%3Aops%2Fworkflow%3Areview%3Av1&policyFilterVersion=policy%3A999&cursor=web-authority%3A1",
        }),
      }),
      createWorkflowReadAuthority({
        planWorkflowReviewLiveRegistration() {
          throw new WebAppAuthorityWorkflowLiveScopeError(
            409,
            "Workflow live registration cursor no longer matches the current policy filter.",
            "policy-changed",
          );
        },
      }),
      createWorkflowReviewLiveScopeRouter(),
      authorization,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Workflow live registration cursor no longer matches the current policy filter.",
      code: "policy-changed",
    });
  });
});
