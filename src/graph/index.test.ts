import { describe, expect, it } from "bun:test";

import { edgeId } from "./index.js";
import {
  probeAuthSubject,
  probeAuthenticatedSession,
  probeAuthorizationContext,
  probeContractItem,
  probeContractObjectView,
  probeContractSummaryPolicy,
  probeContractWorkflow,
  probeSaveContractItemCommand,
} from "./runtime/contracts.probe.js";

type GraphPackageJson = {
  exports: Record<string, string>;
};

const canonicalGraphSubpaths = [
  "./graph",
  "./graph/runtime",
  "./graph/runtime/react",
  "./graph/authority",
  "./graph/def",
  "./graph/modules",
  "./graph/modules/core",
  "./graph/modules/ops",
  "./graph/modules/ops/env-var",
  "./graph/modules/ops/workflow",
  "./graph/modules/pkm",
  "./graph/modules/pkm/topic",
  "./graph/adapters/react-dom",
  "./graph/adapters/react-opentui",
] as const;

const retiredGraphSubpaths = [
  "./graph/graph/*",
  "./graph/modules/*",
  "./graph/adapters/*",
  "./graph/modules/app",
  "./graph/modules/app/topic",
  "./graph/react-dom",
  "./graph/react-opentui",
  "./graph/react",
  "./graph/adapters/react",
  "./graph/schema",
  "./graph/schema/core",
  "./graph/schema/ops",
  "./graph/schema/ops/env-var",
  "./graph/schema/pkm",
  "./graph/schema/pkm/topic",
  "./graph/schema/test",
  "./graph/schema/app",
  "./graph/schema/app/topic",
  "./graph/schema/*",
  "./graph/taxonomy/*",
] as const;

const requiredRootExports = [
  "authorizeCommand",
  "authorizeRead",
  "authorizeWrite",
  "createIdMap",
  "defineNamespace",
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
  "sanitizeSvgMarkup",
] as const;

const requiredRuntimeExports = [
  "authorizeCommand",
  "authorizeRead",
  "authorizeWrite",
  "createPersistedAuthoritativeGraph",
  "createStore",
  "createTypeClient",
  "defineSecretField",
  "validateGraphStore",
] as const;

const requiredAuthorityExports = [
  "createJsonPersistedAuthoritativeGraph",
  "createJsonPersistedAuthoritativeGraphStorage",
  "createPersistedAuthoritativeGraph",
  "persistedAuthoritativeGraphStateVersion",
] as const;

const requiredDefExports = [
  "defineEnum",
  "defineNamespace",
  "defineReferenceField",
  "defineScalar",
  "defineSecretField",
  "defineType",
] as const;

const forbiddenRuntimeModuleExports = ["core", "country", "stringTypeModule"] as const;

const forbiddenRootModuleExports = [
  "core",
  "ops",
  "pkm",
  "country",
  "stringTypeModule",
  "graphIconSeeds",
] as const;

const requiredRuntimeReactExports = [
  "GraphMutationRuntimeProvider",
  "createWebFieldResolver",
  "performValidatedMutation",
  "usePredicateField",
] as const;

const requiredReactDomExports = [
  "FilterOperandEditor",
  "GraphIcon",
  "PredicateFieldEditor",
  "PredicateFieldView",
  "defaultWebFilterResolver",
] as const;

const requiredReactOpenTuiExports = [
  "GraphRuntimeProvider",
  "useGraphQuery",
  "useGraphRuntime",
  "useGraphSyncState",
  "useOptionalGraphRuntime",
] as const;

const requiredModulesExports = [
  "core",
  "country",
  "envVar",
  "graphIconSeeds",
  "ops",
  "pkm",
  "stringTypeModule",
  "topic",
  "topicKind",
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
  "repositoryBranch",
  "repositoryCommit",
  "repositoryCommitLeaseState",
  "repositoryCommitState",
  "workflowBranch",
  "workflowBranchKeyPattern",
  "workflowBranchState",
  "workflowBranchStateTypeModule",
  "workflowCommit",
  "workflowCommitKeyPattern",
  "workflowCommitState",
  "workflowCommitStateTypeModule",
  "workflowProject",
  "workflowProjectKeyPattern",
  "workflowRepository",
  "workflowRepositoryKeyPattern",
  "workflowSchema",
] as const;

const requiredTopicExports = [
  "topic",
  "topicKind",
  "topicKindType",
  "topicKindTypeModule",
  "topicSchema",
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

  it("keeps the root, runtime, authority, and schema-authoring surfaces focused", async () => {
    const [rootExports, runtimeExports, authorityExports, defExports] = await Promise.all([
      import("@io/core/graph"),
      import("@io/core/graph/runtime"),
      import("@io/core/graph/authority"),
      import("@io/core/graph/def"),
    ]);

    expectNamedExports(rootExports, requiredRootExports);
    expectNamedExports(runtimeExports, requiredRuntimeExports);
    expectNamedExports(authorityExports, requiredAuthorityExports);
    expectNamedExports(defExports, requiredDefExports);

    for (const name of forbiddenRootModuleExports) {
      expect(Object.keys(rootExports)).not.toContain(name);
    }
    for (const name of forbiddenRuntimeModuleExports) {
      expect(Object.keys(runtimeExports)).not.toContain(name);
    }

    expect(Object.keys(rootExports)).not.toContain("FilterOperandEditor");
    expect(Object.keys(rootExports)).not.toContain("PredicateFieldView");
    expect(Object.keys(rootExports)).not.toContain("createJsonPersistedAuthoritativeGraph");
    expect(Object.keys(runtimeExports)).not.toContain("sanitizeSvgMarkup");
    expect(Object.keys(defExports)).not.toContain("createStore");

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
    expect(probeAuthorizationContext).toMatchObject({
      graphId: "graph:probe",
      principalId: "principal:probe",
      principalKind: "human",
      sessionId: probeAuthenticatedSession.sessionId,
      roleKeys: ["graph:member"],
      capabilityGrantIds: ["grant:probe:1"],
      capabilityVersion: 2,
      policyVersion: 7,
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
  });

  it("keeps the canonical React runtime and host adapter entries separate", async () => {
    const [runtimeReactExports, reactDomAdapterExports, reactOpentuiAdapterExports] =
      await Promise.all([
        import("@io/core/graph/runtime/react"),
        import("@io/core/graph/adapters/react-dom"),
        import("@io/core/graph/adapters/react-opentui"),
      ]);

    expectNamedExports(runtimeReactExports, requiredRuntimeReactExports);
    expect(Object.keys(runtimeReactExports)).not.toContain("GraphIcon");

    expectNamedExports(reactDomAdapterExports, requiredReactDomExports);
    expect(Object.keys(reactDomAdapterExports)).not.toContain("GraphMutationRuntimeProvider");
    expectNamedExports(reactOpentuiAdapterExports, requiredReactOpenTuiExports);
    expect(Object.keys(reactOpentuiAdapterExports)).not.toContain("GraphMutationRuntimeProvider");
    expect(Object.keys(reactOpentuiAdapterExports)).not.toContain("useCommitQueueScope");
    expect(Object.keys(reactOpentuiAdapterExports)).not.toContain("useProjectBranchScope");
    expect(Object.keys(reactOpentuiAdapterExports)).not.toContain("useWorkflowProjectionIndex");
  });

  it("keeps the canonical module entry surfaces explicit", async () => {
    const [
      moduleExports,
      coreExports,
      opsExports,
      pkmExports,
      envVarExports,
      workflowExports,
      topicExports,
    ] = await Promise.all([
      import("@io/core/graph/modules"),
      import("@io/core/graph/modules/core"),
      import("@io/core/graph/modules/ops"),
      import("@io/core/graph/modules/pkm"),
      import("@io/core/graph/modules/ops/env-var"),
      import("@io/core/graph/modules/ops/workflow"),
      import("@io/core/graph/modules/pkm/topic"),
    ]);

    expectNamedExports(moduleExports, requiredModulesExports);
    expect(Object.keys(coreExports)).toEqual(["core"]);
    expect(Object.keys(opsExports)).toEqual(["ops"]);
    expect(Object.keys(pkmExports)).toEqual(["pkm"]);
    expectNamedExports(envVarExports, requiredEnvVarExports);
    expectNamedExports(workflowExports, requiredWorkflowExports);
    expectNamedExports(topicExports, requiredTopicExports);
    expect(typeof opsExports.ops.envVar.values.id).toBe("string");
    expect(typeof opsExports.ops.workflowProject.values.id).toBe("string");
    expect(typeof pkmExports.pkm.topic.values.id).toBe("string");
  });
});
