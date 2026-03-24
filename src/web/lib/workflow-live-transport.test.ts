import { describe, expect, it } from "bun:test";

import {
  requestWorkflowLive,
  webWorkflowLivePath,
  WorkflowLiveClientError,
  type WorkflowReviewPullLiveResponse,
  type WorkflowReviewRegisterLiveResponse,
  type WorkflowReviewRemoveLiveResponse,
} from "./workflow-live-transport.js";

describe("workflow live transport client", () => {
  it("posts workflow review live registrations to the shipped workflow live route", async () => {
    const payload = {
      kind: "workflow-review-register",
      result: {
        registrationId: "workflow-review:session:test:scope:ops/workflow:review",
        sessionId: "session:test",
        principalId: "principal:test",
        scopeId: "scope:ops/workflow:review",
        definitionHash: "scope-def:ops/workflow:review:v1",
        policyFilterVersion: "policy:0",
        dependencyKeys: [
          "scope:ops/workflow:review",
          "projection:ops/workflow:project-branch-board",
        ],
        expiresAt: "2026-03-24T00:01:00.000Z",
      },
    } satisfies WorkflowReviewRegisterLiveResponse;

    const response = await requestWorkflowLive(
      {
        kind: "workflow-review-register",
        cursor:
          "scope:kind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview&definitionHash=scope-def%3Aops%2Fworkflow%3Areview%3Av1&policyFilterVersion=policy%3A0&cursor=web-authority%3A1",
      },
      {
        fetch: async (input, init) => {
          expect(input).toBe(webWorkflowLivePath);
          expect(init?.method).toBe("POST");
          expect(init?.headers).toEqual({
            accept: "application/json",
            "content-type": "application/json",
          });
          expect(JSON.parse(String(init?.body))).toEqual({
            kind: "workflow-review-register",
            cursor:
              "scope:kind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview&definitionHash=scope-def%3Aops%2Fworkflow%3Areview%3Av1&policyFilterVersion=policy%3A0&cursor=web-authority%3A1",
          });

          return Response.json(payload);
        },
      },
    );

    expect(response).toEqual(payload);
  });

  it("surfaces workflow live transport failures with the stable failure code", async () => {
    await expect(
      requestWorkflowLive(
        {
          kind: "workflow-review-register",
          cursor:
            "scope:kind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview&definitionHash=scope-def%3Aops%2Fworkflow%3Areview%3Av1&policyFilterVersion=policy%3A999&cursor=web-authority%3A1",
        },
        {
          fetch: async () =>
            Response.json(
              {
                error:
                  "Workflow live registration cursor no longer matches the current workflow review policy filter.",
                code: "policy-changed",
              },
              { status: 409 },
            ),
        },
      ),
    ).rejects.toMatchObject({
      name: WorkflowLiveClientError.name,
      status: 409,
      code: "policy-changed",
    });
  });

  it("supports pulling queued workflow review invalidations", async () => {
    const payload = {
      kind: "workflow-review-pull",
      result: {
        active: true,
        invalidations: [
          {
            eventId: "workflow-review:cursor:2",
            graphId: "graph:test",
            sourceCursor: "web-authority:2",
            dependencyKeys: [
              "scope:ops/workflow:review",
              "projection:ops/workflow:project-branch-board",
            ],
            affectedScopeIds: ["scope:ops/workflow:review"],
            delivery: {
              kind: "cursor-advanced",
            },
          },
        ],
        scopeId: "scope:ops/workflow:review",
        sessionId: "session:test",
      },
    } satisfies WorkflowReviewPullLiveResponse;

    const response = await requestWorkflowLive(
      {
        kind: "workflow-review-pull",
        scopeId: "scope:ops/workflow:review",
      },
      {
        fetch: async (input, init) => {
          expect(input).toBe(webWorkflowLivePath);
          expect(init?.method).toBe("POST");
          expect(JSON.parse(String(init?.body))).toEqual({
            kind: "workflow-review-pull",
            scopeId: "scope:ops/workflow:review",
          });

          return Response.json(payload);
        },
      },
    );

    expect(response).toEqual(payload);
  });

  it("supports workflow live removals against an explicit base URL", async () => {
    const payload = {
      kind: "workflow-review-remove",
      result: {
        removed: true,
        scopeId: "scope:ops/workflow:review",
        sessionId: "session:test",
      },
    } satisfies WorkflowReviewRemoveLiveResponse;

    const response = await requestWorkflowLive(
      {
        kind: "workflow-review-remove",
        scopeId: "scope:ops/workflow:review",
      },
      {
        url: "https://web.local/app/",
        fetch: async (input) => {
          expect(input).toBe("https://web.local/api/workflow-live");
          return Response.json(payload);
        },
      },
    );

    expect(response).toEqual(payload);
  });
});
