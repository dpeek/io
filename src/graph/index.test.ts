import { describe, expect, it } from "bun:test";

import {
  probeAuthSubject,
  probeAuthenticatedSession,
  probeApprovedModulePermissionRecord,
  probeContractItem,
  probeDeniedModulePermissionRecord,
  probeModulePermissionRequests,
  probeModulePermissionApprovalRecords,
  probeModulePermissionGrant,
  probeModulePermissionRoleBinding,
  probeContractObjectView,
  probeContractSummaryPolicy,
  probeContractWorkflow,
  probeRevokedModulePermissionRecord,
  probeSaveContractItemCommand,
} from "./definition-contracts.probe.js";
import { edgeId } from "./index.js";

type GraphPackageJson = {
  exports: Record<string, string>;
};

const canonicalGraphSubpaths = [
  "./graph",
  "./graph/def",
  "./graph/modules",
  "./graph/modules/core",
  "./graph/modules/workflow",
  "./graph/adapters/react-dom",
] as const;

const retiredGraphSubpaths = [
  "./graph/graph/*",
  "./graph/modules/*",
  "./graph/adapters/*",
  "./graph/modules/app",
  "./graph/modules/app/topic",
  "./graph/modules/workflow/env-var",
  "./graph/modules/workflow/document",
  "./graph/react-dom",
  "./graph/react-opentui",
  "./graph/react",
  "./graph/runtime/react",
  "./graph/adapters/react",
  "./graph/adapters/react-opentui",
  "./graph/schema",
  "./graph/schema/core",
  "./graph/schema/ops",
  "./graph/schema/pkm",
  "./graph/schema/pkm/topic",
  "./graph/schema/test",
  "./graph/schema/app",
  "./graph/schema/app/topic",
  "./graph/schema/*",
  "./graph/runtime",
  "./graph/authority",
  "./graph/taxonomy/*",
] as const;

const requiredRootExports = [
  "createIdMap",
  "applyIdMap",
  "defineReferenceField",
  "defineSecretField",
  "defineType",
  "existingEntityReferenceField",
  "existingEntityReferenceFieldMeta",
  "fieldSecretMetadataVisibility",
  "graphFieldVisibilities",
  "graphFieldWritePolicies",
  "isGraphFieldVisibility",
  "isGraphFieldWritePolicy",
  "readDefinitionIconId",
  "sanitizeSvgMarkup",
] as const;

const requiredDefExports = [
  "defineEnum",
  "applyIdMap",
  "defineReferenceField",
  "defineScalar",
  "defineSecretField",
  "defineType",
  "readDefinitionIconId",
] as const;

const forbiddenRootModuleExports = [
  "bootstrap",
  "core",
  "createBootstrappedSnapshot",
  "workflow",
  "country",
  "stringTypeModule",
  "graphIconSeeds",
] as const;

const forbiddenProjectionContractValueExports = [
  "createDependencyKey",
  "createModuleReadScope",
  "createModuleReadScopeRequest",
  "createProjectionDependencyKey",
  "createScopeDependencyKey",
  "defineInvalidationEvent",
  "defineProjectionCatalog",
  "defineProjectionSpec",
  "findRetainedProjectionRecord",
  "isInvalidationEventCompatibleWithTarget",
  "matchesModuleReadScopeRequest",
  "projectionKinds",
  "projectionRebuildStrategies",
  "projectionSourceScopeKinds",
  "projectionVisibilityModes",
] as const;

const requiredGraphReactExports = [
  "GraphRuntimeProvider",
  "GraphMutationRuntimeProvider",
  "createGraphFieldResolver",
  "createGraphFilterResolver",
  "performValidatedMutation",
  "useGraphQuery",
  "useGraphRuntime",
  "useGraphSyncState",
  "useOptionalGraphRuntime",
  "usePredicateField",
] as const;

const requiredReactDomExports = [
  "FilterOperandEditor",
  "GraphIcon",
  "PredicateFieldEditor",
  "PredicateFieldView",
  "defaultWebFilterResolver",
] as const;

const requiredModulesExports = [
  "core",
  "country",
  "envVar",
  "graphIconSeeds",
  "workflow",
  "stringTypeModule",
  "document",
  "documentBlock",
  "documentBlockKind",
  "documentPlacement",
] as const;

const requiredEnvVarExports = [
  "buildSecretHandleName",
  "envVar",
  "envVarNameBlankMessage",
  "envVarNameInvalidMessage",
  "envVarNamePattern",
  "envVarSchema",
] as const;

const requiredWorkflowExports = [
  "compileWorkflowReviewScopeDependencyKeys",
  "compileWorkflowReviewWriteDependencyKeys",
  "createWorkflowReviewInvalidationEvent",
  "repositoryBranch",
  "repositoryCommit",
  "repositoryCommitLeaseState",
  "repositoryCommitState",
  "branchCommitQueueProjectionDependencyKey",
  "branch",
  "branchKeyPattern",
  "branchState",
  "branchStateTypeModule",
  "commit",
  "commitKeyPattern",
  "commitState",
  "commitStateTypeModule",
  "projectBranchBoardProjectionDependencyKey",
  "project",
  "projectBranchBoardProjection",
  "projectionMetadata",
  "workflowReviewDependencyKeys",
  "workflowReviewModuleReadScope",
  "workflowReviewScopeDependencyKey",
  "workflowReviewSyncScopeRequest",
  "projectKeyPattern",
  "repository",
  "repositoryKeyPattern",
  "workflowSchema",
] as const;

const requiredDocumentExports = [
  "document",
  "documentBlock",
  "documentBlockKind",
  "documentBlockKindType",
  "documentBlockKindTypeModule",
  "documentPlacement",
  "documentSchema",
] as const;

function expectNamedExports(
  moduleExports: Record<string, unknown>,
  names: readonly string[],
): void {
  expect(Object.keys(moduleExports)).toEqual(expect.arrayContaining([...names]));
}

describe("@io/core/graph package entry surfaces", () => {
  it("declares only the canonical graph package subpaths", async () => {
    const packageJson = (await Bun.file(
      new URL("../../package.json", import.meta.url),
    ).json()) as GraphPackageJson;

    const graphExports = Object.keys(packageJson.exports)
      .filter((subpath) => subpath === "./graph" || subpath.startsWith("./graph/"))
      .sort();

    expect(graphExports).toEqual([...canonicalGraphSubpaths].sort());

    for (const subpath of retiredGraphSubpaths) {
      expect(packageJson.exports[subpath]).toBeUndefined();
    }
  });

  it("keeps the root and schema-authoring surfaces focused", async () => {
    const [rootExports, defExports] = await Promise.all([
      import("@io/core/graph"),
      import("@io/core/graph/def"),
    ]);

    expectNamedExports(rootExports, requiredRootExports);
    expectNamedExports(defExports, requiredDefExports);

    for (const name of forbiddenRootModuleExports) {
      expect(Object.keys(rootExports)).not.toContain(name);
    }
    for (const name of forbiddenProjectionContractValueExports) {
      expect(Object.keys(rootExports)).not.toContain(name);
    }

    expect(Object.keys(rootExports)).not.toContain("FilterOperandEditor");
    expect(Object.keys(rootExports)).not.toContain("PredicateFieldView");
    expect(Object.keys(rootExports)).not.toContain("createJsonPersistedAuthoritativeGraph");
    expect(Object.keys(rootExports)).not.toContain("createPersistedAuthoritativeGraph");
    expect(Object.keys(rootExports)).not.toContain("createGraphClient");
    expect(Object.keys(rootExports)).not.toContain("createSyncedGraphClient");
    expect(Object.keys(rootExports)).not.toContain("defineWebPrincipalBootstrapPayload");
    expect(Object.keys(rootExports)).not.toContain("validateGraphStore");
    expect(Object.keys(rootExports)).not.toContain("authorizeRead");
    expect(Object.keys(rootExports)).not.toContain("authorizeWrite");
    expect(Object.keys(rootExports)).not.toContain("authorizeCommand");
    expect(Object.keys(defExports)).not.toContain("createStore");
    const retiredRuntimeSubpath = "@io/core/graph/runtime";
    await expect(import(retiredRuntimeSubpath)).rejects.toThrow();
    const retiredAuthoritySubpath = "@io/core/graph/authority";
    await expect(import(retiredAuthoritySubpath)).rejects.toThrow();

    expect(probeContractItem.kind).toBe("entity");
    expect(probeContractObjectView).toMatchObject({
      entity: probeContractItem.values.key,
      commands: [probeSaveContractItemCommand.key],
    });
    expect(probeContractItem.fields.summary).toMatchObject({
      authority: {
        write: "server-command",
        policy: {
          readAudience: "graph-member",
          writeAudience: "module-command",
          shareable: true,
          requiredCapabilities: ["probe.contract.write"],
        },
      },
    });
    expect(probeContractSummaryPolicy).toMatchObject({
      predicateId: edgeId(probeContractItem.fields.summary),
      transportVisibility: "replicated",
      requiredWriteScope: "server-command",
      readAudience: "graph-member",
      writeAudience: "module-command",
      shareable: true,
      requiredCapabilities: ["probe.contract.write"],
    });
    expect(probeContractWorkflow).toMatchObject({
      subjects: [probeContractItem.values.key],
      commands: [probeSaveContractItemCommand.key],
    });
    expect(probeContractWorkflow.steps).toHaveLength(2);
    expect(probeContractWorkflow.steps[0]).toMatchObject({
      objectView: probeContractObjectView.key,
    });
    expect(probeContractWorkflow.steps[1]).toMatchObject({
      command: probeSaveContractItemCommand.key,
    });
    expect(probeAuthSubject).toMatchObject({
      issuer: "better-auth",
      provider: "github",
      providerAccountId: "acct-probe-1",
      authUserId: "auth-user-probe-1",
    });
    expect(probeAuthenticatedSession).toMatchObject({
      sessionId: "session-probe-1",
      subject: probeAuthSubject,
    });
    expect(probeSaveContractItemCommand).toMatchObject({
      subject: probeContractItem.values.key,
      execution: "optimisticVerify",
      policy: {
        capabilities: ["probe.contract.write"],
        touchesPredicates: [
          { predicateId: edgeId(probeContractItem.fields.name) },
          { predicateId: probeContractSummaryPolicy.predicateId },
        ],
      },
    });
    expect(probeModulePermissionRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "probe.contract.read.summary",
          kind: "predicate-read",
          predicateIds: [probeContractSummaryPolicy.predicateId],
          required: true,
        }),
        expect.objectContaining({
          key: "probe.contract.command.save",
          kind: "command-execute",
          commandKeys: [probeSaveContractItemCommand.key],
          touchesPredicates: [
            edgeId(probeContractItem.fields.name),
            probeContractSummaryPolicy.predicateId,
          ],
        }),
        expect.objectContaining({
          key: "probe.contract.job.rebuild",
          kind: "background-job",
          jobKeys: ["probe.contract.rebuild-index"],
          required: false,
        }),
      ]),
    );
    expect(probeModulePermissionGrant).toMatchObject({
      resource: {
        kind: "module-permission",
        permissionKey: "probe.contract.read.summary",
      },
      target: {
        kind: "principal",
        principalId: "principal:probe",
      },
      status: "active",
    });
    expect(probeModulePermissionRoleBinding).toMatchObject({
      principalId: "principal:module:probe-contract",
      roleKey: "module:probe.contract.reviewer",
      status: "active",
    });
    expect(probeApprovedModulePermissionRecord).toMatchObject({
      moduleId: "probe.contract",
      permissionKey: "probe.contract.read.summary",
      status: "approved",
      lowerings: [
        expect.objectContaining({
          kind: "capability-grant",
          grant: expect.objectContaining({
            resource: {
              kind: "module-permission",
              permissionKey: "probe.contract.read.summary",
            },
          }),
        }),
        expect.objectContaining({
          kind: "role-binding",
          binding: expect.objectContaining({
            roleKey: "module:probe.contract.reviewer",
            status: "active",
          }),
        }),
      ],
    });
    expect(probeDeniedModulePermissionRecord).toMatchObject({
      moduleId: "probe.contract",
      permissionKey: "probe.contract.job.rebuild",
      status: "denied",
      lowerings: [],
    });
    expect(probeRevokedModulePermissionRecord).toMatchObject({
      moduleId: "probe.contract",
      permissionKey: "probe.contract.command.save",
      status: "revoked",
      revokedByPrincipalId: "principal:authority",
      lowerings: [
        expect.objectContaining({
          kind: "capability-grant",
          grant: expect.objectContaining({
            resource: {
              kind: "module-permission",
              permissionKey: "probe.contract.command.save",
            },
            status: "revoked",
          }),
        }),
        expect.objectContaining({
          kind: "role-binding",
          binding: expect.objectContaining({
            roleKey: "module:probe.contract.executor",
            status: "revoked",
          }),
        }),
      ],
    });
    expect(probeModulePermissionApprovalRecords).toEqual([
      probeApprovedModulePermissionRecord,
      probeDeniedModulePermissionRecord,
      probeRevokedModulePermissionRecord,
    ]);
  });

  it("keeps graph-react and react-dom focused on separate responsibilities", async () => {
    const [graphReactExports, reactDomAdapterExports] = await Promise.all([
      import("@io/graph-react"),
      import("@io/core/graph/adapters/react-dom"),
    ]);

    expectNamedExports(graphReactExports, requiredGraphReactExports);
    expect(Object.keys(graphReactExports)).not.toContain("GraphIcon");
    expectNamedExports(reactDomAdapterExports, requiredReactDomExports);
    expect(Object.keys(reactDomAdapterExports)).not.toContain("GraphMutationRuntimeProvider");
    expect(Object.keys(reactDomAdapterExports)).not.toContain("GraphRuntimeProvider");
  });

  it("keeps the canonical module entry surfaces explicit", async () => {
    const [moduleExports, coreExports, workflowExports] = await Promise.all([
      import("@io/core/graph/modules"),
      import("@io/core/graph/modules/core"),
      import("@io/core/graph/modules/workflow"),
    ]);

    expectNamedExports(moduleExports, requiredModulesExports);
    expect(Object.keys(coreExports)).toEqual(["core"]);
    expectNamedExports(workflowExports, [
      "workflow",
      ...requiredWorkflowExports,
      ...requiredEnvVarExports,
      ...requiredDocumentExports,
    ]);
    expectNamedExports(workflowExports, requiredWorkflowExports);
    expect(typeof workflowExports.workflow.envVar.values.id).toBe("string");
    expect(typeof workflowExports.workflow.project.values.id).toBe("string");
    expect(typeof workflowExports.workflow.document.values.id).toBe("string");
  });
});
