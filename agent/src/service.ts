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
import {
  createAgentSessionEventBus,
  createAgentSessionStdoutObserver,
  type AgentSessionEventBus,
  type AgentSessionEventObserver,
  type AgentSessionRef,
} from "./session-events.js";
import { resolveIssueRouting } from "./issue-routing.js";
import { CodexAppServerRunner } from "./runner/codex.js";
import { LinearTrackerAdapter } from "./tracker/linear.js";
import { loadWorkflowFile, renderPrompt, toWorkspaceKey } from "./workflow.js";
import { WorkspaceManager } from "./workspace.js";

const WORKFLOW_FILE = "WORKFLOW.md";

type IssueRunner = {
  run: (options: {
    issue: AgentIssue;
    prompt: string;
    session?: AgentSessionRef;
    workspace: PreparedWorkspace;
  }) => Promise<IssueRunResult>;
};

type IssueTracker = {
  fetchCandidateIssues: () => Promise<AgentIssue[]>;
  fetchIssueStatesByIds: (issueIds: string[]) => Promise<Map<string, string>>;
  setIssueState: (issueId: string, stateName: string) => Promise<void>;
};

export interface AgentServiceOptions {
  log?: Logger;
  once?: boolean;
  repoRoot?: string;
  runnerFactory?: (workflow: Workflow) => IssueRunner;
  trackerFactory?: (workflow: Workflow) => IssueTracker;
  sessionEvents?: AgentSessionEventBus;
  stdoutEvents?: boolean;
  workspaceManagerFactory?: (workflow: Workflow, issueIdentifier?: string) => WorkspaceManager;
  workflowPath?: string;
}

export function pickCandidateIssues(issues: AgentIssue[], limit: number) {
  const selected: AgentIssue[] = [];
  const reservedStreams = new Set<string>();
  for (const issue of [...issues]
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
    })) {
    const streamKey = getStreamKey(issue);
    if (reservedStreams.has(streamKey)) {
      continue;
    }
    reservedStreams.add(streamKey);
    selected.push(issue);
    if (selected.length >= limit) {
      break;
    }
  }
  return selected;
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

function getStreamKey(issue: AgentIssue) {
  return toWorkspaceKey(issue.parentIssueIdentifier ?? issue.identifier);
}

function isResumableRunError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return ["response_timeout", "stall_timeout", "turn_timeout"].includes(error.message);
}

export class AgentService {
  readonly #log: Logger;
  readonly #once: boolean;
  readonly #repoRoot: string;
  readonly #runnerFactory?: (workflow: Workflow) => IssueRunner;
  readonly #trackerFactory?: (workflow: Workflow) => IssueTracker;
  readonly #sessionEvents: AgentSessionEventBus;
  readonly #supervisorSession: AgentSessionRef;
  readonly #workflowPath?: string;
  readonly #workspaceManagerFactory?: (
    workflow: Workflow,
    issueIdentifier?: string,
  ) => WorkspaceManager;
  #activeRuns = new Map<string, Promise<IssueRunResult | undefined>>();
  #activeStreamKeys = new Set<string>();
  #ready = false;
  #ticking = false;
  #timer?: Timer;
  #workerSessionCount = 0;

  constructor(options: AgentServiceOptions = {}) {
    this.#log = (options.log ?? createLogger({ level: "error", pkg: "agent" })).child({
      event_prefix: "service",
    });
    this.#once = options.once ?? false;
    this.#repoRoot = options.repoRoot ?? process.cwd();
    this.#runnerFactory = options.runnerFactory;
    this.#trackerFactory = options.trackerFactory;
    this.#workflowPath = options.workflowPath
      ? resolve(this.#repoRoot, options.workflowPath)
      : undefined;
    this.#workspaceManagerFactory = options.workspaceManagerFactory;
    this.#sessionEvents = options.sessionEvents ?? createAgentSessionEventBus();
    this.#supervisorSession = {
      id: "supervisor",
      kind: "supervisor",
      rootSessionId: "supervisor",
      title: "Supervisor",
      workerId: "supervisor",
      workspacePath: this.#repoRoot,
    };
    if (options.stdoutEvents ?? true) {
      this.observeSessionEvents(createAgentSessionStdoutObserver());
    }
  }

  async start() {
    this.#sessionEvents.publish({
      phase: "started",
      session: this.#supervisorSession,
      type: "session",
    });
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
    this.#sessionEvents.publish({
      phase: "stopped",
      session: this.#supervisorSession,
      type: "session",
    });
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
      const tracker = this.#createTracker(activeWorkflow);
      await workspaceManager.reconcileTerminalIssues(
        tracker,
        activeWorkflow.tracker.terminalStates,
      );
      const occupiedStreams = await workspaceManager.listOccupiedStreams();
      const issues = await tracker.fetchCandidateIssues();
      const maxConcurrentAgents = Math.max(1, activeWorkflow.agent.maxConcurrentAgents);
      const availableSlots = Math.max(0, maxConcurrentAgents - this.#activeRuns.size);
      if (availableSlots === 0) {
        return [];
      }
      const scheduledIssues = pickCandidateIssues(
        issues.filter((issue) => this.#shouldAutoScheduleIssue(activeWorkflow, issue)),
        issues.length,
      )
        .filter((issue) => !this.#activeRuns.has(issue.identifier))
        .filter((issue) => !this.#activeStreamKeys.has(getStreamKey(issue)))
        .filter((issue) => {
          const activeIssueIdentifier = occupiedStreams.get(getStreamKey(issue));
          return !activeIssueIdentifier || activeIssueIdentifier === issue.identifier;
        })
        .slice(0, availableSlots);
      if (!scheduledIssues.length) {
        this.#log.info("tick.idle");
        this.#sessionEvents.publish({
          code: "idle",
          format: "line",
          session: this.#supervisorSession,
          text: "No issues",
          type: "status",
        });
        return [];
      }
      const runs = scheduledIssues.map((issue, index) =>
        this.#startIssueRun(activeWorkflow, tracker, issue, maxConcurrentAgents, index),
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
    tracker: IssueTracker,
    issue: AgentIssue,
    maxConcurrentAgents: number,
    runIndex: number,
  ) {
    const streamKey = getStreamKey(issue);
    this.#activeStreamKeys.add(streamKey);
    const run = this.#runIssue(workflow, tracker, issue, maxConcurrentAgents, runIndex)
      .catch((error) => {
        this.#log.error("issue.failed", {
          error: error instanceof Error ? error : new Error(String(error)),
          issueIdentifier: issue.identifier,
        });
        return undefined;
      })
      .finally(() => {
        this.#activeRuns.delete(issue.identifier);
        this.#activeStreamKeys.delete(streamKey);
      });
    this.#activeRuns.set(issue.identifier, run);
    return run;
  }

  #shouldAutoScheduleIssue(workflow: Workflow, issue: AgentIssue) {
    if (!issue.hasChildren || issue.hasParent) {
      return true;
    }
    return resolveIssueRouting(workflow.issues, issue).agent === "backlog";
  }

  async #runIssue(
    workflow: Workflow,
    tracker: IssueTracker,
    issue: AgentIssue,
    maxConcurrentAgents: number,
    runIndex: number,
  ) {
    const workspaceManager = this.#createWorkspaceManager(workflow, issue.identifier);
    await workspaceManager.ensureSessionStartState();
    const workspace = await workspaceManager.prepare(issue);
    const session = this.#createWorkerSession(issue, workspace);
    const assignmentLine = `${issue.identifier}: ${workspace.path} [${workspace.branchName}]\n`;
    this.#sessionEvents.publish({
      data: {
        branchName: workspace.branchName,
        workspacePath: workspace.path,
      },
      phase: "scheduled",
      session,
      type: "session",
    });
    this.#sessionEvents.publish({
      code: "issue-assigned",
      data: {
        branchName: workspace.branchName,
        childSessionId: session.id,
        workspacePath: workspace.path,
      },
      format: "line",
      session: this.#supervisorSession,
      text: assignmentLine.trimEnd(),
      type: "status",
    });
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
        this.#runnerFactory?.(workflow) ??
        new CodexAppServerRunner(workflow.codex, this.#log, {
          sessionEvents: this.#sessionEvents,
        });
      await tracker.setIssueState(issue.id, "In Progress");
      await workspaceManager.runBeforeRunHook(workspace.path);
      beforeRunCompleted = true;
      result = await runner.run({ issue, prompt, session, workspace });
    } catch (error) {
      if (beforeRunCompleted) {
        await workspaceManager.runAfterRunHook(workspace.path);
      }
      const reason = error instanceof Error ? error.message : String(error);
      if (isResumableRunError(error)) {
        await workspaceManager.markInterrupted(workspace, issue);
        await this.#appendIssueOutput(workspace.outputPath, `${issue.identifier}: interrupted\n`);
      } else {
        await workspaceManager.markBlocked(workspace, issue);
        await this.#appendIssueOutput(workspace.outputPath, `${issue.identifier}: blocked\n`);
        this.#sessionEvents.publish({
          code: "issue-blocked",
          format: "line",
          session,
          text: `${issue.identifier}: blocked`,
          type: "status",
        });
      }
      this.#sessionEvents.publish({
        data: { reason },
        phase: "failed",
        session,
        type: "session",
      });
      throw error;
    }

    await workspaceManager.runAfterRunHook(workspace.path);
    if (!result.success) {
      await workspaceManager.markBlocked(workspace, issue);
      await this.#appendIssueOutput(workspace.outputPath, `${issue.identifier}: blocked\n`);
      this.#sessionEvents.publish({
        code: "issue-blocked",
        format: "line",
        session,
        text: `${issue.identifier}: blocked`,
        type: "status",
      });
      this.#sessionEvents.publish({
        phase: "failed",
        session,
        type: "session",
      });
      this.#log.info("issue.checkout.preserved", {
        branchName: workspace.branchName,
        issueIdentifier: issue.identifier,
        workspace: workspace.path,
      });
      return result;
    }

    let completion: { commitSha: string };
    try {
      completion = await workspaceManager.complete(workspace, issue);
    } catch (error) {
      await workspaceManager.markBlocked(workspace, issue);
      await this.#appendIssueOutput(workspace.outputPath, `${issue.identifier}: blocked\n`);
      this.#sessionEvents.publish({
        code: "issue-blocked",
        format: "line",
        session,
        text: `${issue.identifier}: blocked`,
        type: "status",
      });
      this.#sessionEvents.publish({
        data: {
          reason: error instanceof Error ? error.message : String(error),
        },
        phase: "failed",
        session,
        type: "session",
      });
      throw error;
    }
    await this.#appendIssueOutput(
      workspace.outputPath,
      `${issue.identifier}: committed ${completion.commitSha} on ${workspace.branchName}\n`,
    );
    this.#sessionEvents.publish({
      code: "issue-committed",
      data: {
        branchName: workspace.branchName,
        commitSha: completion.commitSha,
      },
      format: "line",
      session,
      text: `${issue.identifier}: committed ${completion.commitSha} on ${workspace.branchName}`,
      type: "status",
    });
    this.#sessionEvents.publish({
      data: {
        commitSha: completion.commitSha,
      },
      phase: "completed",
      session,
      type: "session",
    });
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
    if (issue.hasParent) {
      await tracker.setIssueState(issue.id, "Done");
      return result;
    }
    await tracker.setIssueState(issue.id, "In Review");
    return result;
  }

  observeSessionEvents(observer: AgentSessionEventObserver) {
    return this.#sessionEvents.subscribe(observer);
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

  #createTracker(workflow: Workflow) {
    return (
      this.#trackerFactory?.(workflow) ?? new LinearTrackerAdapter(workflow.tracker, this.#log)
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
    this.#sessionEvents.publish({
      code: "ready",
      format: "line",
      session: this.#supervisorSession,
      text: `ready at ${path}`,
      type: "status",
    });
    this.#ready = true;
  }

  #createWorkerSession(issue: AgentIssue, workspace: PreparedWorkspace): AgentSessionRef {
    this.#workerSessionCount += 1;
    return {
      branchName: workspace.branchName,
      id: `worker:${workspace.workerId}:${this.#workerSessionCount}`,
      issue: {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
      },
      kind: "worker",
      parentSessionId: this.#supervisorSession.id,
      rootSessionId: this.#supervisorSession.rootSessionId,
      title: issue.title,
      workerId: workspace.workerId,
      workspacePath: workspace.path,
    };
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
