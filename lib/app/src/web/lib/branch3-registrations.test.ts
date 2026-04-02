import { describe, expect, it } from "bun:test";

import {
  coreCatalogModuleReadScope,
  coreCatalogModuleReadScopeRegistration,
} from "@io/graph-module-core";
import {
  project,
  projectionMetadata,
  workflowReviewModuleReadScope,
  workflowReviewDependencyKeys,
  workflowReviewModuleReadScopeRegistration,
  workflowReviewRetainedProjectionProviderRegistration,
  workflowReviewSyncScopeRequest,
} from "@io/graph-module-workflow";

import {
  findWebAppModuleReadScopeBinding,
  getOnlyWebAppRetainedProjectionProviderForScope,
  listInstalledWebAppRetainedProjectionProviders,
  listWebAppRetainedProjectionProvidersForScope,
  planWebAppModuleReadScope,
  webAppModuleReadScopeBindings,
} from "./branch3-registrations.js";

describe("web app branch 3 registrations", () => {
  it("installs workflow review and core catalog scopes through one registry seam", () => {
    expect(
      webAppModuleReadScopeBindings.map((binding) => ({
        moduleId: binding.registration.definition.moduleId,
        scopeId: binding.registration.definition.scopeId,
        retainedProjectionProviderCount: binding.retainedProjectionProviders.length,
        syncProofKey: binding.syncProof?.key ?? null,
      })),
    ).toEqual([
      {
        moduleId: workflowReviewModuleReadScope.moduleId,
        scopeId: workflowReviewModuleReadScope.scopeId,
        retainedProjectionProviderCount: 1,
        syncProofKey: "workflow-review",
      },
      {
        moduleId: coreCatalogModuleReadScope.moduleId,
        scopeId: coreCatalogModuleReadScope.scopeId,
        retainedProjectionProviderCount: 0,
        syncProofKey: "core-catalog",
      },
    ]);

    const workflowPlan = planWebAppModuleReadScope(workflowReviewSyncScopeRequest, "policy:7");
    const corePlan = planWebAppModuleReadScope(
      {
        kind: "module",
        moduleId: coreCatalogModuleReadScope.moduleId,
        scopeId: coreCatalogModuleReadScope.scopeId,
      },
      "policy:7",
    );

    expect(workflowPlan).toMatchObject({
      registration: workflowReviewModuleReadScopeRegistration,
      scope: {
        kind: "module",
        moduleId: workflowReviewModuleReadScope.moduleId,
        scopeId: workflowReviewModuleReadScope.scopeId,
        definitionHash: workflowReviewModuleReadScope.definitionHash,
        policyFilterVersion: "policy:7",
      },
    });
    expect(workflowPlan?.binding.retainedProjectionProviders).toHaveLength(1);
    expect(corePlan).toMatchObject({
      registration: coreCatalogModuleReadScopeRegistration,
      scope: {
        kind: "module",
        moduleId: coreCatalogModuleReadScope.moduleId,
        scopeId: coreCatalogModuleReadScope.scopeId,
        definitionHash: coreCatalogModuleReadScope.definitionHash,
        policyFilterVersion: "policy:7",
      },
    });
    expect(corePlan?.binding.retainedProjectionProviders).toHaveLength(0);
  });

  it("dispatches retained projection lookup through the installed scope bindings", () => {
    expect(
      listWebAppRetainedProjectionProvidersForScope(workflowReviewModuleReadScope).map(
        (provider) => provider.registration.providerId,
      ),
    ).toEqual([workflowReviewRetainedProjectionProviderRegistration.providerId]);
    expect(listWebAppRetainedProjectionProvidersForScope(coreCatalogModuleReadScope)).toEqual([]);
    expect(
      getOnlyWebAppRetainedProjectionProviderForScope(workflowReviewModuleReadScope),
    ).toMatchObject({
      registration: workflowReviewRetainedProjectionProviderRegistration,
    });

    try {
      getOnlyWebAppRetainedProjectionProviderForScope(coreCatalogModuleReadScope);
      throw new Error("Expected missing retained provider lookup to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        'No retained projection provider is installed for scope "core/scope:core:catalog".',
      );
    }
  });

  it("fails closed for uninstalled scope planners while keeping installed bindings discoverable", () => {
    expect(
      findWebAppModuleReadScopeBinding({
        kind: "module",
        moduleId: workflowReviewModuleReadScope.moduleId,
        scopeId: workflowReviewModuleReadScope.scopeId,
        definitionHash: workflowReviewModuleReadScope.definitionHash,
        policyFilterVersion: "policy:7",
      }),
    ).toMatchObject({
      registration: workflowReviewModuleReadScopeRegistration,
    });
    expect(
      findWebAppModuleReadScopeBinding({
        kind: "module",
        moduleId: coreCatalogModuleReadScope.moduleId,
        scopeId: coreCatalogModuleReadScope.scopeId,
        definitionHash: coreCatalogModuleReadScope.definitionHash,
        policyFilterVersion: "policy:7",
      }),
    ).toMatchObject({
      registration: coreCatalogModuleReadScopeRegistration,
    });
    expect(
      findWebAppModuleReadScopeBinding({
        kind: "module",
        moduleId: workflowReviewModuleReadScope.moduleId,
        scopeId: "scope:workflow:missing",
      }),
    ).toBeUndefined();
    expect(
      planWebAppModuleReadScope(
        {
          kind: "module",
          moduleId: workflowReviewModuleReadScope.moduleId,
          scopeId: "scope:workflow:missing",
        },
        "policy:7",
      ),
    ).toBeUndefined();
  });

  it("keeps retained projection runtime callbacks installed once per provider", () => {
    const providers = listInstalledWebAppRetainedProjectionProviders();

    expect(providers).toHaveLength(1);
    expect(
      providers[0]?.createInvalidationEvent({
        graphId: "graph:global",
        sourceCursor: "web-authority:7",
        touchedTypeIds: [project.values.id],
      }),
    ).toEqual({
      eventId: "workflow-review:web-authority:7",
      graphId: "graph:global",
      sourceCursor: "web-authority:7",
      dependencyKeys: workflowReviewDependencyKeys,
      affectedProjectionIds: [
        projectionMetadata.projectBranchBoard.projectionId,
        projectionMetadata.branchCommitQueue.projectionId,
      ],
      affectedScopeIds: [workflowReviewModuleReadScope.scopeId],
      delivery: { kind: "cursor-advanced" },
    });
  });
});
