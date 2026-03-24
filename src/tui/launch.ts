import { resolve } from "node:path";

import { renderContextBundle, resolveIssueContext } from "../agent/context.js";
import { resolveIssueRouting } from "../agent/issue-routing.js";
import { CodexAppServerRunner } from "../agent/runner/codex.js";
import type { AgentIssue, PreparedWorkspace, Workflow } from "../agent/types.js";
import {
  WorkflowSubjectLaunchCoordinator,
  type WorkflowSubjectLaunchTarget,
} from "../agent/workflow-subject-launch.js";
import { renderPrompt, toWorkspaceKey } from "../agent/workflow.js";
import { WorkspaceManager } from "../agent/workspace.js";
import type {
  CommitQueueScopeCommitRow,
  ProjectBranchScopeManagedRow,
  WorkflowProjectionQueryError,
  WorkflowProjectionIndex,
} from "../graph/modules/ops/workflow/query.js";
import type {
  CodexSessionLaunchRequest,
  CodexSessionLaunchFailure,
  CodexSessionLaunchResult,
  CodexSessionLaunchSubject,
  WorkflowTuiActionModel,
} from "./model.js";
import type { WorkflowTuiRuntimeBootstrap } from "./server.js";

type WorkflowTuiLaunchCoordinatorFactory = (workerId: string) => WorkflowSubjectLaunchCoordinator;

export interface WorkflowTuiLaunchActionExecutorOptions {
  createCoordinator?: WorkflowTuiLaunchCoordinatorFactory;
  getRuntime: () => WorkflowTuiRuntimeBootstrap | undefined;
  repoRoot: string;
  workflow: Workflow;
}

function createWorkspaceStateMissingFailure(
  subject: CodexSessionLaunchSubject,
  message: string,
): CodexSessionLaunchFailure {
  return {
    code: "workspace-state-missing",
    message,
    ok: false,
    subject,
  };
}

function createPolicyDeniedFailure(
  subject: CodexSessionLaunchSubject,
  message: string,
): CodexSessionLaunchFailure {
  return {
    code: "policy-denied",
    message,
    ok: false,
    subject,
  };
}

function createRepositoryMismatchFailure(
  subject: CodexSessionLaunchSubject,
  message: string,
): CodexSessionLaunchFailure {
  return {
    code: "repository-mismatch",
    message,
    ok: false,
    subject,
  };
}

function createSubjectLockedFailure(
  subject: CodexSessionLaunchSubject,
  message: string,
): CodexSessionLaunchFailure {
  return {
    code: "subject-locked",
    message,
    ok: false,
    subject,
  };
}

function isPolicyDeniedError(error: unknown): error is WorkflowProjectionQueryError {
  return (
    error instanceof Error &&
    error.name === "WorkflowProjectionQueryError" &&
    "code" in error &&
    error.code === "policy-denied"
  );
}

function mapLaunchError(
  subject: CodexSessionLaunchSubject,
  error: unknown,
): CodexSessionLaunchFailure | undefined {
  if (isPolicyDeniedError(error)) {
    return createPolicyDeniedFailure(
      subject,
      "The current operator scope does not allow launching the selected workflow subject.",
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  if (
    message.startsWith("worker_checkout_dirty:") ||
    message.startsWith("worker_checkout_dirty_on_start:")
  ) {
    return createSubjectLockedFailure(
      subject,
      "Another session already owns the selected workflow subject or its workspace checkout.",
    );
  }

  if (
    message.startsWith("issue_runtime_missing:") ||
    message.startsWith("source_repo_dirty_on_main:")
  ) {
    return createWorkspaceStateMissingFailure(
      subject,
      "The local repository checkout required for launch is not available in a launchable state.",
    );
  }

  return undefined;
}

function createBranchLaunchIssue(row: ProjectBranchScopeManagedRow): AgentIssue {
  const goalDocLine = row.workflowBranch.goalDocumentPath
    ? `- Goal document: \`${row.workflowBranch.goalDocumentPath}\``
    : undefined;

  return {
    blockedBy: [],
    createdAt: row.workflowBranch.createdAt,
    description: [
      "## Summary",
      "",
      `Launch a branch-scoped planning session for workflow branch \`${row.workflowBranch.branchKey}\`.`,
      "",
      "## Scope",
      "",
      `- Goal: ${row.workflowBranch.goalSummary}`,
      ...(goalDocLine ? [goalDocLine] : []),
    ].join("\n"),
    hasChildren: false,
    hasParent: false,
    id: row.workflowBranch.id,
    identifier: row.workflowBranch.branchKey,
    labels: ["planning"],
    priority: 3,
    projectSlug: row.workflowBranch.projectId,
    state: "Todo",
    title: row.workflowBranch.title,
    updatedAt: row.workflowBranch.updatedAt,
  };
}

function createCommitLaunchIssue(
  row: CommitQueueScopeCommitRow,
  branchRow: ProjectBranchScopeManagedRow,
): AgentIssue {
  return {
    blockedBy: [],
    createdAt: row.workflowCommit.createdAt,
    description: [
      "## Summary",
      "",
      `Launch a commit-scoped execution session for workflow commit \`${row.workflowCommit.commitKey}\`.`,
      "",
      "## Scope",
      "",
      `- Branch: ${branchRow.workflowBranch.branchKey}`,
      `- Commit: ${row.workflowCommit.title}`,
    ].join("\n"),
    hasChildren: false,
    hasParent: true,
    id: row.workflowCommit.id,
    identifier: row.workflowCommit.commitKey,
    labels: [],
    priority: 3,
    projectSlug: branchRow.workflowBranch.projectId,
    state: "Todo",
    title: row.workflowCommit.title,
    updatedAt: row.workflowCommit.updatedAt,
  };
}

async function buildLaunchPrompt(workflow: Workflow, repoRoot: string, issue: AgentIssue) {
  const selection = resolveIssueRouting(workflow.issues, issue, workflow.modules);
  const resolved = await resolveIssueContext({
    baseSelection: selection,
    issue,
    repoRoot,
    workflow,
  });
  const workspaceKey = toWorkspaceKey(issue.identifier);
  const workspace: PreparedWorkspace = {
    branchName: `io/${workspaceKey}`,
    controlPath: resolve(workflow.workspace.root, "workers", workspaceKey, "repo"),
    createdNow: false,
    originPath: workflow.workspace.origin ?? repoRoot,
    path: resolve(workflow.workspace.root, "tree", workspaceKey),
    workerId: workspaceKey,
  };

  return renderPrompt(renderContextBundle(resolved.bundle), {
    attempt: 1,
    issue: resolved.issue,
    selection: resolved.selection,
    worker: {
      count: 1,
      id: issue.identifier,
      index: 1,
    },
    workspace,
  });
}

function resolveBranchRow(
  projection: WorkflowProjectionIndex,
  projectId: string,
  branchId: string,
) {
  const branchBoard = projection.readProjectBranchScope({
    filter: {
      showUnmanagedRepositoryBranches: true,
    },
    projectId,
  });
  return {
    branchBoard,
    row: branchBoard.rows.find((entry) => entry.workflowBranch.id === branchId),
  };
}

function resolveCommitRow(projection: WorkflowProjectionIndex, branchId: string, commitId: string) {
  const commitQueue = projection.readCommitQueueScope({ branchId });
  return {
    commitQueue,
    row: commitQueue.rows.find((entry) => entry.workflowCommit.id === commitId),
  };
}

function createDefaultCoordinator(workflow: Workflow, repoRoot: string, workerId: string) {
  return new WorkflowSubjectLaunchCoordinator({
    runner: new CodexAppServerRunner(workflow.codex),
    workspaceManager: new WorkspaceManager({
      hooks: workflow.hooks,
      originPath: workflow.workspace.origin ?? repoRoot,
      repoRoot,
      rootDir: workflow.workspace.root,
      workerId,
    }),
  });
}

export function createWorkflowTuiLaunchActionExecutor(
  options: WorkflowTuiLaunchActionExecutorOptions,
) {
  return async (action: WorkflowTuiActionModel): Promise<CodexSessionLaunchResult | undefined> => {
    if (
      (action.id !== "branch-session" || action.subject.kind !== "branch") &&
      (action.id !== "commit-session" || action.subject.kind !== "commit")
    ) {
      return undefined;
    }

    const runtime = options.getRuntime();
    if (!runtime) {
      throw new Error("Workflow TUI runtime is not ready to launch sessions.");
    }
    const subject =
      action.subject.kind === "commit" && action.subject.commitId
        ? {
            branchId: action.subject.branchId,
            commitId: action.subject.commitId,
            kind: "commit" as const,
          }
        : ({
            branchId: action.subject.branchId,
            kind: "branch",
          } as const);

    try {
      const { branchBoard, row } = resolveBranchRow(
        runtime.projection,
        runtime.projectId,
        action.subject.branchId,
      );
      if (!row) {
        return createPolicyDeniedFailure(
          subject,
          "The selected workflow branch is no longer visible in the current workflow scope.",
        );
      }
      const managedBranchName = row.repositoryBranch?.repositoryBranch.branchName;
      const repositoryId = branchBoard.repository?.id;
      const repositoryRoot = branchBoard.repository?.repoRoot;
      if (!managedBranchName || !repositoryId || !repositoryRoot) {
        return createWorkspaceStateMissingFailure(
          subject,
          {
            branch:
              "The selected workflow branch does not have attached repository metadata for launch.",
            commit:
              "The selected workflow commit does not have attached repository metadata for launch.",
          }[action.subject.kind],
        );
      }

      if (resolve(repositoryRoot) !== resolve(options.repoRoot)) {
        return createRepositoryMismatchFailure(
          subject,
          `The selected workflow subject is attached to repository root "${repositoryRoot}", but io tui is running from "${options.repoRoot}".`,
        );
      }

      let issue: AgentIssue;
      let request: CodexSessionLaunchRequest;

      if (action.id === "branch-session" && action.subject.kind === "branch") {
        issue = createBranchLaunchIssue(row);
        request = {
          actorId: "principal:operator",
          kind: "planning",
          projectId: runtime.projectId,
          subject: {
            branchId: action.subject.branchId,
            kind: "branch",
          },
        };
      } else {
        const commitId = action.subject.commitId;
        if (!commitId) {
          return createWorkspaceStateMissingFailure(
            subject,
            "The selected workflow commit is missing the commit identifier required for launch.",
          );
        }
        const { row: commitRow } = resolveCommitRow(
          runtime.projection,
          action.subject.branchId,
          commitId,
        );
        if (!commitRow) {
          return createPolicyDeniedFailure(
            subject,
            "The selected workflow commit is no longer visible in the current branch commit queue.",
          );
        }
        issue = createCommitLaunchIssue(commitRow, row);
        request = {
          actorId: "principal:operator",
          kind: "execution",
          projectId: runtime.projectId,
          subject: {
            branchId: action.subject.branchId,
            commitId,
            kind: "commit",
          },
        };
      }

      const workerId = toWorkspaceKey(issue.identifier);
      const prompt = await buildLaunchPrompt(options.workflow, options.repoRoot, issue);
      const target: WorkflowSubjectLaunchTarget = {
        issue,
        managedBranchName,
        prompt,
        repositoryId,
        repositoryRoot,
      };
      const coordinator =
        options.createCoordinator?.(workerId) ??
        createDefaultCoordinator(options.workflow, options.repoRoot, workerId);
      const launched = await coordinator.launch(request, target);
      return launched.launch;
    } catch (error) {
      const failure = mapLaunchError(subject, error);
      if (failure) {
        return failure;
      }
      throw error;
    }
  };
}
