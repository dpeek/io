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

const canonicalGraphSubpaths = ["./graph", "./graph/modules/workflow"] as const;

const retiredGraphSubpaths = [
  "./graph/graph/*",
  "./graph/modules/*",
  "./graph/adapters/*",
  "./graph/adapters/react-dom",
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
  "fieldSecretMetadataVisibility",
  "graphFieldVisibilities",
  "graphFieldWritePolicies",
  "isGraphFieldVisibility",
  "isGraphFieldWritePolicy",
  "sanitizeSvgMarkup",
] as const;

const forbiddenRootAuthoringExports = [
  "defineEnum",
  "defineReferenceField",
  "defineScalar",
  "defineSecretField",
  "defineType",
  "existingEntityReferenceField",
  "existingEntityReferenceFieldMeta",
  "readDefinitionIconId",
] as const;

const requiredGraphModuleExports = [
  "defineDefaultEnumTypeModule",
  "defineEnum",
  "defineEnumModule",
  "defineReferenceField",
  "defineScalar",
  "defineScalarModule",
  "defineSecretField",
  "defineType",
  "defineValidatedStringTypeModule",
  "entityReferenceComboboxEditorKind",
  "entityReferenceListDisplayKind",
  "existingEntityReferenceField",
  "existingEntityReferenceFieldMeta",
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
  "PredicateFieldEditor",
  "PredicateFieldView",
  "SvgMarkup",
  "SvgPreview",
  "createWebFieldResolver",
  "createWebFilterResolver",
  "defaultWebFieldResolver",
  "defaultWebFilterResolver",
  "genericWebFieldEditorCapabilities",
  "genericWebFieldViewCapabilities",
  "genericWebFilterOperandEditorCapabilities",
] as const;

const requiredCoreModuleExports = [
  "core",
  "country",
  "stringTypeModule",
  "moneyTypeModule",
  "rangeTypeModule",
  "rateTypeModule",
  "coreGraphBootstrapOptions",
  "resolveDefinitionIconId",
  "unknownIconSeed",
] as const;

const requiredCoreReactDomExports = ["GraphIcon", ...requiredReactDomExports] as const;

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

  it("keeps the root and module-authoring surfaces focused", async () => {
    const [rootExports, moduleExports] = await Promise.all([
      import("@io/core/graph"),
      import("@io/graph-module"),
    ]);

    expectNamedExports(rootExports, requiredRootExports);
    expectNamedExports(moduleExports, requiredGraphModuleExports);

    for (const name of forbiddenRootModuleExports) {
      expect(Object.keys(rootExports)).not.toContain(name);
    }
    for (const name of forbiddenProjectionContractValueExports) {
      expect(Object.keys(rootExports)).not.toContain(name);
    }
    for (const name of forbiddenRootAuthoringExports) {
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
    expect(Object.keys(moduleExports)).not.toContain("applyIdMap");
    expect(Object.keys(moduleExports)).not.toContain("authorizeRead");
    expect(Object.keys(moduleExports)).not.toContain("bootstrap");
    expect(Object.keys(moduleExports)).not.toContain("core");
    expect(Object.keys(moduleExports)).not.toContain("createGraphClient");
    expect(Object.keys(moduleExports)).not.toContain("createStore");
    expect(Object.keys(moduleExports)).not.toContain("workflow");
    const retiredDefSubpath = "@io/core/graph/def";
    await expect(import(retiredDefSubpath)).rejects.toThrow();
    const retiredRuntimeSubpath = "@io/core/graph/runtime";
    await expect(import(retiredRuntimeSubpath)).rejects.toThrow();
    const retiredAuthoritySubpath = "@io/core/graph/authority";
    await expect(import(retiredAuthoritySubpath)).rejects.toThrow();
    const retiredReactDomAdapterSubpath = "@io/core/graph/adapters/react-dom";
    await expect(import(retiredReactDomAdapterSubpath)).rejects.toThrow();
    const retiredReactDomSubpath = "@io/core/graph/react-dom";
    await expect(import(retiredReactDomSubpath)).rejects.toThrow();

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

  it("keeps graph-react host-neutral while module-core owns the DOM defaults", async () => {
    const [graphReactExports, coreReactDomExports] = await Promise.all([
      import("@io/graph-react"),
      import("@io/graph-module-core/react-dom"),
    ]);

    expectNamedExports(graphReactExports, requiredGraphReactExports);
    expect(Object.keys(graphReactExports)).not.toContain("GraphIcon");
    expect(Object.keys(graphReactExports)).not.toContain("SvgMarkup");
    expectNamedExports(coreReactDomExports, requiredCoreReactDomExports);
    expect(Object.keys(coreReactDomExports)).not.toContain("GraphMutationRuntimeProvider");
    expect(Object.keys(coreReactDomExports)).not.toContain("GraphRuntimeProvider");
    expect(Object.keys(coreReactDomExports)).not.toContain("createGraphFieldResolver");
    expect(Object.keys(coreReactDomExports)).not.toContain("createGraphFilterResolver");
    const retiredReactDomPackage = "@io/graph-react-dom";
    await expect(import(retiredReactDomPackage)).rejects.toThrow();
  });

  it("keeps the canonical module entry surfaces explicit", async () => {
    const [coreModuleExports, coreReactDomExports, workflowExports] = await Promise.all([
      import("@io/graph-module-core"),
      import("@io/graph-module-core/react-dom"),
      import("@io/core/graph/modules/workflow"),
    ]);

    expectNamedExports(coreModuleExports, requiredCoreModuleExports);
    expectNamedExports(coreReactDomExports, requiredCoreReactDomExports);
    expect(Object.keys(coreModuleExports)).not.toContain("workflow");
    expect(Object.keys(coreModuleExports)).not.toContain("FilterOperandEditor");
    expect(Object.keys(coreModuleExports)).not.toContain("GraphIcon");
    expect(Object.keys(coreModuleExports)).not.toContain("PredicateFieldView");
    expect(Object.keys(coreModuleExports)).not.toContain("SvgPreview");
    const retiredModulesSubpath = "@io/core/graph/modules";
    await expect(import(retiredModulesSubpath)).rejects.toThrow();
    const retiredCoreModulesSubpath = "@io/core/graph/modules/core";
    await expect(import(retiredCoreModulesSubpath)).rejects.toThrow();
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
