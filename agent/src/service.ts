import { createLogger, type Logger } from "@io/lib";
import { appendFile, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import type {
  AgentIssue,
  IssueRoutingSelection,
  IssueRunResult,
  PreparedWorkspace,
  Workflow,
} from "./types.js";

import {
  DEFAULT_BACKLOG_BUILTIN_DOC_IDS,
  DEFAULT_EXECUTE_BUILTIN_DOC_IDS,
  resolveBuiltinDoc,
} from "./builtins.js";
import { resolveIssueRouting } from "./issue-routing.js";
import { CodexAppServerRunner } from "./runner/codex.js";
import { LinearTrackerAdapter } from "./tracker/linear.js";
import { loadWorkflowFile, renderPrompt } from "./workflow.js";
import { WorkspaceManager } from "./workspace.js";

const WORKFLOW_FILE = "WORKFLOW.md";

type IssueRunner = {
  run: (options: {
    issue: AgentIssue;
    prompt: string;
    workspace: PreparedWorkspace;
  }) => Promise<IssueRunResult>;
};

export interface AgentServiceOptions {
  log?: Logger;
  once?: boolean;
  repoRoot?: string;
  runnerFactory?: (workflow: Workflow) => IssueRunner;
  workspaceManagerFactory?: (workflow: Workflow, issueIdentifier?: string) => WorkspaceManager;
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
  readonly #runnerFactory?: (workflow: Workflow) => IssueRunner;
  readonly #workflowPath?: string;
  readonly #workspaceManagerFactory?: (
    workflow: Workflow,
    issueIdentifier?: string,
  ) => WorkspaceManager;
  #activeRuns = new Map<string, Promise<IssueRunResult | undefined>>();
  #ready = false;
  #ticking = false;
  #timer?: Timer;

  constructor(options: AgentServiceOptions = {}) {
    this.#log = (options.log ?? createLogger({ level: "error", pkg: "agent" })).child({
      event_prefix: "service",
    });
    this.#once = options.once ?? false;
    this.#repoRoot = options.repoRoot ?? process.cwd();
    this.#runnerFactory = options.runnerFactory;
    this.#workflowPath = options.workflowPath
      ? resolve(this.#repoRoot, options.workflowPath)
      : undefined;
    this.#workspaceManagerFactory = options.workspaceManagerFactory;
  }

  async start() {
    const workflow = await this.#loadWorkflow();
    if (this.#once) {
      await this.runOnce(workflow, true);
      return;
    }
    await this.runOnce(workflow);
    this.#timer = setInterval(async () => {
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
    await Promise.all(this.#activeRuns.values());
  }

  async runOnce(workflow?: Workflow, waitForCompletion = false) {
    if (this.#ticking) {
      return [];
    }
    this.#ticking = true;
    try {
      const activeWorkflow = workflow ?? (await this.#loadWorkflow());
      await this.#ensureWorkerReady(activeWorkflow);
      const workspaceManager = this.#createWorkspaceManager(activeWorkflow);
      const tracker = new LinearTrackerAdapter(activeWorkflow.tracker, this.#log);
      await workspaceManager.reconcileTerminalIssues(
        tracker,
        activeWorkflow.tracker.terminalStates,
      );
      const issues = await tracker.fetchCandidateIssues();
      const maxConcurrentAgents = Math.max(1, activeWorkflow.agent.maxConcurrentAgents);
      const availableSlots = Math.max(0, maxConcurrentAgents - this.#activeRuns.size);
      if (availableSlots === 0) {
        return [];
      }
      const scheduledIssues = pickCandidateIssues(issues, issues.length)
        .filter((issue) => !this.#activeRuns.has(issue.identifier))
        .slice(0, availableSlots);
      if (!scheduledIssues.length) {
        this.#log.info("tick.idle");
        process.stdout.write("No issues\n");
        return [];
      }
      const runs = scheduledIssues.map((issue, index) =>
        this.#startIssueRun(activeWorkflow, issue, maxConcurrentAgents, index),
      );
      if (!waitForCompletion) {
        return [];
      }
      return (await Promise.all(runs)).filter((result): result is IssueRunResult =>
        Boolean(result),
      );
    } finally {
      this.#ticking = false;
    }
  }

  async #loadWorkflow(): Promise<Workflow> {
    const result = await loadWorkflowFile(this.#workflowPath, this.#repoRoot);
    if (!result.ok) {
      throw new Error(result.errors.map((error) => `${error.path}: ${error.message}`).join("\n"));
    }
    return result.value;
  }

  #startIssueRun(
    workflow: Workflow,
    issue: AgentIssue,
    maxConcurrentAgents: number,
    runIndex: number,
  ) {
    const run = this.#runIssue(workflow, issue, maxConcurrentAgents, runIndex)
      .catch((error) => {
        this.#log.error("issue.failed", {
          error: error instanceof Error ? error : new Error(String(error)),
          issueIdentifier: issue.identifier,
        });
        return undefined;
      })
      .finally(() => {
        this.#activeRuns.delete(issue.identifier);
      });
    this.#activeRuns.set(issue.identifier, run);
    return run;
  }

  async #runIssue(
    workflow: Workflow,
    issue: AgentIssue,
    maxConcurrentAgents: number,
    runIndex: number,
  ) {
    const workspaceManager = this.#createWorkspaceManager(workflow, issue.identifier);
    await workspaceManager.ensureSessionStartState();
    const workspace = await workspaceManager.prepare(issue);
    const assignmentLine = `${issue.identifier}: ${workspace.path} [${workspace.branchName}]\n`;
    await this.#appendIssueOutput(workspace.outputPath, assignmentLine);
    let beforeRunCompleted = false;
    let result: IssueRunResult;
    try {
      const selection = resolveIssueRouting(workflow.issues, issue);
      const prompt = renderPrompt(await this.#loadPromptTemplate(workflow, selection), {
        attempt: 1,
        issue,
        selection,
        worker: { count: maxConcurrentAgents, id: issue.identifier, index: runIndex },
        workspace,
      });
      const runner =
        this.#runnerFactory?.(workflow) ?? new CodexAppServerRunner(workflow.codex, this.#log);
      await workspaceManager.runBeforeRunHook(workspace.path);
      beforeRunCompleted = true;
      process.stdout.write(assignmentLine);
      result = await runner.run({ issue, prompt, workspace });
    } catch (error) {
      if (beforeRunCompleted) {
        await workspaceManager.runAfterRunHook(workspace.path);
      }
      await workspaceManager.markBlocked(workspace, issue);
      await this.#appendIssueOutput(workspace.outputPath, `${issue.identifier}: blocked\n`);
      throw error;
    }

    await workspaceManager.runAfterRunHook(workspace.path);
    if (!result.success) {
      await workspaceManager.markBlocked(workspace, issue);
      await this.#appendIssueOutput(workspace.outputPath, `${issue.identifier}: blocked\n`);
      this.#log.info("issue.checkout.preserved", {
        branchName: workspace.branchName,
        issueIdentifier: issue.identifier,
        workspace: workspace.path,
      });
      return result;
    }

    try {
      const completion = await workspaceManager.complete(workspace, issue);
      await this.#appendIssueOutput(
        workspace.outputPath,
        `${issue.identifier}: committed ${completion.commitSha} on ${workspace.branchName}\n`,
      );
      this.#log.info("issue.completed", {
        branchName: workspace.branchName,
        commitSha: completion.commitSha,
        issueIdentifier: issue.identifier,
        success: result.success,
        workspace: workspace.path,
      });
      this.#log.info("issue.worktree.retained", {
        branchName: workspace.branchName,
        issueIdentifier: issue.identifier,
        workspace: workspace.path,
      });
      return result;
    } catch (error) {
      await workspaceManager.markBlocked(workspace, issue);
      await this.#appendIssueOutput(workspace.outputPath, `${issue.identifier}: blocked\n`);
      throw error;
    }
  }

  #createWorkspaceManager(workflow: Workflow, issueIdentifier?: string) {
    return (
      this.#workspaceManagerFactory?.(workflow, issueIdentifier) ??
      new WorkspaceManager({
        hooks: workflow.hooks,
        log: this.#log,
        originPath: workflow.workspace.origin ?? this.#repoRoot,
        repoRoot: this.#repoRoot,
        rootDir: workflow.workspace.root,
        workerId: issueIdentifier ?? "supervisor",
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
    process.stdout.write(`ready at ${path}\n`);
    this.#ready = true;
  }

  async #appendIssueOutput(path: string | undefined, text: string) {
    if (!path) {
      return;
    }
    await appendFile(path, text);
  }

  async #loadPromptTemplate(workflow: Workflow, selection: IssueRoutingSelection) {
    if (
      workflow.entrypoint.kind !== "io" ||
      basename(workflow.entrypoint.promptPath) === WORKFLOW_FILE
    ) {
      return workflow.promptTemplate;
    }

    const builtinIds =
      selection.agent === "backlog"
        ? DEFAULT_BACKLOG_BUILTIN_DOC_IDS
        : DEFAULT_EXECUTE_BUILTIN_DOC_IDS;
    const sections = await Promise.all(
      builtinIds.map(async (id) => {
        const overridePath = workflow.context.overrides[id];
        if (overridePath) {
          const content = (await readFile(overridePath, "utf8")).trim();
          if (!content) {
            throw new Error(`workflow_doc_empty:${overridePath}`);
          }
          return { content, id };
        }
        const builtinDoc = resolveBuiltinDoc(id);
        if (!builtinDoc) {
          throw new Error(`workflow_doc_missing:${id}`);
        }
        return builtinDoc;
      }),
    );

    const projectPrompt = workflow.promptTemplate.trim();
    if (!projectPrompt) {
      throw new Error(`workflow_prompt_empty:${workflow.entrypoint.promptPath}`);
    }

    return [
      ...sections.map((section) => `<!-- ${section.id} -->\n${section.content.trim()}`),
      `<!-- ${workflow.entrypoint.promptPath} -->\n${projectPrompt}`,
    ].join("\n\n");
  }
}
