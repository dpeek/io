import { appendFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { createLogger, type Logger } from "@io/core/lib";

import { renderContextBundle, resolveIssueContext, summarizeContextBundle } from "./context.js";
import { resolveIssueRouting } from "./issue-routing.js";
import { CodexAppServerRunner } from "./runner/codex.js";
import { LinearTrackerAdapter } from "./tracker/linear.js";
import {
  createAgentSessionEventBus,
  createAgentSessionStdoutObserver,
  type AgentSessionEventBus,
  type AgentSessionEventObserver,
  type AgentSessionRef,
  type AgentSessionRuntimeRef,
  type AgentWorkflowDiagnosticIssue,
  type AgentWorkflowDiagnostics,
} from "./tui/index.js";
import type {
  AgentIssue,
  IssueRunResult,
  IssueTracker,
  PreparedWorkspace,
  Workflow,
} from "./types.js";
import { loadWorkflowFile, renderPrompt, toWorkspaceKey } from "./workflow.js";
import { WorkspaceManager, readIssueRuntimeState, type IssueRuntimeState } from "./workspace.js";

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

export function pickCandidateIssues(issues: AgentIssue[], limit: number) {
  const selected: AgentIssue[] = [];
  const reservedStreams = new Set<string>();
  for (const issue of [...issues]
    .filter((issue) => issue.blockedBy.length === 0)
    .sort(compareIssueManualOrder)) {
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

function compareIssueManualOrder(left: AgentIssue, right: AgentIssue) {
  const leftSortOrder = getIssueManualOrder(left);
  const rightSortOrder = getIssueManualOrder(right);
  if (typeof leftSortOrder === "number" && typeof rightSortOrder === "number") {
    if (leftSortOrder !== rightSortOrder) {
      return leftSortOrder - rightSortOrder;
    }
  } else if (typeof leftSortOrder === "number") {
    return -1;
  } else if (typeof rightSortOrder === "number") {
    return 1;
  }
  return left.createdAt.localeCompare(right.createdAt);
}

function getIssueManualOrder(issue: Pick<AgentIssue, "sortOrder" | "subIssueSortOrder">) {
  if (typeof issue.subIssueSortOrder === "number") {
    return issue.subIssueSortOrder;
  }
  return issue.sortOrder;
}

function getStreamKey(issue: AgentIssue) {
  return toWorkspaceKey(issue.parentIssueIdentifier ?? issue.identifier);
}

function toBranchName(issueIdentifier: string) {
  return `io/${toWorkspaceKey(issueIdentifier)}`;
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
    | Pick<
        AgentIssue,
        "hasParent" | "identifier" | "parentIssueIdentifier" | "streamIssueIdentifier"
      >
    | Pick<
        IssueRuntimeState,
        "issueIdentifier" | "parentIssueIdentifier" | "streamIssueIdentifier"
      >,
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

function createWorkflowIssueRef(options: {
  id?: string;
  identifier?: string;
  state?: string;
  title?: string;
}) {
  if (!options.identifier) {
    return undefined;
  }
  return {
    id: options.id,
    identifier: options.identifier,
    state: options.state,
    title: options.title,
  };
}

function createSessionWorkflow(issue: AgentIssue): AgentSessionRef["workflow"] {
  const current = createWorkflowIssueRef({
    id: issue.id,
    identifier: issue.identifier,
    state: issue.state,
    title: issue.title,
  });
  const streamIdentifier =
    issue.streamIssueIdentifier ??
    issue.grandparentIssueIdentifier ??
    issue.parentIssueIdentifier ??
    issue.identifier;
  const stream = createWorkflowIssueRef({
    id: issue.streamIssueId ?? issue.grandparentIssueId ?? issue.parentIssueId ?? issue.id,
    identifier: streamIdentifier,
    state:
      issue.streamIssueState ??
      issue.grandparentIssueState ??
      issue.parentIssueState ??
      issue.state,
    title:
      streamIdentifier === issue.identifier
        ? issue.title
        : streamIdentifier === issue.parentIssueIdentifier
          ? issue.parentIssueTitle
          : streamIdentifier === issue.grandparentIssueIdentifier
            ? issue.grandparentIssueTitle
            : undefined,
  });

  if (isTaskIssue(issue)) {
    return {
      feature: createWorkflowIssueRef({
        id: issue.parentIssueId,
        identifier: issue.parentIssueIdentifier,
        state: issue.parentIssueState,
        title: issue.parentIssueTitle,
      }),
      stream,
      task: current,
    };
  }

  if (issue.parentIssueIdentifier && issue.parentIssueIdentifier !== issue.identifier) {
    return {
      feature: current,
      stream,
    };
  }

  return {
    stream: current ?? stream,
  };
}

function createRuntimeSessionWorkflow(issue: IssueRuntimeState): AgentSessionRef["workflow"] {
  const current = createWorkflowIssueRef({
    id: issue.issueId,
    identifier: issue.issueIdentifier,
    title: issue.issueTitle,
  });
  const stream = createWorkflowIssueRef({
    id: issue.streamIssueId,
    identifier: issue.streamIssueIdentifier,
  });

  if (
    issue.parentIssueIdentifier &&
    issue.streamIssueIdentifier &&
    issue.parentIssueIdentifier !== issue.streamIssueIdentifier
  ) {
    return {
      feature: createWorkflowIssueRef({
        id: issue.parentIssueId,
        identifier: issue.parentIssueIdentifier,
      }),
      stream,
      task: current,
    };
  }

  if (issue.parentIssueIdentifier && issue.parentIssueIdentifier !== issue.issueIdentifier) {
    return {
      feature: current,
      stream,
    };
  }

  return {
    stream: current ?? stream,
  };
}

function createSessionRuntime(runtime: AgentSessionRuntimeRef): AgentSessionRuntimeRef {
  return runtime;
}

function mergeFinalizationRef(
  current: AgentSessionRuntimeRef["finalization"],
  next: AgentSessionRuntimeRef["finalization"],
) {
  if (!current && !next) {
    return undefined;
  }
  return {
    ...current,
    ...next,
    state: next?.state ?? current?.state ?? "pending",
  };
}

function withSessionRuntime(
  session: AgentSessionRef,
  runtime: AgentSessionRuntimeRef,
): AgentSessionRef {
  return {
    ...session,
    runtime: {
      ...session.runtime,
      ...runtime,
      blocker:
        session.runtime?.blocker || runtime.blocker
          ? {
              ...session.runtime?.blocker,
              ...runtime.blocker,
            }
          : undefined,
      finalization: mergeFinalizationRef(session.runtime?.finalization, runtime.finalization),
    },
  };
}

function createFinalizedSession(
  session: AgentSessionRef,
  issueState: Pick<
    IssueRuntimeState,
    "commitSha" | "finalizedAt" | "finalizedLinearState" | "landedAt" | "landedCommitSha"
  >,
): AgentSessionRef {
  return withSessionRuntime(
    session,
    createSessionRuntime({
      finalization: {
        commitSha: issueState.landedCommitSha ?? issueState.commitSha,
        finalizedAt: issueState.finalizedAt,
        landedAt: issueState.landedAt,
        linearState: issueState.finalizedLinearState,
        state: "finalized",
      },
      state: "finalized",
    }),
  );
}

function createWorkflowDiagnosticIssue(
  current: AgentWorkflowDiagnosticIssue["current"],
  workflow: AgentSessionRef["workflow"],
  options: {
    blockedBy?: string[];
    branchName?: string;
    heldBy?: AgentWorkflowDiagnosticIssue["heldBy"];
    waitingOn?: string[];
  } = {},
): AgentWorkflowDiagnosticIssue {
  return {
    blockedBy: options.blockedBy?.length ? options.blockedBy : undefined,
    branchName: options.branchName,
    current,
    heldBy: options.heldBy,
    waitingOn: options.waitingOn?.length ? options.waitingOn : undefined,
    workflow: workflow ?? {},
  };
}

function createWorkflowDiagnosticIssueFromIssue(
  issue: AgentIssue,
  options: {
    blockedBy?: string[];
    heldBy?: AgentWorkflowDiagnosticIssue["heldBy"];
    waitingOn?: string[];
  } = {},
) {
  return createWorkflowDiagnosticIssue(
    createWorkflowIssueRef({
      id: issue.id,
      identifier: issue.identifier,
      state: issue.state,
      title: issue.title,
    })!,
    createSessionWorkflow(issue),
    {
      blockedBy: options.blockedBy,
      branchName: toBranchName(
        issue.parentIssueIdentifier && hasSeparateFeature(issue)
          ? issue.parentIssueIdentifier
          : issue.identifier,
      ),
      heldBy: options.heldBy,
      waitingOn: options.waitingOn,
    },
  );
}

function createWorkflowDiagnosticIssueFromRuntime(issue: IssueRuntimeState) {
  return createWorkflowDiagnosticIssue(
    createWorkflowIssueRef({
      id: issue.issueId,
      identifier: issue.issueIdentifier,
      title: issue.issueTitle,
    })!,
    createRuntimeSessionWorkflow(issue),
    {
      branchName: issue.branchName,
    },
  );
}

type WorkflowDiagnosticLine = {
  text: string;
  workflowDiagnostics?: AgentWorkflowDiagnostics;
};

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
      const launchableIssues = this.#selectLaunchableIssues(issues, occupiedStreams);
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
  }): WorkflowDiagnosticLine[] {
    const retainedByIdentifier = new Map(
      options.retainedIssues.map((issue) => [issue.issueIdentifier, issue] as const),
    );
    const activeIssueStates = options.retainedIssues.filter((issue) => issue.status === "running");
    const blockedIssueStates = options.retainedIssues.filter((issue) => issue.status === "blocked");
    const interruptedIssueStates = options.retainedIssues.filter(
      (issue) => issue.status === "interrupted",
    );
    const pendingFinalizationIssueStates = options.retainedIssues.filter(
      (issue) => issue.status === "completed",
    );
    const runnableIssues = options.launchableIssues.slice(0, options.availableSlots);
    const waitingForSlotIssues = options.launchableIssues.slice(options.availableSlots);
    const launchableIssueIdentifiers = new Set(
      options.launchableIssues.map((issue) => issue.identifier),
    );
    const executionCandidates = options.issues.filter((issue) => isTaskIssue(issue));
    const blockedByDependency: AgentIssue[] = [];
    const waitingForRelease = new Map<string, string[]>();
    const occupied = new Map<
      string,
      {
        activeIssueIdentifier: string;
        activeIssueState?: IssueRuntimeState;
        issue: AgentIssue;
      }
    >();

    for (const issue of executionCandidates) {
      if (launchableIssueIdentifiers.has(issue.identifier)) {
        continue;
      }
      if (issue.blockedBy.length) {
        blockedByDependency.push(issue);
        continue;
      }
      if (issue.hasParent && !isExecutionReleased(issue)) {
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
        waitingForRelease.set(issue.identifier, waitingOn);
        continue;
      }
      const activeIssueIdentifier = options.occupiedStreams.get(getStreamKey(issue));
      if (activeIssueIdentifier && activeIssueIdentifier !== issue.identifier) {
        occupied.set(issue.identifier, {
          activeIssueIdentifier,
          activeIssueState: retainedByIdentifier.get(activeIssueIdentifier),
          issue,
        });
      }
    }

    const activeIssues = activeIssueStates.map((issue) => formatRetainedIssueLine(issue));
    const blockedIssues = blockedIssueStates.map((issue) => formatRetainedIssueLine(issue));
    const interruptedIssues = interruptedIssueStates.map((issue) => formatRetainedIssueLine(issue));
    const pendingFinalizationIssues = pendingFinalizationIssueStates.map((issue) =>
      formatRetainedIssueLine(issue),
    );
    const runnableIssueLines = runnableIssues.map((issue) => formatRunnableIssueLine(issue));
    const waitingForSlotIssueLines = waitingForSlotIssues.map((issue) =>
      formatRunnableIssueLine(issue),
    );
    const blockedByDependencyLines = blockedByDependency.map((issue) =>
      formatDependencyBlockedIssueLine(issue),
    );
    const waitingForReleaseLines = Array.from(waitingForRelease.entries()).map(([identifier]) =>
      formatExecutionReleaseIssueLine(
        executionCandidates.find((candidate) => candidate.identifier === identifier)!,
      ),
    );
    const occupiedLines = Array.from(occupied.values()).map((entry) =>
      formatOccupiedIssueLine(entry.issue, entry.activeIssueIdentifier, entry.activeIssueState),
    );

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
      blockedByDependencyLines.length
        ? formatCount(blockedByDependency.length, "blocked by dependency")
        : undefined,
      waitingForReleaseLines.length
        ? formatCount(waitingForReleaseLines.length, "waiting for workflow release")
        : undefined,
      occupiedLines.length ? formatCount(occupiedLines.length, "occupied") : undefined,
      waitingForSlotIssueLines.length
        ? formatCount(waitingForSlotIssueLines.length, "waiting for agent slot")
        : undefined,
    ].filter((part): part is string => Boolean(part));

    const summaryText = summaryParts.length
      ? `Workflow: ${summaryParts.join(", ")}`
      : "Workflow: idle";
    const diagnostics: AgentWorkflowDiagnostics = {
      counts: {
        active: activeIssueStates.length || undefined,
        blocked: blockedIssueStates.length || undefined,
        "blocked-by-dependency": blockedByDependency.length || undefined,
        interrupted: interruptedIssueStates.length || undefined,
        occupied: occupied.size || undefined,
        "pending-finalization": pendingFinalizationIssueStates.length || undefined,
        runnable: options.launchableIssues.length || undefined,
        "waiting-for-agent-slot": waitingForSlotIssues.length || undefined,
        "waiting-for-workflow-release": waitingForRelease.size || undefined,
      },
      items: {
        active: activeIssueStates.map((issue) => createWorkflowDiagnosticIssueFromRuntime(issue)),
        blocked: blockedIssueStates.map((issue) => createWorkflowDiagnosticIssueFromRuntime(issue)),
        "blocked-by-dependency": blockedByDependency.map((issue) =>
          createWorkflowDiagnosticIssueFromIssue(issue, {
            blockedBy: issue.blockedBy,
          }),
        ),
        interrupted: interruptedIssueStates.map((issue) =>
          createWorkflowDiagnosticIssueFromRuntime(issue),
        ),
        occupied: Array.from(occupied.values()).map((entry) =>
          createWorkflowDiagnosticIssueFromIssue(entry.issue, {
            heldBy: {
              identifier: entry.activeIssueIdentifier,
              status: entry.activeIssueState?.status,
            },
          }),
        ),
        "pending-finalization": pendingFinalizationIssueStates.map((issue) =>
          createWorkflowDiagnosticIssueFromRuntime(issue),
        ),
        runnable: options.launchableIssues.map((issue) =>
          createWorkflowDiagnosticIssueFromIssue(issue),
        ),
        "waiting-for-agent-slot": waitingForSlotIssues.map((issue) =>
          createWorkflowDiagnosticIssueFromIssue(issue),
        ),
        "waiting-for-workflow-release": Array.from(waitingForRelease.entries()).map(
          ([identifier, waitingOn]) =>
            createWorkflowDiagnosticIssueFromIssue(
              executionCandidates.find((candidate) => candidate.identifier === identifier)!,
              { waitingOn },
            ),
        ),
      },
      summaryText,
    };
    const lines: WorkflowDiagnosticLine[] = [
      {
        text: summaryText,
        workflowDiagnostics: diagnostics,
      },
    ];
    if (activeIssues.length) {
      lines.push({ text: `Active: ${formatDiagnosticList(activeIssues)}` });
    }
    if (blockedIssues.length) {
      lines.push({ text: `Preserved blocked: ${formatDiagnosticList(blockedIssues)}` });
    }
    if (interruptedIssues.length) {
      lines.push({ text: `Preserved interrupted: ${formatDiagnosticList(interruptedIssues)}` });
    }
    if (pendingFinalizationIssues.length) {
      lines.push({
        text: `Waiting on finalization: ${formatDiagnosticList(pendingFinalizationIssues)}`,
      });
    }
    if (runnableIssueLines.length) {
      lines.push({ text: `Runnable now: ${formatDiagnosticList(runnableIssueLines)}` });
    }
    if (waitingForSlotIssueLines.length) {
      lines.push({
        text: `Waiting for agent slot: ${formatDiagnosticList(waitingForSlotIssueLines)}`,
      });
    }
    if (blockedByDependencyLines.length) {
      lines.push({
        text: `Blocked by dependency: ${formatDiagnosticList(blockedByDependencyLines)}`,
      });
    }
    if (waitingForReleaseLines.length) {
      lines.push({
        text: `Waiting for workflow release: ${formatDiagnosticList(waitingForReleaseLines)}`,
      });
    }
    if (occupiedLines.length) {
      lines.push({ text: `Occupied: ${formatDiagnosticList(occupiedLines)}` });
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
        const interruptedSession = withSessionRuntime(
          session,
          createSessionRuntime({
            blocker: {
              kind: "interrupted",
              reason,
            },
            state: "interrupted",
          }),
        );
        await workspaceManager.markInterrupted(workspace, issue, reason);
        await this.#appendIssueOutput(workspace.outputPath, `${issue.identifier}: interrupted\n`);
        this.#publishSupervisorIssueLine(
          "issue-blocked",
          issue,
          `Interrupted: ${reason}`,
          interruptedSession,
          workspace,
        );
        this.#sessionEvents.publish({
          data: { reason },
          phase: "stopped",
          session: interruptedSession,
          type: "session",
        });
      } else {
        const blockedSession = withSessionRuntime(
          session,
          createSessionRuntime({
            blocker: {
              kind: "blocked",
              reason,
            },
            state: "blocked",
          }),
        );
        await workspaceManager.markBlocked(workspace, issue, reason);
        await this.#appendIssueOutput(
          workspace.outputPath,
          `${issue.identifier}: blocked: ${reason}\n`,
        );
        this.#sessionEvents.publish({
          code: "issue-blocked",
          data: {
            branchName: workspace.branchName,
            reason,
          },
          format: "line",
          session: blockedSession,
          text: `${issue.identifier}: blocked`,
          type: "status",
        });
        this.#publishSupervisorIssueLine(
          "issue-blocked",
          issue,
          `Blocked: ${reason}`,
          blockedSession,
          workspace,
        );
        this.#sessionEvents.publish({
          data: { reason },
          phase: "failed",
          session: blockedSession,
          type: "session",
        });
      }
      throw error;
    }

    if (!result) {
      throw new Error("issue_run_missing_result");
    }
    await workspaceManager.runAfterRunHook(workspace.path);
    if (!result.success) {
      const blockedSession = withSessionRuntime(
        session,
        createSessionRuntime({
          blocker: {
            kind: "blocked",
          },
          state: "blocked",
        }),
      );
      await workspaceManager.markBlocked(workspace, issue);
      await this.#appendIssueOutput(workspace.outputPath, `${issue.identifier}: blocked\n`);
      this.#sessionEvents.publish({
        code: "issue-blocked",
        format: "line",
        session: blockedSession,
        text: `${issue.identifier}: blocked`,
        type: "status",
      });
      this.#sessionEvents.publish({
        phase: "failed",
        session: blockedSession,
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
      const reason = error instanceof Error ? error.message : String(error);
      const blockedSession = withSessionRuntime(
        session,
        createSessionRuntime({
          blocker: {
            kind: "blocked",
            reason,
          },
          state: "blocked",
        }),
      );
      await workspaceManager.markBlocked(workspace, issue, reason);
      await this.#appendIssueOutput(
        workspace.outputPath,
        `${issue.identifier}: blocked: ${reason}\n`,
      );
      this.#sessionEvents.publish({
        code: "issue-blocked",
        data: {
          branchName: workspace.branchName,
          reason,
        },
        format: "line",
        session: blockedSession,
        text: `${issue.identifier}: blocked`,
        type: "status",
      });
      this.#publishSupervisorIssueLine(
        "issue-blocked",
        issue,
        `Blocked: ${reason}`,
        blockedSession,
        workspace,
      );
      this.#sessionEvents.publish({
        data: {
          reason,
        },
        phase: "failed",
        session: blockedSession,
        type: "session",
      });
      throw error;
    }
    const completedSession = withSessionRuntime(
      session,
      createSessionRuntime({
        finalization: {
          commitSha: completion.commitSha,
          state: "pending",
        },
        state: "pending-finalization",
      }),
    );
    await this.#appendIssueOutput(
      workspace.outputPath,
      `${issue.identifier}: landed ${completion.commitSha} on ${workspace.branchName}\n`,
    );
    this.#sessionEvents.publish({
      code: "issue-committed",
      data: {
        branchName: workspace.branchName,
        commitSha: completion.commitSha,
      },
      format: "line",
      session: completedSession,
      text: `${issue.identifier}: landed ${completion.commitSha} on ${workspace.branchName}`,
      type: "status",
    });
    this.#sessionEvents.publish({
      data: {
        commitSha: completion.commitSha,
      },
      phase: "completed",
      session: completedSession,
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
    await workspaceManager.reconcileTerminalIssues(tracker, workflow.tracker.terminalStates);
    const finalizedIssueState = await readIssueRuntimeState(
      workflow.workspace.root,
      issue.identifier,
    );
    if (finalizedIssueState?.status === "finalized") {
      this.#sessionEvents.publish({
        data: {
          commitSha: finalizedIssueState.landedCommitSha ?? finalizedIssueState.commitSha,
          linearState: finalizedIssueState.finalizedLinearState,
        },
        phase: "completed",
        session: createFinalizedSession(session, finalizedIssueState),
        type: "session",
      });
    }
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
      workflow: createSessionWorkflow(issue),
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

  #publishWorkflowDiagnosticLines(lines: WorkflowDiagnosticLine[]) {
    for (const line of lines) {
      this.#sessionEvents.publish({
        code: "workflow-diagnostic",
        data: line.workflowDiagnostics
          ? { workflowDiagnostics: line.workflowDiagnostics }
          : undefined,
        format: "line",
        session: this.#supervisorSession,
        text: line.text,
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
