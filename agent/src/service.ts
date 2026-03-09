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
  workspaceManagerFactory?: (workflow: Workflow) => WorkspaceManager;
  workflowPath?: string;
  workerCount?: number;
  workerId?: string;
  workerIndex?: number;
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

function deriveWorkerIndex(workerId: string) {
  const match = /(\d+)$/.exec(workerId);
  return match ? Math.max(0, Number(match[1]) - 1) : 0;
}

export function pickAssignedIssue(issues: AgentIssue[], workerCount: number, workerIndex: number) {
  return pickCandidateIssues(issues, Math.max(1, workerCount))[workerIndex];
}

export class AgentService {
  readonly #log: Logger;
  readonly #once: boolean;
  readonly #repoRoot: string;
  readonly #workflowPath: string;
  readonly #workspaceManagerFactory?: (workflow: Workflow) => WorkspaceManager;
  readonly #workerCount?: number;
  readonly #workerId: string;
  readonly #workerIndex: number;
  #ready = false;
  #running = false;
  #timer?: Timer;

  constructor(options: AgentServiceOptions = {}) {
    this.#log = (options.log ?? createLogger({ level: "error", pkg: "agent" })).child({
      event_prefix: "service",
    });
    this.#once = options.once ?? false;
    this.#repoRoot = options.repoRoot ?? process.cwd();
    this.#workflowPath = resolve(this.#repoRoot, options.workflowPath ?? "WORKFLOW.md");
    this.#workspaceManagerFactory = options.workspaceManagerFactory;
    this.#workerId = options.workerId ?? `worker-${(options.workerIndex ?? 0) + 1}`;
    this.#workerIndex = options.workerIndex ?? deriveWorkerIndex(this.#workerId);
    this.#workerCount = options.workerCount;
  }

  async start() {
    const workflow = await this.#loadWorkflow();
    await this.#ensureWorkerReady(workflow);
    if (this.#once) {
      await this.runOnce(workflow);
      return;
    }
    await this.runOnce(workflow);
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

  async runOnce(workflow?: Workflow) {
    if (this.#running) {
      return [];
    }
    this.#running = true;
    try {
      const activeWorkflow = workflow ?? (await this.#loadWorkflow());
      await this.#ensureWorkerReady(activeWorkflow);
      const tracker = new LinearTrackerAdapter(activeWorkflow.tracker, this.#log);
      const issues = await tracker.fetchCandidateIssues();
      const workerCount = Math.max(1, this.#workerCount ?? activeWorkflow.agent.maxConcurrentAgents);
      const assigned = pickAssignedIssue(issues, workerCount, this.#workerIndex);
      if (!assigned) {
        this.#log.info("tick.idle");
        process.stdout.write(`${this.#workerId}: No issues\n`);
        return [];
      }
      return [await this.#runIssue(activeWorkflow, assigned, workerCount)];
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

  async #runIssue(workflow: Workflow, issue: AgentIssue, workerCount: number) {
    const workspaceManager = this.#createWorkspaceManager(workflow);
    const workspace = await workspaceManager.prepare(issue);
    await workspaceManager.runBeforeRunHook(workspace.path);
    process.stdout.write(
      `${this.#workerId}: ${issue.identifier} -> ${workspace.path} [${workspace.branchName}]\n`,
    );
    const prompt = renderPrompt(workflow.promptTemplate, {
      attempt: 1,
      issue,
      worker: { count: workerCount, id: this.#workerId, index: this.#workerIndex },
      workspace,
    });
    const runner = new CodexAppServerRunner(workflow.codex, this.#log);
    let result: IssueRunResult | undefined;
    try {
      result = await runner.run({ issue, prompt, workspace });
      this.#log.info("issue.completed", {
        branchName: workspace.branchName,
        issueIdentifier: issue.identifier,
        success: result.success,
        workspace: workspace.path,
      });
      return result;
    } finally {
      await workspaceManager.runAfterRunHook(workspace.path);
      if (result?.success) {
        try {
          await workspaceManager.cleanup(workspace);
          this.#log.info("issue.checkout.released", {
            branchName: workspace.branchName,
            issueIdentifier: issue.identifier,
            workspace: workspace.path,
          });
        } catch (error) {
          this.#log.error(
            "issue.checkout.release_failed",
            error instanceof Error ? error : new Error(String(error)),
            {
              branchName: workspace.branchName,
              issueIdentifier: issue.identifier,
              workspace: workspace.path,
            },
          );
        }
      } else {
        await workspaceManager.markBlocked(workspace, issue);
        this.#log.info("issue.checkout.preserved", {
          branchName: workspace.branchName,
          issueIdentifier: issue.identifier,
          workspace: workspace.path,
        });
      }
    }
  }

  #createWorkspaceManager(workflow: Workflow) {
    return (
      this.#workspaceManagerFactory?.(workflow) ??
      new WorkspaceManager({
        hooks: workflow.hooks,
        log: this.#log,
        originPath: workflow.workspace.origin ?? this.#repoRoot,
        repoRoot: this.#repoRoot,
        rootDir: workflow.workspace.root,
        workerId: this.#workerId,
      })
    );
  }

  async #ensureWorkerReady(workflow: Workflow) {
    if (this.#ready) {
      return;
    }
    const workspaceManager = this.#createWorkspaceManager(workflow);
    const { path } = await workspaceManager.ensureSessionStartState();
    const workspace = workspaceManager.createIdleWorkspace();
    await workspaceManager.cleanup(workspace);
    process.stdout.write(`${this.#workerId}: ready at ${path}\n`);
    this.#ready = true;
  }
}
