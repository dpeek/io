import { describe, expect, it } from "bun:test";

import { coreCatalogModuleReadScope } from "@io/graph-module-core";
import { graphSyncScope } from "@io/graph-sync";

import {
  isWebSyncProofScopeKey,
  resolveWebSyncProofRequestedScope,
  resolveWebSyncProofScopeKey,
  webSyncProofScopeOptions,
  workflowReviewModuleReadScope,
  workflowReviewSyncScopeRequest,
} from "./sync-scopes.js";

describe("web sync proof scopes", () => {
  it("lists the installed proof scopes from the shared registration seam", () => {
    expect(
      webSyncProofScopeOptions.map((option) => ({
        key: option.key,
        requestedScope: option.requestedScope,
      })),
    ).toEqual([
      {
        key: "graph",
        requestedScope: graphSyncScope,
      },
      {
        key: "workflow-review",
        requestedScope: workflowReviewSyncScopeRequest,
      },
      {
        key: "core-catalog",
        requestedScope: {
          kind: "module",
          moduleId: coreCatalogModuleReadScope.moduleId,
          scopeId: coreCatalogModuleReadScope.scopeId,
        },
      },
    ]);
  });

  it("recognizes the supported route scope keys", () => {
    expect(isWebSyncProofScopeKey("graph")).toBe(true);
    expect(isWebSyncProofScopeKey("workflow-review")).toBe(true);
    expect(isWebSyncProofScopeKey("core-catalog")).toBe(true);
    expect(isWebSyncProofScopeKey("workflow-backlog")).toBe(false);
  });

  it("maps proof keys to the requested sync scope contract", () => {
    expect(resolveWebSyncProofRequestedScope("graph")).toBe(graphSyncScope);
    expect(resolveWebSyncProofRequestedScope("workflow-review")).toEqual(
      workflowReviewSyncScopeRequest,
    );
    expect(resolveWebSyncProofRequestedScope("core-catalog")).toEqual({
      kind: "module",
      moduleId: coreCatalogModuleReadScope.moduleId,
      scopeId: coreCatalogModuleReadScope.scopeId,
    });
    expect(resolveWebSyncProofRequestedScope(undefined)).toBe(graphSyncScope);
  });

  it("maps registered module scopes back to the browser proof keys", () => {
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
    expect(
      resolveWebSyncProofScopeKey({
        kind: "module",
        moduleId: coreCatalogModuleReadScope.moduleId,
        scopeId: coreCatalogModuleReadScope.scopeId,
        definitionHash: coreCatalogModuleReadScope.definitionHash,
        policyFilterVersion: "policy:0",
      }),
    ).toBe("core-catalog");
  });
});
