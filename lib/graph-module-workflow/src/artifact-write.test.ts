import { describe, expect, it } from "bun:test";

import { evaluateArtifactWriteRequest, type ArtifactWriteRequest } from "./artifact-write.js";

function createRequest(overrides: Partial<ArtifactWriteRequest> = {}): ArtifactWriteRequest {
  return {
    sessionId: "session:workflow-artifact-01",
    kind: "summary",
    title: "Workflow artifact",
    ...overrides,
  };
}

describe("artifact write contract", () => {
  it("accepts inline text artifact content", () => {
    expect(
      evaluateArtifactWriteRequest(
        createRequest({
          bodyText: "Retained workflow summary",
        }),
      ),
    ).toEqual({
      ok: true,
      content: {
        kind: "text",
        bodyText: "Retained workflow summary",
      },
    });
  });

  it("accepts blob-backed artifact content", () => {
    expect(
      evaluateArtifactWriteRequest(
        createRequest({
          blobId: "  blob:workflow-artifact-01  ",
        }),
      ),
    ).toEqual({
      ok: true,
      content: {
        kind: "blob",
        blobId: "blob:workflow-artifact-01",
      },
    });
  });

  it("rejects requests without retained text or blob content", () => {
    expect(evaluateArtifactWriteRequest(createRequest())).toEqual({
      ok: false,
      code: "content-missing",
      message: "Workflow artifact writes require either bodyText or blobId.",
    });
  });

  it("rejects requests that mix inline text and blob-backed content", () => {
    expect(
      evaluateArtifactWriteRequest(
        createRequest({
          bodyText: "Retained workflow summary",
          blobId: "blob:workflow-artifact-01",
        }),
      ),
    ).toEqual({
      ok: false,
      code: "content-conflict",
      message: "Workflow artifact writes must use either bodyText or blobId, not both.",
    });
  });
});
