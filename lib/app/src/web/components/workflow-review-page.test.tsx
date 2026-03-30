import { describe, expect, it } from "bun:test";

import type { CommitQueueScopeResult, ProjectBranchScopeResult } from "@io/graph-module-workflow";
import { renderToStaticMarkup } from "react-dom/server";

import type { BrowserAgentRuntimeProbe } from "@op/cli/browser-agent";
import type { WorkflowReviewStartupState } from "../lib/workflow-review-contract.js";
import { createWorkflowSessionLiveEvent } from "../lib/workflow-session-live.js";
import {
  createBranchSessionActionModel,
  createCommitSessionActionModel,
  WorkflowReviewSurface,
  type WorkflowSessionFeedReadState,
  type WorkflowReviewReadState,
} from "./workflow-review-page.js";

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
            branchId: "branch-1",
            worktreePath: "/tmp/worktree-1",
          },
        },
        branch: {
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
        branch: {
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
          commitId: "commit-1",
          worktree: {
            branchName: "workflow/runtime",
            leaseState: "attached",
            path: "/tmp/worktree-1",
          },
        },
        commit: {
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
      branch: {
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
          commitId: "commit-1",
          worktree: {
            branchName: "workflow/runtime",
            leaseState: "attached",
            path: "/tmp/worktree-1",
          },
        },
        commit: {
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
        commit: {
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

function createRuntimeState(
  overrides: Partial<BrowserAgentRuntimeProbe> = {},
): BrowserAgentRuntimeProbe {
  return {
    launchPath: "/launch-session",
    message: "Browser-agent runtime ready for launch, attach, and active-session lookup.",
    sessionEventsPath: "/session-events",
    startedAt: "2026-03-26T10:00:00.000Z",
    status: "ready",
    ...overrides,
  };
}

function createBranchActionOverrides() {
  return createBranchSessionActionModel({
    authStatus: "ready",
    commitQueue: createCommitQueue(),
    lookupState: { status: "idle" },
    runtime: createRuntimeState(),
    selectedBranchState: "active",
  });
}

function createCommitActionOverrides() {
  return createCommitSessionActionModel({
    authStatus: "ready",
    commitQueue: createCommitQueue(),
    lookupState: { status: "idle" },
    runtime: createRuntimeState(),
    selectedBranchState: "active",
  });
}

function createSessionFeedState(): WorkflowSessionFeedReadState {
  return {
    result: {
      artifacts: [],
      decisions: [],
      events: [
        {
          type: "session",
          phase: "started",
          sequence: 1,
          timestamp: "2026-03-26T02:00:00.000Z",
        },
        {
          type: "status",
          code: "ready",
          format: "line",
          sequence: 2,
          text: "Running",
          timestamp: "2026-03-26T02:00:01.000Z",
        },
      ],
      finalization: {
        status: "not-applicable",
      },
      header: {
        id: "session:1",
        kind: "planning",
        sessionKey: "session:workflow-branch",
        title: "Workflow runtime planning",
      },
      history: {
        lastSequence: 2,
        persistedEventCount: 2,
        reason: "history-pending-append",
        status: "partial",
      },
      query: {
        projectId: "project-io",
        session: {
          kind: "latest-for-subject",
        },
        subject: {
          branchId: "branch-1",
          kind: "branch",
        },
      },
      runtime: {
        startedAt: "2026-03-26T02:00:00.000Z",
        state: "running",
      },
      status: "ready",
      subject: {
        branch: createBranchBoard().rows[0]!.branch,
        projectId: "project-io",
        repository: createBranchBoard().repository,
        repositoryBranch: createBranchBoard().rows[0]!.repositoryBranch,
      },
    },
    status: "ready",
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
        branchAction={createBranchActionOverrides()}
        branchActionState={undefined}
        branchLookupState={{ status: "idle" }}
        commitAction={createCommitActionOverrides()}
        commitActionState={undefined}
        commitLookupState={{ status: "idle" }}
        onTriggerBranchSession={() => {}}
        onTriggerCommitSession={() => {}}
        readState={readState}
        runtime={createRuntimeState()}
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
    expect(html).toContain("Local browser-agent runtime ready");
    expect(html).toContain("Launch branch session");
    expect(html).toContain("Commit session");
    expect(html).toContain("Attach commit session");
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
        branchAction={createBranchActionOverrides()}
        branchActionState={undefined}
        branchLookupState={{ status: "idle" }}
        commitAction={createCommitActionOverrides()}
        commitActionState={undefined}
        commitLookupState={{ status: "idle" }}
        onTriggerBranchSession={() => {}}
        onTriggerCommitSession={() => {}}
        readState={{ status: "loading" }}
        runtime={createRuntimeState({
          message:
            "Local browser-agent runtime unavailable. Start `io browser-agent` on this machine to enable browser launch and attach.",
          status: "unavailable",
        })}
        search={{}}
        startupState={startupState}
      />,
    );

    expect(html).toContain("Select a project before branch-board composition starts.");
    expect(html).toContain("Branch board");
    expect(html).toContain("No branch selected");
    expect(html).toContain("Commit queue unavailable");
    expect(html).toContain("Local browser-agent runtime unavailable");
    expect(html).toContain("io browser-agent");
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
        branchAction={createBranchActionOverrides()}
        branchActionState={undefined}
        branchLookupState={{ status: "idle" }}
        commitAction={createCommitActionOverrides()}
        commitActionState={undefined}
        commitLookupState={{ status: "idle" }}
        onTriggerBranchSession={() => {}}
        onTriggerCommitSession={() => {}}
        readState={{ status: "loading" }}
        runtime={createRuntimeState()}
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
        branchAction={createBranchActionOverrides()}
        branchActionState={undefined}
        branchLookupState={{ status: "idle" }}
        commitAction={createCommitActionOverrides()}
        commitActionState={undefined}
        commitLookupState={{ status: "idle" }}
        onTriggerBranchSession={() => {}}
        onTriggerCommitSession={() => {}}
        readState={{ status: "loading" }}
        runtime={createRuntimeState()}
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

  it("switches the branch action into attach mode when an active branch session exists", () => {
    const action = createBranchSessionActionModel({
      authStatus: "ready",
      commitQueue: {
        ...createCommitQueue(),
        branch: {
          ...createCommitQueue().branch,
          latestSession: {
            id: "session:1",
            kind: "planning",
            runtimeState: "running",
            sessionKey: "session:workflow-branch",
            startedAt: "2026-03-26T02:00:00.000Z",
            subject: {
              kind: "branch",
            },
          },
        },
      },
      lookupState: {
        status: "ready",
        result: {
          attach: {
            attachToken: "attach:1",
            browserAgentSessionId: "browser-agent:1",
            expiresAt: "2026-03-26T03:00:00.000Z",
            transport: "browser-agent-http",
          },
          found: true,
          ok: true,
          session: {
            id: "session:1",
            kind: "planning",
            runtimeState: "running",
            sessionKey: "session:workflow-branch",
            startedAt: "2026-03-26T02:00:00.000Z",
            subject: {
              kind: "branch",
              branchId: "branch-1",
            },
          },
          workspace: {
            repositoryId: "repo-1",
          },
        },
      },
      runtime: createRuntimeState(),
      selectedBranchState: "active",
    });

    expect(action.label).toBe("Attach branch session");
    expect(action.preference).toEqual({ mode: "attach-existing" });
  });

  it("keeps branch attach recovery explicit after reload when a reusable session is found", () => {
    const commitQueue = {
      ...createCommitQueue(),
      branch: {
        ...createCommitQueue().branch,
        latestSession: {
          id: "session:1",
          kind: "planning",
          runtimeState: "running",
          sessionKey: "session:workflow-branch",
          startedAt: "2026-03-26T02:00:00.000Z",
          subject: {
            kind: "branch",
          },
        },
      },
    } satisfies CommitQueueScopeResult;
    const html = renderToStaticMarkup(
      <WorkflowReviewSurface
        branchAction={createBranchSessionActionModel({
          authStatus: "ready",
          commitQueue,
          lookupState: {
            status: "ready",
            result: {
              attach: {
                attachToken: "attach:1",
                browserAgentSessionId: "browser-agent:1",
                expiresAt: "2026-03-26T03:00:00.000Z",
                transport: "browser-agent-http",
              },
              found: true,
              ok: true,
              session: {
                id: "session:1",
                kind: "planning",
                runtimeState: "running",
                sessionKey: "session:workflow-branch",
                startedAt: "2026-03-26T02:00:00.000Z",
                subject: {
                  kind: "branch",
                  branchId: "branch-1",
                },
              },
              workspace: {
                repositoryId: "repo-1",
              },
            },
          },
          runtime: createRuntimeState(),
          selectedBranchState: "active",
        })}
        branchActionState={undefined}
        branchLookupState={{
          status: "ready",
          result: {
            attach: {
              attachToken: "attach:1",
              browserAgentSessionId: "browser-agent:1",
              expiresAt: "2026-03-26T03:00:00.000Z",
              transport: "browser-agent-http",
            },
            found: true,
            ok: true,
            session: {
              id: "session:1",
              kind: "planning",
              runtimeState: "running",
              sessionKey: "session:workflow-branch",
              startedAt: "2026-03-26T02:00:00.000Z",
              subject: {
                kind: "branch",
                branchId: "branch-1",
              },
            },
            workspace: {
              repositoryId: "repo-1",
            },
          },
        }}
        commitAction={createCommitActionOverrides()}
        commitActionState={undefined}
        commitLookupState={{ status: "idle" }}
        onTriggerBranchSession={() => {}}
        onTriggerCommitSession={() => {}}
        readState={{
          branchBoard: createBranchBoard(),
          commitQueue,
          status: "ready",
        }}
        runtime={createRuntimeState()}
        search={{ project: "project-io", branch: "branch-1" }}
        startupState={createReadyStartupState()}
      />,
    );

    expect(html).toContain("Attach branch session");
    expect(html).toContain(
      "Reusable session session:workflow-branch is active in the local browser-agent runtime.",
    );
  });

  it("switches the commit action into attach mode when an active commit session exists", () => {
    const action = createCommitSessionActionModel({
      authStatus: "ready",
      commitQueue: createCommitQueue(),
      lookupState: {
        status: "ready",
        result: {
          attach: {
            attachToken: "attach:commit:1",
            browserAgentSessionId: "browser-agent:commit:1",
            expiresAt: "2026-03-26T03:00:00.000Z",
            transport: "browser-agent-http",
          },
          found: true,
          ok: true,
          session: {
            id: "session:commit:1",
            kind: "execution",
            runtimeState: "running",
            sessionKey: "session:workflow-commit",
            startedAt: "2026-03-26T02:00:00.000Z",
            subject: {
              kind: "commit",
              branchId: "branch-1",
              commitId: "commit-1",
            },
          },
          workspace: {
            repositoryId: "repo-1",
          },
        },
      },
      runtime: createRuntimeState(),
      selectedBranchState: "active",
    });

    expect(action.label).toBe("Attach commit session");
    expect(action.preference).toEqual({ mode: "attach-existing" });
  });

  it("keeps commit attach recovery explicit after reload when a reusable session is found", () => {
    const lookupResult = {
      attach: {
        attachToken: "attach:commit:1",
        browserAgentSessionId: "browser-agent:commit:1",
        expiresAt: "2026-03-26T03:00:00.000Z",
        transport: "browser-agent-http",
      },
      found: true,
      ok: true,
      session: {
        id: "session:commit:1",
        kind: "execution",
        runtimeState: "running",
        sessionKey: "session:workflow-commit",
        startedAt: "2026-03-26T02:00:00.000Z",
        subject: {
          kind: "commit",
          branchId: "branch-1",
          commitId: "commit-1",
        },
      },
      workspace: {
        repositoryId: "repo-1",
      },
    } as const;
    const html = renderToStaticMarkup(
      <WorkflowReviewSurface
        branchAction={createBranchActionOverrides()}
        branchActionState={undefined}
        branchLookupState={{ status: "idle" }}
        commitAction={createCommitSessionActionModel({
          authStatus: "ready",
          commitQueue: createCommitQueue(),
          lookupState: {
            status: "ready",
            result: lookupResult,
          },
          runtime: createRuntimeState(),
          selectedBranchState: "active",
        })}
        commitActionState={undefined}
        commitLookupState={{
          status: "ready",
          result: lookupResult,
        }}
        onTriggerBranchSession={() => {}}
        onTriggerCommitSession={() => {}}
        readState={{
          branchBoard: createBranchBoard(),
          commitQueue: createCommitQueue(),
          status: "ready",
        }}
        runtime={createRuntimeState()}
        search={{ project: "project-io", branch: "branch-1" }}
        startupState={createReadyStartupState()}
      />,
    );

    expect(html).toContain("Attach commit session");
    expect(html).toContain(
      "Reusable session session:workflow-commit is active in the local browser-agent runtime.",
    );
  });

  it("surfaces explicit degraded branch attach recovery failures", () => {
    const commitQueue = {
      ...createCommitQueue(),
      branch: {
        ...createCommitQueue().branch,
        latestSession: undefined,
      },
    } satisfies CommitQueueScopeResult;
    const action = createBranchSessionActionModel({
      authStatus: "ready",
      commitQueue,
      lookupState: {
        message: "Repository mismatch. Expected repo-1 before attach can continue.",
        status: "failed",
      },
      runtime: createRuntimeState(),
      selectedBranchState: "active",
    });

    expect(action.availability).toBe("unavailable");
    expect(action.reason).toBe("Repository mismatch. Expected repo-1 before attach can continue.");
  });

  it("renders typed launch failures inline for commit sessions", () => {
    const html = renderToStaticMarkup(
      <WorkflowReviewSurface
        branchAction={createBranchActionOverrides()}
        branchActionState={undefined}
        branchLookupState={{ status: "idle" }}
        commitAction={createCommitActionOverrides()}
        commitActionState={{
          message: "The selected commit is locked by another running session.",
          result: {
            code: "subject-locked",
            message: "The selected commit is locked by another running session.",
            ok: false,
            retryable: true,
            source: "authority",
          },
          status: "failure",
        }}
        commitLookupState={{ status: "idle" }}
        onTriggerBranchSession={() => {}}
        onTriggerCommitSession={() => {}}
        readState={{
          branchBoard: createBranchBoard(),
          commitQueue: createCommitQueue(),
          status: "ready",
        }}
        runtime={createRuntimeState()}
        search={{ project: "project-io", branch: "branch-1" }}
        startupState={createReadyStartupState()}
      />,
    );

    expect(html).toContain("The selected commit is locked by another running session.");
    expect(html).toContain('data-workflow-commit-session-state="failure"');
  });

  it("renders branch launch metadata after a successful browser-agent handoff", () => {
    const html = renderToStaticMarkup(
      <WorkflowReviewSurface
        branchAction={createBranchSessionActionModel({
          authStatus: "ready",
          commitQueue: createCommitQueue(),
          lookupState: { status: "idle" },
          runtime: createRuntimeState(),
          selectedBranchState: "active",
        })}
        branchActionState={{
          message: "Attached to session:workflow-branch.",
          result: {
            attach: {
              attachToken: "attach:1",
              browserAgentSessionId: "browser-agent:1",
              expiresAt: "2026-03-26T03:00:00.000Z",
              transport: "browser-agent-http",
            },
            authority: {
              appendGrant: {
                allowedActions: ["append-session-events", "write-artifact", "write-decision"],
                expiresAt: "2026-03-26T03:00:00.000Z",
                grantId: "grant:1",
                grantToken: "grant-token:1",
                issuedAt: "2026-03-26T02:00:00.000Z",
                sessionId: "session:1",
              },
              auditActorPrincipalId: "principal:1",
            },
            ok: true,
            outcome: "attached",
            session: {
              id: "session:1",
              kind: "planning",
              runtimeState: "running",
              sessionKey: "session:workflow-branch",
              startedAt: "2026-03-26T02:00:00.000Z",
              subject: {
                kind: "branch",
                branchId: "branch-1",
              },
            },
            workspace: {
              repositoryBranchName: "workflow/runtime",
              repositoryId: "repo-1",
              repositoryRoot: "/workspace/io",
              worktreePath: "/tmp/worktree-1",
            },
          },
          status: "success",
        }}
        branchLookupState={{ status: "idle" }}
        commitAction={createCommitActionOverrides()}
        commitActionState={undefined}
        commitLookupState={{ status: "idle" }}
        onTriggerBranchSession={() => {}}
        onTriggerCommitSession={() => {}}
        readState={{
          branchBoard: createBranchBoard(),
          commitQueue: createCommitQueue(),
          status: "ready",
        }}
        runtime={createRuntimeState()}
        search={{ project: "project-io", branch: "branch-1" }}
        startupState={createReadyStartupState()}
      />,
    );

    expect(html).toContain("Attach token");
    expect(html).toContain("attach:1");
    expect(html).toContain("Browser-agent session");
    expect(html).toContain("workflow/runtime");
  });

  it("renders commit launch metadata after a successful browser-agent handoff", () => {
    const html = renderToStaticMarkup(
      <WorkflowReviewSurface
        branchAction={createBranchActionOverrides()}
        branchActionState={undefined}
        branchLookupState={{ status: "idle" }}
        commitAction={createCommitSessionActionModel({
          authStatus: "ready",
          commitQueue: createCommitQueue(),
          lookupState: { status: "idle" },
          runtime: createRuntimeState(),
          selectedBranchState: "active",
        })}
        commitActionState={{
          message: "Attached to session:workflow-commit.",
          result: {
            attach: {
              attachToken: "attach:commit:1",
              browserAgentSessionId: "browser-agent:commit:1",
              expiresAt: "2026-03-26T03:00:00.000Z",
              transport: "browser-agent-http",
            },
            authority: {
              appendGrant: {
                allowedActions: ["append-session-events", "write-artifact", "write-decision"],
                expiresAt: "2026-03-26T03:00:00.000Z",
                grantId: "grant:commit:1",
                grantToken: "grant-token:commit:1",
                issuedAt: "2026-03-26T02:00:00.000Z",
                sessionId: "session:commit:1",
              },
              auditActorPrincipalId: "principal:1",
            },
            ok: true,
            outcome: "attached",
            session: {
              id: "session:commit:1",
              kind: "execution",
              runtimeState: "running",
              sessionKey: "session:workflow-commit",
              startedAt: "2026-03-26T02:00:00.000Z",
              subject: {
                kind: "commit",
                branchId: "branch-1",
                commitId: "commit-1",
              },
            },
            workspace: {
              repositoryBranchName: "workflow/runtime",
              repositoryId: "repo-1",
              repositoryRoot: "/workspace/io",
              worktreePath: "/tmp/worktree-1",
            },
          },
          status: "success",
        }}
        commitLookupState={{ status: "idle" }}
        onTriggerBranchSession={() => {}}
        onTriggerCommitSession={() => {}}
        readState={{
          branchBoard: createBranchBoard(),
          commitQueue: createCommitQueue(),
          status: "ready",
        }}
        runtime={createRuntimeState()}
        search={{ project: "project-io", branch: "branch-1" }}
        startupState={createReadyStartupState()}
      />,
    );

    expect(html).toContain("Attach commit session");
    expect(html).toContain("attach:commit:1");
    expect(html).toContain("session:workflow-commit");
    expect(html).toContain("Browser-agent session");
  });

  it("renders transient local live session events on top of authoritative history", () => {
    const html = renderToStaticMarkup(
      <WorkflowReviewSurface
        branchAction={createBranchActionOverrides()}
        branchActionState={undefined}
        branchLookupState={{ status: "idle" }}
        commitAction={createCommitActionOverrides()}
        commitActionState={undefined}
        commitLookupState={{ status: "idle" }}
        liveSessionState={{
          browserAgentSessionId: "browser-agent:1",
          events: [
            createWorkflowSessionLiveEvent({
              browserAgentSessionId: "browser-agent:1",
              event: {
                type: "status",
                code: "ready",
                format: "line",
                sequence: 3,
                text: "Still streaming locally",
                timestamp: "2026-03-26T02:00:02.000Z",
              },
              sessionId: "session:1",
            }),
          ],
          sessionId: "session:1",
          status: "streaming",
        }}
        onTriggerBranchSession={() => {}}
        onTriggerCommitSession={() => {}}
        readState={{
          branchBoard: createBranchBoard(),
          commitQueue: createCommitQueue(),
          status: "ready",
        }}
        runtime={createRuntimeState()}
        search={{ project: "project-io", branch: "branch-1" }}
        sessionFeedState={createSessionFeedState()}
        startupState={createReadyStartupState()}
      />,
    );

    expect(html).toContain("1 transient");
    expect(html).toContain(
      "Showing 1 locally seen update until graph-backed session history catches up.",
    );
    expect(html).toContain("Still streaming locally");
    expect(html).toContain("transient");
  });

  it("keeps the authoritative session feed visible when local live updates are unavailable", () => {
    const html = renderToStaticMarkup(
      <WorkflowReviewSurface
        branchAction={createBranchActionOverrides()}
        branchActionState={undefined}
        branchLookupState={{ status: "idle" }}
        commitAction={createCommitActionOverrides()}
        commitActionState={undefined}
        commitLookupState={{ status: "idle" }}
        liveSessionState={{
          browserAgentSessionId: "browser-agent:1",
          events: [],
          message: "Local live session updates unavailable. Showing graph-backed history only.",
          sessionId: "session:1",
          status: "unavailable",
        }}
        onTriggerBranchSession={() => {}}
        onTriggerCommitSession={() => {}}
        readState={{
          branchBoard: createBranchBoard(),
          commitQueue: createCommitQueue(),
          status: "ready",
        }}
        runtime={createRuntimeState()}
        search={{ project: "project-io", branch: "branch-1" }}
        sessionFeedState={createSessionFeedState()}
        startupState={createReadyStartupState()}
      />,
    );

    expect(html).toContain("Workflow runtime planning");
    expect(html).toContain(
      "Local live session updates unavailable. Showing graph-backed history only.",
    );
    expect(html).toContain("Running");
  });
});
