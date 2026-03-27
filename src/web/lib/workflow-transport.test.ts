import { describe, expect, it } from "bun:test";

import type { CommitQueueScopeResult, ProjectBranchScopeResult } from "@io/graph-module-workflow";

import {
  requestWorkflowRead,
  webWorkflowReadPath,
  WorkflowReadClientError,
  type CommitQueueScopeWorkflowReadResponse,
  type ProjectBranchScopeWorkflowReadResponse,
} from "./workflow-transport.js";

const isoNow = "2026-03-24T00:00:00.000Z";

function createProjectBranchScopeResult(): ProjectBranchScopeResult {
  return {
    project: {
      entity: "project",
      id: "project:io",
      title: "IO",
      projectKey: "project:io",
      inferred: false,
      createdAt: isoNow,
      updatedAt: isoNow,
    },
    repository: {
      entity: "repository",
      id: "repo:io",
      title: "io",
      projectId: "project:io",
      repositoryKey: "repo:io",
      repoRoot: "/tmp/io",
      defaultBaseBranch: "main",
      createdAt: isoNow,
      updatedAt: isoNow,
    },
    rows: [
      {
        branch: {
          entity: "branch",
          id: "branch:workflow-authority",
          title: "Workflow authority",
          projectId: "project:io",
          branchKey: "branch:workflow-authority",
          goalSummary: "Expose workflow reads over HTTP.",
          state: "ready",
          createdAt: isoNow,
          updatedAt: isoNow,
        },
      },
    ],
    unmanagedRepositoryBranches: [],
    freshness: {
      projectedAt: isoNow,
      projectionCursor: "workflow-projection:test",
      repositoryFreshness: "fresh",
    },
  };
}

function createCommitQueueScopeResult(): CommitQueueScopeResult {
  return {
    branch: {
      branch: {
        entity: "branch",
        id: "branch:workflow-authority",
        title: "Workflow authority",
        projectId: "project:io",
        branchKey: "branch:workflow-authority",
        goalSummary: "Expose workflow reads over HTTP.",
        state: "ready",
        activeCommitId: "commit:workflow-read",
        createdAt: isoNow,
        updatedAt: isoNow,
      },
      activeCommit: {
        commit: {
          entity: "commit",
          id: "commit:workflow-read",
          title: "Expose workflow reads",
          branchId: "branch:workflow-authority",
          commitKey: "commit:workflow-read",
          order: 0,
          state: "ready",
          createdAt: isoNow,
          updatedAt: isoNow,
        },
      },
    },
    rows: [
      {
        commit: {
          entity: "commit",
          id: "commit:workflow-read",
          title: "Expose workflow reads",
          branchId: "branch:workflow-authority",
          commitKey: "commit:workflow-read",
          order: 0,
          state: "ready",
          createdAt: isoNow,
          updatedAt: isoNow,
        },
      },
    ],
    freshness: {
      projectedAt: isoNow,
      projectionCursor: "workflow-projection:test",
      repositoryFreshness: "fresh",
    },
  };
}

describe("workflow read transport client", () => {
  it("posts project branch scope reads to the shipped workflow route", async () => {
    const payload = {
      kind: "project-branch-scope",
      result: createProjectBranchScopeResult(),
    } satisfies ProjectBranchScopeWorkflowReadResponse;

    const response = await requestWorkflowRead(
      {
        kind: "project-branch-scope",
        query: {
          projectId: "project:io",
        },
      },
      {
        fetch: async (input, init) => {
          expect(input).toBe(webWorkflowReadPath);
          expect(init?.method).toBe("POST");
          expect(init?.headers).toEqual({
            accept: "application/json",
            "content-type": "application/json",
          });
          expect(JSON.parse(String(init?.body))).toEqual({
            kind: "project-branch-scope",
            query: {
              projectId: "project:io",
            },
          });

          return Response.json(payload);
        },
      },
    );

    expect(response).toEqual(payload);
  });

  it("surfaces workflow transport failures with the stable failure code", async () => {
    await expect(
      requestWorkflowRead(
        {
          kind: "commit-queue-scope",
          query: {
            branchId: "branch:missing",
          },
        },
        {
          fetch: async () =>
            Response.json(
              {
                error: 'Workflow branch "branch:missing" was not found in the current projection.',
                code: "branch-not-found",
              },
              { status: 404 },
            ),
        },
      ),
    ).rejects.toMatchObject({
      name: WorkflowReadClientError.name,
      status: 404,
      code: "branch-not-found",
    });
  });

  it("supports branch commit queue reads against an explicit base URL", async () => {
    const payload = {
      kind: "commit-queue-scope",
      result: createCommitQueueScopeResult(),
    } satisfies CommitQueueScopeWorkflowReadResponse;

    const response = await requestWorkflowRead(
      {
        kind: "commit-queue-scope",
        query: {
          branchId: "branch:workflow-authority",
          limit: 1,
        },
      },
      {
        url: "https://web.local/app/",
        fetch: async (input) => {
          expect(input).toBe("https://web.local/api/workflow-read");
          return Response.json(payload);
        },
      },
    );

    expect(response).toEqual(payload);
  });
});
