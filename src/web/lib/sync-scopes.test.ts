import { describe, expect, it } from "bun:test";

import { graphSyncScope } from "@io/graph-sync";

import {
  isWebSyncProofScopeKey,
  resolveWebSyncProofRequestedScope,
  resolveWebSyncProofScopeKey,
  workflowReviewModuleReadScope,
  workflowReviewSyncScopeRequest,
} from "./sync-scopes.js";

describe("web sync proof scopes", () => {
  it("recognizes the supported route scope keys", () => {
    expect(isWebSyncProofScopeKey("graph")).toBe(true);
    expect(isWebSyncProofScopeKey("workflow-review")).toBe(true);
    expect(isWebSyncProofScopeKey("workflow-backlog")).toBe(false);
  });

  it("maps proof keys to the requested sync scope contract", () => {
    expect(resolveWebSyncProofRequestedScope("graph")).toBe(graphSyncScope);
    expect(resolveWebSyncProofRequestedScope("workflow-review")).toBe(
      workflowReviewSyncScopeRequest,
    );
    expect(resolveWebSyncProofRequestedScope(undefined)).toBe(graphSyncScope);
  });

  it("maps the first scoped proof back to the browser proof key", () => {
    expect(resolveWebSyncProofScopeKey(graphSyncScope)).toBe("graph");
    expect(resolveWebSyncProofScopeKey(workflowReviewSyncScopeRequest)).toBe("workflow-review");
    expect(
      resolveWebSyncProofScopeKey({
        kind: "module",
        moduleId: workflowReviewSyncScopeRequest.moduleId,
        scopeId: workflowReviewSyncScopeRequest.scopeId,
        definitionHash: workflowReviewModuleReadScope.definitionHash,
        policyFilterVersion: "policy:0",
      }),
    ).toBe("workflow-review");
  });
});
