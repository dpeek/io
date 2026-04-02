import { describe, expect, it } from "bun:test";

import { core, secretHandle } from "@io/graph-module-core";

import {
  document,
  documentBlock,
  documentBlockKind,
  documentPlacement,
  documentSchema,
} from "./document.js";
import {
  envVar,
  envVarNameBlankMessage,
  envVarNameInvalidMessage,
  envVarNamePattern,
  envVarSchema,
} from "./env-var.js";
import { workflow as canonicalWorkflow, workflowManifest } from "./index.js";
import * as workflowExports from "./index.js";
import {
  artifactWriteCommand,
  agentSessionAppendCommand,
  agentSession,
  agentSessionEvent,
  artifact,
  branch,
  commit,
  contextBundle,
  contextBundleEntry,
  decision,
  decisionWriteCommand,
  project,
  repository,
  repositoryBranch,
  repositoryCommit,
  workflowMutationCommand,
  workflowSchema,
} from "./schema.js";

const requiredEnvVarExports = [
  "buildSecretHandleName",
  "envVar",
  "envVarNameBlankMessage",
  "envVarNameInvalidMessage",
  "envVarNamePattern",
  "envVarSchema",
] as const;

const requiredWorkflowExports = [
  "agentSessionAppendCommand",
  "agentSessionAppendEventAckStatusValues",
  "agentSessionAppendFailureCodes",
  "agentSessionAppendRetainedRoleValues",
  "agentSessionAppendRetainedRuntimeStateValues",
  "agentSessionAppendSessionAckStatusValues",
  "artifactWriteCommand",
  "artifactWriteFailureCodes",
  "compileWorkflowReviewScopeDependencyKeys",
  "compileWorkflowReviewWriteDependencyKeys",
  "createAgentSessionAppendEventFingerprint",
  "evaluateArtifactWriteRequest",
  "decisionWriteCommand",
  "decisionWriteFailureCodes",
  "createWorkflowReviewInvalidationEvent",
  "evaluateDecisionWriteRequest",
  "evaluateAgentSessionAppendRequest",
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
  "workflowQuerySurfaceCatalog",
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

const validationContext = {
  event: "create" as const,
  phase: "local" as const,
  nodeId: "env-var-1",
  now: new Date("2026-01-01T00:00:00.000Z"),
  path: [] as const,
  field: "name",
  predicateKey: envVar.fields.name.key,
  range: envVar.fields.name.range,
  cardinality: envVar.fields.name.cardinality,
  previous: undefined,
  changedPredicateKeys: new Set<string>([envVar.fields.name.key]),
};

const replicatedServerCommandAuthority = {
  visibility: "replicated",
  write: "server-command",
} as const;

function resolvedTypeId(typeDef: { values: { key: string } }): string {
  const values = typeDef.values as { key: string; id?: string };
  return values.id ?? values.key;
}

function expectNamedExports(
  exportsObject: Record<string, unknown>,
  names: readonly string[],
): void {
  expect(Object.keys(exportsObject)).toEqual(expect.arrayContaining([...names]));
}

describe("workflow module entry surfaces", () => {
  it("exports the env-var slice from the canonical workflow module tree", () => {
    expect(envVarSchema).toEqual({
      envVar,
    });
    expect(String(envVar.fields.secret.range)).toBe(resolvedTypeId(secretHandle));
    expect(envVar.fields.secret.authority).toEqual({
      visibility: "replicated",
      write: "server-command",
      secret: {
        kind: "sealed-handle",
        metadataVisibility: "replicated",
        revealCapability: "secret:reveal",
        rotateCapability: "secret:rotate",
      },
    });
    expect(secretHandle.fields.version.authority).toEqual(replicatedServerCommandAuthority);
    expect(envVarNamePattern.test("OPENAI_API_KEY")).toBe(true);
    expect(
      envVar.fields.name.validate?.({
        ...validationContext,
        value: " ",
      }),
    ).toEqual({
      code: "string.blank",
      message: envVarNameBlankMessage,
    });
    expect(
      envVar.fields.name.validate?.({
        ...validationContext,
        value: "openai_api_key",
      }),
    ).toEqual({
      code: "envVar.name.invalid",
      message: envVarNameInvalidMessage,
    });
  });

  it("exports the document slice from the canonical workflow module tree", () => {
    expect(documentSchema).toEqual({
      document,
      documentBlockKind,
      documentBlock,
      documentPlacement,
    });
    expect(String(document.fields.tags.range)).toBe(resolvedTypeId(core.tag));
    expect(String(documentBlock.fields.document.range)).toBe(resolvedTypeId(document));
    expect(String(documentBlock.fields.kind.range)).toBe(resolvedTypeId(documentBlockKind));
    expect(String(documentBlock.fields.entity.range)).toBe(resolvedTypeId(core.node));
    expect(String(documentPlacement.fields.document.range)).toBe(resolvedTypeId(document));
    expect(String(documentPlacement.fields.parentPlacement.range)).toBe(
      resolvedTypeId(documentPlacement),
    );
    expect(documentPlacement.fields.parentPlacement.meta.reference).toEqual({
      selection: "existing-only",
      create: false,
      excludeSubject: true,
    });
  });

  it("exports the workflow slice from the canonical workflow module tree", () => {
    expect(workflowSchema).toEqual({
      project,
      repository,
      branchState: canonicalWorkflow.branchState,
      branch,
      commitState: canonicalWorkflow.commitState,
      commit,
      repositoryCommitState: canonicalWorkflow.repositoryCommitState,
      repositoryCommitLeaseState: canonicalWorkflow.repositoryCommitLeaseState,
      repositoryBranch,
      repositoryCommit,
      agentSessionSubjectKind: canonicalWorkflow.agentSessionSubjectKind,
      agentSessionKind: canonicalWorkflow.agentSessionKind,
      agentSessionRuntimeState: canonicalWorkflow.agentSessionRuntimeState,
      agentSession,
      agentSessionEventType: canonicalWorkflow.agentSessionEventType,
      agentSessionEventPhase: canonicalWorkflow.agentSessionEventPhase,
      agentSessionStatusCode: canonicalWorkflow.agentSessionStatusCode,
      agentSessionStatusFormat: canonicalWorkflow.agentSessionStatusFormat,
      agentSessionStream: canonicalWorkflow.agentSessionStream,
      agentSessionRawLineEncoding: canonicalWorkflow.agentSessionRawLineEncoding,
      agentSessionEvent,
      artifactKind: canonicalWorkflow.artifactKind,
      artifact,
      decisionKind: canonicalWorkflow.decisionKind,
      decision,
      contextBundle,
      contextBundleEntrySource: canonicalWorkflow.contextBundleEntrySource,
      contextBundleEntry,
    });
    expect(String(repository.fields.project.range)).toBe(resolvedTypeId(project));
    expect(String(branch.fields.project.range)).toBe(resolvedTypeId(project));
    expect(String(commit.fields.branch.range)).toBe(resolvedTypeId(branch));
    expect(String(repositoryBranch.fields.repository.range)).toBe(resolvedTypeId(repository));
    expect(String(repositoryCommit.fields.commit.range)).toBe(resolvedTypeId(commit));
    expect(String(agentSession.fields.branch.range)).toBe(resolvedTypeId(branch));
    expect(String(agentSession.fields.contextBundle.range)).toBe(resolvedTypeId(contextBundle));
    expect(String(agentSessionEvent.fields.session.range)).toBe(resolvedTypeId(agentSession));
    expect(String(artifact.fields.session.range)).toBe(resolvedTypeId(agentSession));
    expect(String(decision.fields.session.range)).toBe(resolvedTypeId(agentSession));
    expect(String(contextBundleEntry.fields.bundle.range)).toBe(resolvedTypeId(contextBundle));
    expect(workflowMutationCommand).toMatchObject({
      key: "workflow:mutation",
      execution: "serverOnly",
    });
    expect(agentSessionAppendCommand).toMatchObject({
      key: "workflow:agent-session-append",
      execution: "serverOnly",
    });
    expect(artifactWriteCommand).toMatchObject({
      key: "workflow:artifact-write",
      execution: "serverOnly",
    });
    expect(decisionWriteCommand).toMatchObject({
      key: "workflow:decision-write",
      execution: "serverOnly",
    });
  });

  it("keeps workflow explicit while core lives in @io/graph-module-core", () => {
    expectNamedExports(workflowExports, [
      "workflow",
      "workflowManifest",
      ...requiredWorkflowExports,
      ...requiredEnvVarExports,
      ...requiredDocumentExports,
    ]);
    expect("core" in workflowExports).toBe(false);
    expect("stringTypeModule" in workflowExports).toBe(false);
    expect("graphIconSeeds" in workflowExports).toBe(false);
    expect(typeof workflowExports.workflow.envVar.values.id).toBe("string");
    expect(typeof workflowExports.workflow.project.values.id).toBe("string");
    expect(typeof workflowExports.workflow.document.values.id).toBe("string");
    expect(canonicalWorkflow.document.values.key).toBe(document.values.key);
    expect(canonicalWorkflow.documentBlock.values.key).toBe(documentBlock.values.key);
    expect(canonicalWorkflow.documentBlockKind.values.key).toBe(documentBlockKind.values.key);
    expect(canonicalWorkflow.documentPlacement.values.key).toBe(documentPlacement.values.key);
    expect(canonicalWorkflow.envVar.values.key).toBe(envVar.values.key);
    expect(canonicalWorkflow.project.values.key).toBe(project.values.key);
    expect(canonicalWorkflow.repository.values.key).toBe(repository.values.key);
    expect(canonicalWorkflow.branch.values.key).toBe(branch.values.key);
    expect(canonicalWorkflow.commit.values.key).toBe(commit.values.key);
    expect(canonicalWorkflow.repositoryBranch.values.key).toBe(repositoryBranch.values.key);
    expect(canonicalWorkflow.repositoryCommit.values.key).toBe(repositoryCommit.values.key);
    expect(canonicalWorkflow.agentSession.values.key).toBe(agentSession.values.key);
    expect(canonicalWorkflow.agentSessionEvent.values.key).toBe(agentSessionEvent.values.key);
    expect(canonicalWorkflow.artifact.values.key).toBe(artifact.values.key);
    expect(canonicalWorkflow.decision.values.key).toBe(decision.values.key);
    expect(canonicalWorkflow.contextBundle.values.key).toBe(contextBundle.values.key);
    expect(canonicalWorkflow.contextBundleEntry.values.key).toBe(contextBundleEntry.values.key);
  });

  it("publishes a built-in manifest for the canonical workflow module", () => {
    expect(workflowManifest).toMatchObject({
      moduleId: "workflow",
      version: "0.0.1",
      source: {
        kind: "built-in",
        specifier: "@io/graph-module-workflow",
        exportName: "workflowManifest",
      },
      compatibility: {
        graph: "graph-schema:v1",
        runtime: "graph-runtime:v1",
      },
      runtime: {
        schemas: [
          {
            key: "workflow",
            namespace: canonicalWorkflow,
          },
        ],
        commands: [
          workflowMutationCommand,
          agentSessionAppendCommand,
          artifactWriteCommand,
          decisionWriteCommand,
        ],
        querySurfaceCatalogs: [workflowExports.workflowQuerySurfaceCatalog],
        readScopes: [workflowExports.workflowReviewModuleReadScope],
        projections: [
          workflowExports.projectBranchBoardProjection,
          workflowExports.branchCommitQueueProjection,
        ],
      },
    });
  });
});
