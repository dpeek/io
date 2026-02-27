import { createLogger, type Logger } from "@io/lib";
import { resolve } from "node:path";

import type { AgentIssue, IssueRunResult, Workflow } from "./types.js";

import { CodexAppServerRunner } from "./runner/codex.js";
import { LinearTrackerAdapter } from "./tracker/linear.js";
import { loadWorkflowFile, renderPrompt } from "./workflow.js";
import { WorkspaceManager } from "./workspace.js";

export interface AgentServiceOptions {
  log?: Logger;
  once?: boolean;
  repoRoot?: string;
  workflowPath?: string;
}

export function pickCandidateIssues(issues: AgentIssue[], limit: number) {
  return [...issues]
    .filter((issue) => issue.blockedBy.length === 0)
    .sort((left, right) => {
      const stateScore = scoreState(left.state) - scoreState(right.state);
      if (stateScore !== 0) {
        return stateScore;
      }
      const priorityScore = (right.priority ?? -1) - (left.priority ?? -1);
      if (priorityScore !== 0) {
        return priorityScore;
      }
      return left.updatedAt.localeCompare(right.updatedAt);
    })
    .slice(0, limit);
}

function scoreState(state: string) {
  const normalized = state.trim().toLowerCase();
  if (normalized === "todo") {
    return 0;
  }
  if (normalized === "in progress") {
    return 1;
  }
  return 2;
}

export class AgentService {
  readonly #log: Logger;
  readonly #once: boolean;
  readonly #repoRoot: string;
  readonly #workflowPath: string;
  #running = false;
  #timer?: Timer;

  constructor(options: AgentServiceOptions = {}) {
    this.#log = (options.log ?? createLogger({ pkg: "agent" })).child({
      event_prefix: "service",
    });
    this.#once = options.once ?? false;
    this.#repoRoot = options.repoRoot ?? process.cwd();
    this.#workflowPath = resolve(this.#repoRoot, options.workflowPath ?? "WORKFLOW.md");
  }

  async start() {
    if (this.#once) {
      await this.runOnce();
      return;
    }
    await this.runOnce();
    const workflow = await this.#loadWorkflow();
    this.#timer = setInterval(async () => {
      if (this.#running) {
        return;
      }
      try {
        await this.runOnce();
      } catch (error) {
        this.#log.error("tick.failed", error instanceof Error ? error : new Error(String(error)));
      }
    }, workflow.polling.intervalMs);
  }

  async stop() {
    if (this.#timer) {
      clearInterval(this.#timer);
    }
  }

  async runOnce() {
    if (this.#running) {
      return [];
    }
    this.#running = true;
    try {
      const workflow = await this.#loadWorkflow();
      const tracker = new LinearTrackerAdapter(workflow.tracker, this.#log);
      const issues = await tracker.fetchCandidateIssues();
      const selected = pickCandidateIssues(issues, workflow.agent.maxConcurrentAgents);
      if (!selected.length) {
        this.#log.info("tick.idle");
        return [];
      }
      const results: IssueRunResult[] = [];
      for (const issue of selected) {
        results.push(await this.#runIssue(workflow, issue));
      }
      return results;
    } finally {
      this.#running = false;
    }
  }

  async #loadWorkflow(): Promise<Workflow> {
    const result = await loadWorkflowFile(this.#workflowPath);
    if (!result.ok) {
      throw new Error(result.errors.map((error) => `${error.path}: ${error.message}`).join("\n"));
    }
    return result.value;
  }

  async #runIssue(workflow: Workflow, issue: AgentIssue) {
    const workspaceManager = new WorkspaceManager({
      hooks: workflow.hooks,
      log: this.#log,
      repoRoot: this.#repoRoot,
      rootDir: workflow.workspace.root,
    });
    const workspace = await workspaceManager.prepare(issue);
    await workspaceManager.runBeforeRunHook(workspace.path);
    const prompt = renderPrompt(workflow.promptTemplate, { attempt: 1, issue });
    const runner = new CodexAppServerRunner(workflow.codex, this.#log);
    let cleanupWorktree = false;
    try {
      const result = await runner.run({ issue, prompt, workspace });
      cleanupWorktree = result.success;
      this.#log.info("issue.completed", {
        branchName: workspace.branchName,
        issueIdentifier: issue.identifier,
        success: result.success,
        workspace: workspace.path,
      });
      return result;
    } finally {
      await workspaceManager.runAfterRunHook(workspace.path);
      if (cleanupWorktree) {
        try {
          await workspaceManager.cleanup(workspace);
          this.#log.info("issue.worktree.cleaned", {
            branchName: workspace.branchName,
            issueIdentifier: issue.identifier,
            workspace: workspace.path,
          });
        } catch (error) {
          this.#log.error(
            "issue.worktree.cleanup_failed",
            error instanceof Error ? error : new Error(String(error)),
            {
              branchName: workspace.branchName,
              issueIdentifier: issue.identifier,
              workspace: workspace.path,
            },
          );
        }
      } else {
        this.#log.info("issue.worktree.preserved", {
          branchName: workspace.branchName,
          issueIdentifier: issue.identifier,
          workspace: workspace.path,
        });
      }
    }
  }
}
