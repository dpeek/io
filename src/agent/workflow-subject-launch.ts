import type {
  CodexSessionLaunchRequest,
  CodexSessionLaunchSubject,
  CodexSessionLaunchSuccess,
} from "../tui/index.js";
import type { CodexAppServerLaunch } from "./runner/codex.js";
import { createWorkerSessionRef } from "./session.js";
import type { AgentSessionRef } from "./tui/index.js";
import type { AgentIssue, IssueRunResult, PreparedWorkspace } from "./types.js";
import { WorkspaceManager } from "./workspace.js";

type CodexSessionLauncher = {
  launch: (options: {
    issue: AgentIssue;
    prompt: string;
    session?: AgentSessionRef;
    workspace: PreparedWorkspace;
  }) => Promise<CodexAppServerLaunch>;
};

export interface WorkflowSubjectLaunchTarget {
  issue: AgentIssue;
  managedBranchName: string;
  prompt: string;
  repositoryId: string;
  repositoryRoot?: string;
  session?: AgentSessionRef;
}

export interface WorkflowSubjectLaunchResult {
  completion?: Promise<IssueRunResult>;
  launch: CodexSessionLaunchSuccess;
  workspacePath?: string;
}

export class WorkflowSubjectLaunchCoordinator {
  readonly #runner: CodexSessionLauncher;
  readonly #workspaceManager: WorkspaceManager;
  #sessionCount = 0;

  constructor(options: { runner: CodexSessionLauncher; workspaceManager: WorkspaceManager }) {
    this.#runner = options.runner;
    this.#workspaceManager = options.workspaceManager;
  }

  async launch(
    request: CodexSessionLaunchRequest,
    target: WorkflowSubjectLaunchTarget,
  ): Promise<WorkflowSubjectLaunchResult> {
    const runningState = await this.#workspaceManager.readIssueState(target.issue.identifier);
    if (
      runningState?.status === "running" &&
      runningState.sessionId &&
      runningState.threadId &&
      runningState.turnId
    ) {
      return {
        launch: this.#buildSuccess(request, target, {
          disposition: "attached",
          sessionId: runningState.sessionId,
          worktreePath: runningState.worktreePath,
        }),
        workspacePath: runningState.worktreePath,
      };
    }

    const workspace = await this.#workspaceManager.prepare(target.issue);
    const session = target.session ?? this.#createSession(target.issue, workspace);
    const launched = await this.#runner.launch({
      issue: target.issue,
      prompt: target.prompt,
      session,
      workspace,
    });
    await this.#workspaceManager.recordSessionLaunch(target.issue.identifier, {
      sessionId: launched.session.id,
      threadId: launched.threadId,
      turnId: launched.turnId,
    });
    return {
      completion: launched.completion,
      launch: this.#buildSuccess(request, target, {
        disposition: "launched",
        sessionId: launched.session.id,
        worktreePath: workspace.path,
      }),
      workspacePath: workspace.path,
    };
  }

  #buildSuccess(
    request: CodexSessionLaunchRequest,
    target: WorkflowSubjectLaunchTarget,
    options: {
      disposition: "attached" | "launched";
      sessionId: string;
      worktreePath?: string;
    },
  ): CodexSessionLaunchSuccess {
    return {
      launch: {
        attach: {
          sessionId: options.sessionId,
        },
        disposition: options.disposition,
        managedBranchName: target.managedBranchName,
        repositoryId: target.repositoryId,
        repositoryRoot: target.repositoryRoot,
        worktreePath: options.worktreePath,
      },
      ok: true,
      session: {
        id: options.sessionId,
        kind: request.kind,
        subject: this.#cloneSubject(request.subject),
      },
    };
  }

  #cloneSubject(subject: CodexSessionLaunchSubject): CodexSessionLaunchSubject {
    return { ...subject };
  }

  #createSession(issue: AgentIssue, workspace: PreparedWorkspace) {
    this.#sessionCount += 1;
    return createWorkerSessionRef({
      issue,
      rootSessionId: "supervisor",
      sessionNumber: this.#sessionCount,
      workspace,
    });
  }
}
