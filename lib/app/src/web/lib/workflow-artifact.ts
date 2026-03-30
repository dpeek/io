import { type GraphStore } from "@io/app/graph";
import { type AuthoritativeGraphWriteResult, type GraphWriteTransaction } from "@io/graph-kernel";
import {
  evaluateArtifactWriteRequest,
  type ArtifactWriteKind,
  type ArtifactWriteRequest,
  type ArtifactWriteResult,
  type WorkflowArtifactRecord,
  workflow,
} from "@io/graph-module-workflow";

import type {
  WebAppAuthorityCommandOptions,
  WebAppAuthorityTransactionOptions,
} from "./authority.js";
import { requireAgentSession } from "./workflow-authority-shared.js";
import {
  WorkflowMutationError,
  planWorkflowMutation,
  requireString,
  trimOptionalString,
  type ProductGraphClient,
} from "./workflow-mutation-helpers.js";

type WorkflowArtifactAuthority = {
  readonly store: GraphStore;
  applyTransaction(
    transaction: GraphWriteTransaction,
    options: WebAppAuthorityTransactionOptions,
  ): Promise<AuthoritativeGraphWriteResult>;
};

const artifactKindIds = {
  "branch-plan": workflow.artifactKind.values["branch-plan"].id as string,
  "command-log": workflow.artifactKind.values["command-log"].id as string,
  "commit-plan": workflow.artifactKind.values["commit-plan"].id as string,
  doc: workflow.artifactKind.values.doc.id as string,
  file: workflow.artifactKind.values.file.id as string,
  patch: workflow.artifactKind.values.patch.id as string,
  screenshot: workflow.artifactKind.values.screenshot.id as string,
  summary: workflow.artifactKind.values.summary.id as string,
  transcript: workflow.artifactKind.values.transcript.id as string,
} as const satisfies Record<ArtifactWriteKind, string>;

const artifactKindKeysById = invertRecord(artifactKindIds);
const branchSubjectKindId = workflow.agentSessionSubjectKind.values.branch.id as string;
const commitSubjectKindId = workflow.agentSessionSubjectKind.values.commit.id as string;

function invertRecord<TValue extends string>(
  value: Record<TValue, string>,
): Record<string, TValue> {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [entry, key])) as Record<
    string,
    TValue
  >;
}

function decodeArtifactKind(value: string): ArtifactWriteKind {
  const kind = artifactKindKeysById[value];
  if (!kind) {
    throw new Error(`Unknown workflow artifact kind id "${value}".`);
  }
  return kind;
}

function requireArtifactKindId(value: string): string {
  if (value in artifactKindIds) {
    return artifactKindIds[value as ArtifactWriteKind];
  }
  throw new WorkflowMutationError(
    400,
    `Artifact kind must be one of: ${Object.keys(artifactKindIds).join(", ")}.`,
  );
}

function buildWorkflowArtifactRecord(
  entity: ReturnType<ProductGraphClient["artifact"]["get"]>,
): WorkflowArtifactRecord {
  return {
    id: entity.id,
    projectId: entity.project,
    ...(entity.repository ? { repositoryId: entity.repository } : {}),
    branchId: entity.branch,
    ...(entity.commit ? { commitId: entity.commit } : {}),
    sessionId: entity.session,
    kind: decodeArtifactKind(entity.kind),
    title: entity.name,
    ...(entity.mimeType ? { mimeType: entity.mimeType } : {}),
    ...(entity.bodyText ? { bodyText: entity.bodyText } : {}),
    ...(entity.blobId ? { blobId: entity.blobId } : {}),
    createdAt: entity.createdAt.toISOString(),
  };
}

function resolveArtifactCommitId(
  session: ReturnType<ProductGraphClient["agentSession"]["get"]>,
): string | undefined {
  if (session.subjectKind === branchSubjectKindId) {
    return undefined;
  }
  if (session.subjectKind === commitSubjectKindId) {
    if (!session.commit) {
      throw new WorkflowMutationError(
        409,
        `Workflow session "${session.id}" is missing commit provenance.`,
        "invalid-transition",
      );
    }
    return session.commit;
  }
  throw new Error(`Unknown workflow session subject kind id "${session.subjectKind}".`);
}

function materializeArtifactWrite(
  graph: ProductGraphClient,
  store: GraphStore,
  input: ArtifactWriteRequest,
): ArtifactWriteResult {
  const session = requireAgentSession(graph, store, requireString(input.sessionId, "Session id"));
  const evaluated = evaluateArtifactWriteRequest(input);
  if (!evaluated.ok) {
    throw new WorkflowMutationError(400, evaluated.message);
  }

  const mimeType = trimOptionalString(input.mimeType);
  const commitId = resolveArtifactCommitId(session);
  const artifactId = graph.artifact.create({
    name: requireString(input.title, "Artifact title"),
    project: session.project,
    ...(session.repository ? { repository: session.repository } : {}),
    branch: session.branch,
    ...(commitId ? { commit: commitId } : {}),
    session: session.id,
    kind: requireArtifactKindId(input.kind),
    ...(mimeType ? { mimeType } : {}),
    ...(evaluated.content.kind === "text"
      ? { bodyText: evaluated.content.bodyText }
      : { blobId: evaluated.content.blobId }),
  });

  return {
    artifact: buildWorkflowArtifactRecord(graph.artifact.get(artifactId)),
  };
}

export async function runWorkflowArtifactWriteCommand(
  input: ArtifactWriteRequest,
  authority: WorkflowArtifactAuthority,
  options: WebAppAuthorityCommandOptions,
): Promise<ArtifactWriteResult> {
  const planned = planWorkflowMutation(
    authority.store.snapshot(),
    `workflow-artifact-write:${input.sessionId}:${Date.now()}`,
    (graph, store) => materializeArtifactWrite(graph, store, input),
  );

  await authority.applyTransaction(planned.transaction, {
    authorization: options.authorization,
    writeScope: "server-command",
  });
  return planned.result;
}
