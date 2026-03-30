import { describe, expect, it } from "bun:test";

import { evaluateDecisionWriteRequest, type DecisionWriteRequest } from "./decision-write.js";

function createRequest(overrides: Partial<DecisionWriteRequest> = {}): DecisionWriteRequest {
  return {
    sessionId: "session:workflow-decision-01",
    decision: {
      kind: "plan",
      summary: "Persist the branch plan in the graph",
    },
    ...overrides,
  };
}

describe("decision write contract", () => {
  it("accepts plan decisions with a trimmed summary", () => {
    expect(
      evaluateDecisionWriteRequest(
        createRequest({
          decision: {
            kind: "plan",
            summary: "  Persist the branch plan in the graph  ",
          },
        }),
      ),
    ).toEqual({
      ok: true,
      decision: {
        kind: "plan",
        summary: "Persist the branch plan in the graph",
      },
    });
  });

  it("accepts blocker decisions with trimmed details", () => {
    expect(
      evaluateDecisionWriteRequest(
        createRequest({
          decision: {
            kind: "blocker",
            summary: "Await design review",
            details: "  Waiting on the workflow schema review before execution can continue.  ",
          },
        }),
      ),
    ).toEqual({
      ok: true,
      decision: {
        kind: "blocker",
        summary: "Await design review",
        details: "Waiting on the workflow schema review before execution can continue.",
      },
    });
  });

  it("rejects decisions without a non-empty summary", () => {
    expect(
      evaluateDecisionWriteRequest(
        createRequest({
          decision: {
            kind: "assumption",
            summary: "   ",
          },
        }),
      ),
    ).toEqual({
      ok: false,
      code: "summary-missing",
      message: "Workflow decision writes require a non-empty summary.",
    });
  });

  it("rejects blocker decisions without non-empty details", () => {
    expect(
      evaluateDecisionWriteRequest(
        createRequest({
          decision: {
            kind: "blocker",
            summary: "Await design review",
            details: "  ",
          },
        }),
      ),
    ).toEqual({
      ok: false,
      code: "details-missing",
      message: "Workflow blocker decisions require non-empty details.",
    });
  });
});
