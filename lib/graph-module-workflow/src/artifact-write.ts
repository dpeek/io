import { edgeId } from "@io/graph-kernel";
import type { GraphCommandSpec } from "@io/graph-module";

import { artifact, artifactKind } from "./type.js";

function hasNonBlankString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export const artifactWriteFailureCodes = ["content-missing", "content-conflict"] as const;

export type ArtifactWriteFailureCode = (typeof artifactWriteFailureCodes)[number];
export type ArtifactWriteKind = keyof typeof artifactKind.options;

export interface ArtifactWriteRequest {
  readonly sessionId: string;
  readonly kind: ArtifactWriteKind;
  readonly title: string;
  readonly mimeType?: string;
  readonly bodyText?: string;
  readonly blobId?: string;
}

export type ArtifactWriteContent =
  | {
      readonly kind: "text";
      readonly bodyText: string;
    }
  | {
      readonly kind: "blob";
      readonly blobId: string;
    };

export interface WorkflowArtifactRecord {
  readonly id: string;
  readonly projectId: string;
  readonly repositoryId?: string;
  readonly branchId: string;
  readonly commitId?: string;
  readonly sessionId: string;
  readonly kind: ArtifactWriteKind;
  readonly title: string;
  readonly mimeType?: string;
  readonly bodyText?: string;
  readonly blobId?: string;
  readonly createdAt: string;
}

export interface ArtifactWriteResult {
  readonly artifact: WorkflowArtifactRecord;
}

export interface ArtifactWriteValidationSuccess {
  readonly content: ArtifactWriteContent;
  readonly ok: true;
}

export interface ArtifactWriteValidationFailure {
  readonly code: ArtifactWriteFailureCode;
  readonly message: string;
  readonly ok: false;
}

export type ArtifactWriteValidationResult =
  | ArtifactWriteValidationFailure
  | ArtifactWriteValidationSuccess;

export function evaluateArtifactWriteRequest(
  request: ArtifactWriteRequest,
): ArtifactWriteValidationResult {
  const { blobId, bodyText } = request;
  const hasBodyText = hasNonBlankString(bodyText);
  const hasBlobId = hasNonBlankString(blobId);

  if (hasBodyText && hasBlobId) {
    return {
      ok: false,
      code: "content-conflict",
      message: "Workflow artifact writes must use either bodyText or blobId, not both.",
    };
  }

  if (!hasBodyText && !hasBlobId) {
    return {
      ok: false,
      code: "content-missing",
      message: "Workflow artifact writes require either bodyText or blobId.",
    };
  }

  if (hasBodyText) {
    return {
      ok: true,
      content: {
        kind: "text",
        bodyText,
      },
    };
  }

  if (!hasBlobId) {
    throw new Error("Artifact write blob validation became inconsistent.");
  }

  return {
    ok: true,
    content: {
      kind: "blob",
      blobId: blobId.trim(),
    },
  };
}

export const artifactWriteCommand = {
  key: "workflow:artifact-write",
  label: "Persist workflow artifact",
  execution: "serverOnly",
  input: undefined as unknown as ArtifactWriteRequest,
  output: undefined as unknown as ArtifactWriteResult,
  policy: {
    touchesPredicates: [
      { predicateId: edgeId(artifact.fields.name) },
      { predicateId: edgeId(artifact.fields.project) },
      { predicateId: edgeId(artifact.fields.repository) },
      { predicateId: edgeId(artifact.fields.branch) },
      { predicateId: edgeId(artifact.fields.commit) },
      { predicateId: edgeId(artifact.fields.session) },
      { predicateId: edgeId(artifact.fields.kind) },
      { predicateId: edgeId(artifact.fields.mimeType) },
      { predicateId: edgeId(artifact.fields.bodyText) },
      { predicateId: edgeId(artifact.fields.blobId) },
    ],
  },
} satisfies GraphCommandSpec<ArtifactWriteRequest, ArtifactWriteResult>;
