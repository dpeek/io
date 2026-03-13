import { appendFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { createLogger, type Logger } from "@io/lib";

import { renderContextBundle, resolveIssueContext, summarizeContextBundle } from "./context.js";
import { resolveIssueRouting } from "./issue-routing.js";
import { CodexAppServerRunner } from "./runner/codex.js";
import {
  createAgentSessionEventBus,
  createAgentSessionStdoutObserver,
  type AgentSessionEventBus,
  type AgentSessionEventObserver,
  type AgentSessionRef,
} from "./session-events.js";
import { LinearTrackerAdapter } from "./tracker/linear.js";
import type {
  AgentIssue,
  IssueRunResult,
  IssueTracker,
  PreparedWorkspace,
  Workflow,
} from "./types.js";
import { loadWorkflowFile, renderPrompt, toWorkspaceKey } from "./workflow.js";
import { WorkspaceManager, type IssueRuntimeState } from "./workspace.js";

type IssueRunner = {
  run: (options: {
    issue: AgentIssue;
    prompt: string;
    session?: AgentSessionRef;
    workspace: PreparedWorkspace;
  }) => Promise<IssueRunResult>;
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

export function pickCandidateIssues(
  issues: AgentIssue[],
  limit: number,
  preferredIssueIdentifierByStream = new Map<string, string>(),
) {
  const selected: AgentIssue[] = [];
  const reservedStreams = new Set<string>();
  for (const issue of [...issues]
    .filter((issue) => issue.blockedBy.length === 0)
    .sort((left, right) => {
      const leftPreferred =
        preferredIssueIdentifierByStream.get(getStreamKey(left)) === left.identifier;
      const rightPreferred =
        preferredIssueIdentifierByStream.get(getStreamKey(right)) === right.identifier;
      if (leftPreferred !== rightPreferred) {
        return leftPreferred ? -1 : 1;
      }
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
  const normalized = normalizeState(state);
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

function normalizeState(state?: string) {
  return state?.trim().toLowerCase() ?? "";
}

function isInProgressState(state?: string) {
  return normalizeState(state) === "in progress";
}

function isExecutionReleased(issue: AgentIssue) {
  if (!isTaskIssue(issue)) {
    return false;
  }
  if (!issue.parentIssueState || !isInProgressState(issue.parentIssueState)) {
    return false;
  }
  if (!issue.streamIssueState || !isInProgressState(issue.streamIssueState)) {
    return false;
  }
  return true;
}

function isResumableRunError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return ["response_timeout", "stall_timeout", "turn_timeout"].includes(error.message);
}

const MAX_RUN_ATTEMPTS_PER_SUPERVISOR_CYCLE = 2;

function hasSeparateFeature(
  issue: Pick<AgentIssue, "parentIssueIdentifier" | "streamIssueIdentifier">,
) {
  return Boolean(
    issue.parentIssueIdentifier &&
      issue.streamIssueIdentifier &&
      issue.parentIssueIdentifier !== issue.streamIssueIdentifier,
  );
}

function isTaskIssue(
  issue: Pick<
    AgentIssue,
    "hasChildren" | "hasParent" | "parentIssueIdentifier" | "streamIssueIdentifier"
  >,
) {
  return issue.hasParent && !issue.hasChildren && hasSeparateFeature(issue);
}

function formatWorkflowScope(
  issue:
    | Pick<AgentIssue, "hasParent" | "identifier" | "parentIssueIdentifier" | "streamIssueIdentifier">
    | Pick<IssueRuntimeState, "issueIdentifier" | "parentIssueIdentifier" | "streamIssueIdentifier">,
) {
  const issueIdentifier = "issueIdentifier" in issue ? issue.issueIdentifier : issue.identifier;
  const hasParent = "hasParent" in issue ? issue.hasParent : Boolean(issue.parentIssueIdentifier);
  const streamIssueIdentifier =
    issue.streamIssueIdentifier ?? issue.parentIssueIdentifier ?? issueIdentifier;
  const featureIssueIdentifier =
    issue.parentIssueIdentifier && hasSeparateFeature(issue)
      ? issue.parentIssueIdentifier
      : undefined;
  const parts = [`stream ${streamIssueIdentifier}`];
  if (featureIssueIdentifier) {
    parts.push(`feature ${featureIssueIdentifier}`);
  }
  if (hasParent) {
    parts.push(`task ${issueIdentifier}`);
  }
  return parts.join(" / ");
}

function formatDiagnosticList(values: string[], limit = 3) {
  const ordered = [...values].sort((left, right) => left.localeCompare(right));
  if (ordered.length <= limit) {
    return ordered.join("; ");
  }
  return `${ordered.slice(0, limit).join("; ")}; (+${ordered.length - limit} more)`;
}

function formatRetainedIssueLine(issue: IssueRuntimeState) {
  return `${formatWorkflowScope(issue)} on ${issue.branchName}`;
}

function formatDependencyBlockedIssueLine(issue: AgentIssue) {
  return `${formatWorkflowScope(issue)} blocked by ${issue.blockedBy.join(", ")}`;
}

function formatRunnableIssueLine(issue: AgentIssue) {
  return formatWorkflowScope(issue);
}

function formatCount(count: number, label: string) {
  return `${count} ${label}`;
}

function formatExecutionReleaseIssueLine(issue: AgentIssue) {
  const waitingOn: string[] = [];
  if (issue.parentIssueIdentifier && !isInProgressState(issue.parentIssueState)) {
    const parentLabel = hasSeparateFeature(issue) ? "feature" : "stream";
    waitingOn.push(
      issue.parentIssueState
        ? `${parentLabel} ${issue.parentIssueIdentifier} is ${issue.parentIssueState}`
        : `${parentLabel} ${issue.parentIssueIdentifier} state is unknown`,
    );
  }
  if (issue.streamIssueIdentifier && !isInProgressState(issue.streamIssueState)) {
    waitingOn.push(
      issue.streamIssueState
        ? `stream ${issue.streamIssueIdentifier} is ${issue.streamIssueState}`
        : `stream ${issue.streamIssueIdentifier} state is unknown`,
    );
  }
  if (!waitingOn.length) {
    return formatWorkflowScope(issue);
  }
  return `${formatWorkflowScope(issue)} (${waitingOn.join("; ")})`;
}

function formatOccupiedIssueLine(
  issue: AgentIssue,
  activeIssueIdentifier: string,
  activeIssueState?: IssueRuntimeState,
) {
  const status = activeIssueState?.status ?? "active";
  return `${formatWorkflowScope(issue)} held by ${activeIssueIdentifier} [${status}]`;
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
      const retainedIssues = await this.#listRetainedIssues(workspaceManager);
      const issues = await tracker.fetchCandidateIssues();
      const maxConcurrentAgents = Math.max(1, activeWorkflow.agent.maxConcurrentAgents);
      const availableSlots = Math.max(0, maxConcurrentAgents - this.#activeRuns.size);
      const launchableIssues = this.#selectLaunchableIssues(
        issues,
        occupiedStreams,
      );
      this.#publishWorkflowDiagnosticLines(
        this.#buildWorkflowDiagnosticLines({
          availableSlots,
          issues,
          launchableIssues,
          occupiedStreams,
          retainedIssues,
        }),
      );
      if (availableSlots === 0) {
        return [];
      }
      const scheduledIssues = launchableIssues.slice(0, availableSlots);
      if (!scheduledIssues.length) {
        this.#log.info("tick.idle");
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

  #shouldAutoScheduleIssue(issue: AgentIssue) {
    return isTaskIssue(issue) && isExecutionReleased(issue);
  }

  #selectLaunchableIssues(issues: AgentIssue[], occupiedStreams: Map<string, string>) {
    return pickCandidateIssues(
      issues.filter((issue) => this.#shouldAutoScheduleIssue(issue)),
      issues.length,
      occupiedStreams,
    )
      .filter((issue) => !this.#activeRuns.has(issue.identifier))
      .filter((issue) => !this.#activeStreamKeys.has(getStreamKey(issue)))
      .filter((issue) => {
        const activeIssueIdentifier = occupiedStreams.get(getStreamKey(issue));
        return !activeIssueIdentifier || activeIssueIdentifier === issue.identifier;
      });
  }

  #buildWorkflowDiagnosticLines(options: {
    availableSlots: number;
    issues: AgentIssue[];
    launchableIssues: AgentIssue[];
    occupiedStreams: Map<string, string>;
    retainedIssues: IssueRuntimeState[];
  }) {
    const retainedByIdentifier = new Map(
      options.retainedIssues.map((issue) => [issue.issueIdentifier, issue] as const),
    );
    const activeIssues = options.retainedIssues
      .filter((issue) => issue.status === "running")
      .map((issue) => formatRetainedIssueLine(issue));
    const blockedIssues = options.retainedIssues
      .filter((issue) => issue.status === "blocked")
      .map((issue) => formatRetainedIssueLine(issue));
    const interruptedIssues = options.retainedIssues
      .filter((issue) => issue.status === "interrupted")
      .map((issue) => formatRetainedIssueLine(issue));
    const pendingFinalizationIssues = options.retainedIssues
      .filter((issue) => issue.status === "completed")
      .map((issue) => formatRetainedIssueLine(issue));
    const runnableIssues = options.launchableIssues
      .slice(0, options.availableSlots)
      .map((issue) => formatRunnableIssueLine(issue));
    const waitingForSlotIssues = options.launchableIssues
      .slice(options.availableSlots)
      .map((issue) => formatRunnableIssueLine(issue));
    const launchableIssueIdentifiers = new Set(
      options.launchableIssues.map((issue) => issue.identifier),
    );
    const executionCandidates = options.issues.filter((issue) => isTaskIssue(issue));
    const blockedByDependency: string[] = [];
    const waitingForRelease: string[] = [];
    const occupied: string[] = [];

    for (const issue of executionCandidates) {
      if (launchableIssueIdentifiers.has(issue.identifier)) {
        continue;
      }
      if (issue.blockedBy.length) {
        blockedByDependency.push(formatDependencyBlockedIssueLine(issue));
        continue;
      }
      if (issue.hasParent && !isExecutionReleased(issue)) {
        waitingForRelease.push(formatExecutionReleaseIssueLine(issue));
        continue;
      }
      const activeIssueIdentifier = options.occupiedStreams.get(getStreamKey(issue));
      if (activeIssueIdentifier && activeIssueIdentifier !== issue.identifier) {
        occupied.push(
          formatOccupiedIssueLine(
            issue,
            activeIssueIdentifier,
            retainedByIdentifier.get(activeIssueIdentifier),
          ),
        );
      }
    }

    const summaryParts = [
      activeIssues.length ? formatCount(activeIssues.length, "active") : undefined,
      blockedIssues.length ? formatCount(blockedIssues.length, "blocked") : undefined,
      interruptedIssues.length ? formatCount(interruptedIssues.length, "interrupted") : undefined,
      pendingFinalizationIssues.length
        ? formatCount(pendingFinalizationIssues.length, "waiting on finalization")
        : undefined,
      options.launchableIssues.length
        ? formatCount(options.launchableIssues.length, "runnable")
        : undefined,
      blockedByDependency.length
        ? formatCount(blockedByDependency.length, "blocked by dependency")
        : undefined,
      waitingForRelease.length
        ? formatCount(waitingForRelease.length, "waiting for workflow release")
        : undefined,
      occupied.length ? formatCount(occupied.length, "occupied") : undefined,
      waitingForSlotIssues.length
        ? formatCount(waitingForSlotIssues.length, "waiting for agent slot")
        : undefined,
    ].filter((part): part is string => Boolean(part));

    const lines = [summaryParts.length ? `Workflow: ${summaryParts.join(", ")}` : "Workflow: idle"];
    if (activeIssues.length) {
      lines.push(`Active: ${formatDiagnosticList(activeIssues)}`);
    }
    if (blockedIssues.length) {
      lines.push(`Preserved blocked: ${formatDiagnosticList(blockedIssues)}`);
    }
    if (interruptedIssues.length) {
      lines.push(`Preserved interrupted: ${formatDiagnosticList(interruptedIssues)}`);
    }
    if (pendingFinalizationIssues.length) {
      lines.push(`Waiting on finalization: ${formatDiagnosticList(pendingFinalizationIssues)}`);
    }
    if (runnableIssues.length) {
      lines.push(`Runnable now: ${formatDiagnosticList(runnableIssues)}`);
    }
    if (waitingForSlotIssues.length) {
      lines.push(`Waiting for agent slot: ${formatDiagnosticList(waitingForSlotIssues)}`);
    }
    if (blockedByDependency.length) {
      lines.push(`Blocked by dependency: ${formatDiagnosticList(blockedByDependency)}`);
    }
    if (waitingForRelease.length) {
      lines.push(`Waiting for workflow release: ${formatDiagnosticList(waitingForRelease)}`);
    }
    if (occupied.length) {
      lines.push(`Occupied: ${formatDiagnosticList(occupied)}`);
    }
    return lines;
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
    const workspaceLabel = this.#formatWorkspaceLabel(workspace.path);
    this.#sessionEvents.publish({
      data: {
        branchName: workspace.branchName,
        workspacePath: workspace.path,
      },
      phase: "scheduled",
      session,
      type: "session",
    });
    if (workspace.createdNow) {
      this.#publishSupervisorIssueLine(
        "issue-assigned",
        issue,
        `Created work tree in ${workspaceLabel}`,
        session,
        workspace,
      );
    }
    this.#publishSupervisorIssueLine(
      "issue-assigned",
      issue,
      `Starting agent in ${workspaceLabel}`,
      session,
      workspace,
    );
    await this.#appendIssueOutput(
      workspace.outputPath,
      `${issue.identifier}: Starting agent in ${workspaceLabel}\n`,
    );
    let result: IssueRunResult | undefined;
    try {
      const resolvedContext = await resolveIssueContext({
        baseSelection: resolveIssueRouting(workflow.issues, issue, workflow.modules),
        issue,
        repoRoot: this.#repoRoot,
        workflow,
      });
      this.#log.info("issue.context.resolved", {
        docs: resolvedContext.bundle.docs.map((doc) => ({
          id: doc.id,
          label: doc.label,
          order: doc.order,
          overridden: doc.overridden,
          path: doc.path,
          source: doc.source,
        })),
        issueIdentifier: issue.identifier,
        selection: resolvedContext.selection,
      });
      await this.#appendIssueOutput(
        workspace.outputPath,
        summarizeContextBundle(resolvedContext.bundle),
      );
      if (resolvedContext.warnings.length) {
        await this.#appendIssueOutput(
          workspace.outputPath,
          resolvedContext.warnings.map((warning) => `warning: ${warning}\n`).join(""),
        );
      }
      const runner =
        this.#runnerFactory?.(workflow) ??
        new CodexAppServerRunner(workflow.codex, this.#log, {
          sessionEvents: this.#sessionEvents,
        });
      await tracker.setIssueState(issue.id, "In Progress");
      for (let attempt = 1; attempt <= MAX_RUN_ATTEMPTS_PER_SUPERVISOR_CYCLE; attempt += 1) {
        let beforeRunCompleted = false;
        try {
          const prompt = renderPrompt(renderContextBundle(resolvedContext.bundle), {
            attempt,
            issue: resolvedContext.issue,
            selection: resolvedContext.selection,
            worker: { count: maxConcurrentAgents, id: issue.identifier, index: runIndex },
            workspace,
          });
          await workspaceManager.runBeforeRunHook(workspace.path);
          beforeRunCompleted = true;
          result = await runner.run({ issue, prompt, session, workspace });
          result.resolvedContext = resolvedContext.bundle;
          if (resolvedContext.warnings.length) {
            result.warnings = [...resolvedContext.warnings];
          }
          break;
        } catch (error) {
          if (beforeRunCompleted) {
            await workspaceManager.runAfterRunHook(workspace.path);
          }
          if (isResumableRunError(error) && attempt < MAX_RUN_ATTEMPTS_PER_SUPERVISOR_CYCLE) {
            const reason = error instanceof Error ? error.message : String(error);
            const nextAttempt = attempt + 1;
            await this.#appendIssueOutput(
              workspace.outputPath,
              `${issue.identifier}: retrying after ${reason} (attempt ${nextAttempt}/${MAX_RUN_ATTEMPTS_PER_SUPERVISOR_CYCLE})\n`,
            );
            this.#publishSupervisorIssueLine(
              "issue-assigned",
              issue,
              `Retrying after ${reason} (attempt ${nextAttempt}/${MAX_RUN_ATTEMPTS_PER_SUPERVISOR_CYCLE})`,
              session,
              workspace,
            );
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (isResumableRunError(error)) {
        await workspaceManager.markInterrupted(workspace, issue);
        await this.#appendIssueOutput(workspace.outputPath, `${issue.identifier}: interrupted\n`);
        this.#publishSupervisorIssueLine(
          "issue-blocked",
          issue,
          `Interrupted: ${reason}`,
          session,
          workspace,
        );
      } else {
        await workspaceManager.markBlocked(workspace, issue);
        await this.#appendIssueOutput(
          workspace.outputPath,
          `${issue.identifier}: blocked: ${reason}\n`,
        );
        this.#sessionEvents.publish({
          code: "issue-blocked",
          format: "line",
          session,
          text: `${issue.identifier}: blocked`,
          type: "status",
        });
        this.#publishSupervisorIssueLine(
          "issue-blocked",
          issue,
          `Blocked: ${reason}`,
          session,
          workspace,
        );
      }
      this.#sessionEvents.publish({
        data: { reason },
        phase: "failed",
        session,
        type: "session",
      });
      throw error;
    }

    if (!result) {
      throw new Error("issue_run_missing_result");
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
    await tracker.setIssueState(issue.id, "Done");
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
      text: `IO is supervising ${this.#repoRoot ?? path}`,
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

  async #listRetainedIssues(workspaceManager: WorkspaceManager) {
    const runtimeManager = workspaceManager as WorkspaceManager & {
      listRetainedIssues?: () => Promise<IssueRuntimeState[]>;
    };
    return (await runtimeManager.listRetainedIssues?.()) ?? [];
  }

  #formatWorkspaceLabel(path: string) {
    if (!this.#repoRoot) {
      return path;
    }
    const relativePath = relative(this.#repoRoot, path);
    if (!relativePath || relativePath === ".") {
      return this.#repoRoot;
    }
    return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
  }

  #publishWorkflowDiagnosticLines(lines: string[]) {
    for (const text of lines) {
      this.#sessionEvents.publish({
        code: "workflow-diagnostic",
        format: "line",
        session: this.#supervisorSession,
        text,
        type: "status",
      });
    }
  }

  #publishSupervisorIssueLine(
    code: "issue-assigned" | "issue-blocked",
    issue: AgentIssue,
    message: string,
    session: AgentSessionRef,
    workspace: PreparedWorkspace,
  ) {
    this.#sessionEvents.publish({
      code,
      data: {
        branchName: workspace.branchName,
        childSessionId: session.id,
        workspacePath: workspace.path,
      },
      format: "line",
      session: this.#supervisorSession,
      text: `${issue.identifier} ${message}`,
      type: "status",
    });
  }
}
