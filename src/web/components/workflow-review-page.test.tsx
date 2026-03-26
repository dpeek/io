import { describe, expect, it } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import type {
  CommitQueueScopeResult,
  ProjectBranchScopeResult,
} from "../../graph/modules/ops/workflow/query.js";
import type { WorkflowReviewStartupState } from "../lib/workflow-review-contract.js";
import { WorkflowReviewSurface, type WorkflowReviewReadState } from "./workflow-review-page.js";

function createBranchBoard(): ProjectBranchScopeResult {
  return {
    freshness: {
      projectedAt: "2026-03-26T10:00:00.000Z",
      projectionCursor: "cursor:workflow",
      repositoryFreshness: "fresh",
      repositoryReconciledAt: "2026-03-26T09:58:00.000Z",
    },
    project: {
      createdAt: "2026-03-26T09:00:00.000Z",
      entity: "project",
      id: "project-io",
      inferred: true,
      projectKey: "project:io",
      title: "IO",
      updatedAt: "2026-03-26T09:00:00.000Z",
    },
    repository: {
      createdAt: "2026-03-26T09:00:00.000Z",
      defaultBaseBranch: "main",
      entity: "repository",
      id: "repo-1",
      mainRemoteName: "origin",
      projectId: "project-io",
      repoRoot: "/workspace/io",
      repositoryKey: "repo:io",
      title: "io",
      updatedAt: "2026-03-26T09:00:00.000Z",
    },
    rows: [
      {
        repositoryBranch: {
          freshness: "fresh",
          repositoryBranch: {
            baseBranchName: "main",
            branchName: "workflow/runtime",
            createdAt: "2026-03-26T09:00:00.000Z",
            entity: "repository-branch",
            id: "repo-branch-1",
            latestReconciledAt: "2026-03-26T09:58:00.000Z",
            managed: true,
            projectId: "project-io",
            repositoryId: "repo-1",
            title: "workflow/runtime",
            updatedAt: "2026-03-26T09:58:00.000Z",
            workflowBranchId: "branch-1",
            worktreePath: "/tmp/worktree-1",
          },
        },
        workflowBranch: {
          branchKey: "branch:workflow-runtime",
          createdAt: "2026-03-26T09:00:00.000Z",
          entity: "branch",
          goalSummary: "Replace the browser placeholder with the review layout.",
          id: "branch-1",
          projectId: "project-io",
          queueRank: 1,
          state: "active",
          title: "Workflow runtime contract",
          updatedAt: "2026-03-26T09:59:00.000Z",
        },
      },
      {
        workflowBranch: {
          branchKey: "branch:workflow-docs",
          createdAt: "2026-03-26T09:00:00.000Z",
          entity: "branch",
          id: "branch-2",
          projectId: "project-io",
          queueRank: 2,
          state: "ready",
          title: "Workflow docs alignment",
          updatedAt: "2026-03-26T09:30:00.000Z",
        },
      },
    ],
    unmanagedRepositoryBranches: [
      {
        freshness: "stale",
        repositoryBranch: {
          baseBranchName: "main",
          branchName: "spike/browser-agent",
          createdAt: "2026-03-26T08:00:00.000Z",
          entity: "repository-branch",
          id: "repo-branch-unmanaged",
          managed: false,
          projectId: "project-io",
          repositoryId: "repo-1",
          title: "spike/browser-agent",
          updatedAt: "2026-03-26T08:30:00.000Z",
        },
      },
    ],
  };
}

function createCommitQueue(): CommitQueueScopeResult {
  return {
    branch: {
      activeCommit: {
        repositoryCommit: {
          createdAt: "2026-03-26T09:15:00.000Z",
          entity: "repository-commit",
          id: "repo-commit-1",
          repositoryId: "repo-1",
          sha: "abc123",
          state: "attached",
          title: "Workflow review layout commit",
          updatedAt: "2026-03-26T09:16:00.000Z",
          workflowCommitId: "commit-1",
          worktree: {
            branchName: "workflow/runtime",
            leaseState: "attached",
            path: "/tmp/worktree-1",
          },
        },
        workflowCommit: {
          branchId: "branch-1",
          commitKey: "commit:review-layout",
          createdAt: "2026-03-26T09:10:00.000Z",
          entity: "commit",
          id: "commit-1",
          order: 1,
          state: "active",
          title: "Build workflow review layout",
          updatedAt: "2026-03-26T09:16:00.000Z",
        },
      },
      latestSession: {
        id: "session-1",
        kind: "execution",
        runtimeState: "running",
        sessionKey: "session:workflow-review",
        startedAt: "2026-03-26T09:20:00.000Z",
        subject: {
          commitId: "commit-1",
          kind: "commit",
        },
      },
      repositoryBranch: createBranchBoard().rows[0]?.repositoryBranch,
      workflowBranch: {
        activeCommitId: "commit-1",
        branchKey: "branch:workflow-runtime",
        createdAt: "2026-03-26T09:00:00.000Z",
        entity: "branch",
        goalSummary: "Replace the browser placeholder with the review layout.",
        id: "branch-1",
        projectId: "project-io",
        queueRank: 1,
        state: "active",
        title: "Workflow runtime contract",
        updatedAt: "2026-03-26T09:59:00.000Z",
      },
    },
    freshness: {
      projectedAt: "2026-03-26T10:00:00.000Z",
      projectionCursor: "cursor:workflow",
      repositoryFreshness: "fresh",
      repositoryReconciledAt: "2026-03-26T09:58:00.000Z",
    },
    rows: [
      {
        repositoryCommit: {
          createdAt: "2026-03-26T09:15:00.000Z",
          entity: "repository-commit",
          id: "repo-commit-1",
          repositoryId: "repo-1",
          sha: "abc123",
          state: "attached",
          title: "Workflow review layout commit",
          updatedAt: "2026-03-26T09:16:00.000Z",
          workflowCommitId: "commit-1",
          worktree: {
            branchName: "workflow/runtime",
            leaseState: "attached",
            path: "/tmp/worktree-1",
          },
        },
        workflowCommit: {
          branchId: "branch-1",
          commitKey: "commit:review-layout",
          createdAt: "2026-03-26T09:10:00.000Z",
          entity: "commit",
          id: "commit-1",
          order: 1,
          state: "active",
          title: "Build workflow review layout",
          updatedAt: "2026-03-26T09:16:00.000Z",
        },
      },
      {
        workflowCommit: {
          branchId: "branch-1",
          commitKey: "commit:polish-copy",
          createdAt: "2026-03-26T09:17:00.000Z",
          entity: "commit",
          id: "commit-2",
          order: 2,
          state: "ready",
          title: "Polish empty and loading copy",
          updatedAt: "2026-03-26T09:18:00.000Z",
        },
      },
    ],
  };
}

function createReadyStartupState(): WorkflowReviewStartupState {
  return {
    availableBranches: [
      {
        id: "branch-1",
        projectId: "project-io",
        queueRank: 1,
        title: "Workflow runtime contract",
        updatedAt: "2026-03-26T09:59:00.000Z",
      },
      {
        id: "branch-2",
        projectId: "project-io",
        queueRank: 2,
        title: "Workflow docs alignment",
        updatedAt: "2026-03-26T09:30:00.000Z",
      },
    ],
    contract: {} as WorkflowReviewStartupState["contract"],
    kind: "ready",
    project: {
      id: "project-io",
      title: "IO",
    },
    selectedBranch: {
      id: "branch-1",
      projectId: "project-io",
      queueRank: 1,
      title: "Workflow runtime contract",
      updatedAt: "2026-03-26T09:59:00.000Z",
    },
  };
}

describe("workflow review page", () => {
  it("renders the workflow-native branch board, branch detail, and commit queue layout", () => {
    const readState: WorkflowReviewReadState = {
      branchBoard: createBranchBoard(),
      commitQueue: createCommitQueue(),
      status: "ready",
    };

    const html = renderToStaticMarkup(
      <WorkflowReviewSurface
        readState={readState}
        search={{ project: "project-io", branch: "branch-1" }}
        startupState={createReadyStartupState()}
      />,
    );

    expect(html).toContain("Branch board");
    expect(html).toContain("Branch detail");
    expect(html).toContain("Commit queue");
    expect(html).toContain("Workflow runtime contract");
    expect(html).toContain("Build workflow review layout");
    expect(html).toContain("Observed repository branches");
    expect(html).not.toContain("EntityTypeBrowser");
  });

  it("keeps the no-selection state explicit when the scope exposes multiple projects", () => {
    const startupState: WorkflowReviewStartupState = {
      contract: {} as WorkflowReviewStartupState["contract"],
      kind: "missing-data",
      message: "Select a project before branch-board composition starts.",
      reason: "project-selection-required",
      visibleProjects: [
        { id: "project-io", title: "IO" },
        { id: "project-web", title: "Web" },
      ],
    };

    const html = renderToStaticMarkup(
      <WorkflowReviewSurface
        readState={{ status: "loading" }}
        search={{}}
        startupState={startupState}
      />,
    );

    expect(html).toContain("Select a project before branch-board composition starts.");
    expect(html).toContain("Branch board");
    expect(html).toContain("No branch selected");
    expect(html).toContain("Commit queue unavailable");
  });

  it("renders an explicit empty branch-board state when the project has no branches", () => {
    const startupState: WorkflowReviewStartupState = {
      availableBranches: [],
      contract: {} as WorkflowReviewStartupState["contract"],
      kind: "partial-data",
      message: "The selected project does not currently expose any workflow branches.",
      project: {
        id: "project-io",
        title: "IO",
      },
      reason: "project-has-no-branches",
    };

    const html = renderToStaticMarkup(
      <WorkflowReviewSurface
        readState={{ status: "loading" }}
        search={{ project: "project-io" }}
        startupState={startupState}
      />,
    );

    expect(html).toContain("Branch board unavailable");
    expect(html).toContain("The selected project does not currently expose any workflow branches.");
    expect(html).toContain("No branch selected");
    expect(html).toContain("Commit queue unavailable");
  });

  it("renders stale branch selections as explicit branch-board drift instead of another branch", () => {
    const startupState: WorkflowReviewStartupState = {
      availableBranches: [
        {
          id: "branch-2",
          projectId: "project-io",
          queueRank: 2,
          title: "Workflow docs alignment",
          updatedAt: "2026-03-26T09:30:00.000Z",
        },
      ],
      contract: {} as WorkflowReviewStartupState["contract"],
      kind: "partial-data",
      message:
        "The configured workflow branch is not visible in the resolved project branch board.",
      project: {
        id: "project-io",
        title: "IO",
      },
      reason: "configured-branch-missing",
    };

    const html = renderToStaticMarkup(
      <WorkflowReviewSurface
        readState={{ status: "loading" }}
        search={{ branch: "branch-missing", project: "project-io" }}
        startupState={startupState}
      />,
    );

    expect(html).toContain("Branch board unavailable");
    expect(html).toContain(
      "The configured workflow branch is not visible in the resolved project branch board.",
    );
    expect(html).toContain("project-io");
    expect(html).toContain("pending selection");
    expect(html).not.toContain("Workflow docs alignment");
  });
});
