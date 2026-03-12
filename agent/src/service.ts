import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { createLogger, type Logger } from "@io/lib";

import {
  buildManagedParentProposal,
} from "./backlog-proposal.js";
import {
  hasHandledManagedComment,
  readManagedCommentState,
  recordHandledManagedComment,
} from "./comment-state.js";
import { renderContextBundle, resolveIssueContext, summarizeContextBundle } from "./context.js";
import { hasIssueLabel, resolveIssueModule, resolveIssueRouting } from "./issue-routing.js";
import {
  buildManagedBacklogChildren,
  MANAGED_STREAM_FOCUS_DOC_PATH,
  renderManagedFocusDoc,
} from "./managed-stream.js";
import { isManagedCommentCommand } from "./managed-comments.js";
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
  ManagedCommentMutation,
  ManagedCommentTrigger,
  PreparedWorkspace,
  Workflow,
} from "./types.js";
import { loadWorkflowFile, renderPrompt, toWorkspaceKey } from "./workflow.js";
import { WorkspaceManager } from "./workspace.js";

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
    .filter((issue) => !issue.hasParent || normalizeState(issue.parentIssueState) === "in progress")
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

function isResumableRunError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return ["response_timeout", "stall_timeout", "turn_timeout"].includes(error.message);
}

function uniqueOrdered(values: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
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
      await this.#processManagedCommentTriggers(activeWorkflow, tracker);
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
        occupiedStreams,
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

  async #processManagedCommentTriggers(workflow: Workflow, tracker: IssueTracker) {
    if (!tracker.fetchManagedCommentTriggers || !tracker.applyManagedCommentMutation) {
      return;
    }

    const triggers = await tracker.fetchManagedCommentTriggers();
    for (const trigger of triggers) {
      const state = await readManagedCommentState(
        workflow.workspace.root,
        trigger.issue.identifier,
      );
      if (hasHandledManagedComment(state, trigger)) {
        continue;
      }

      let reply: ManagedCommentMutation["reply"] = {
        command: "invalid",
        issueIdentifier: trigger.issue.identifier,
        lines: [] as string[],
        result: "blocked",
      };
      let parentDescription: string | undefined;
      let children: ManagedCommentMutation["children"] = [];

      if (!isManagedCommentCommand(trigger)) {
        reply = {
          command: "invalid",
          issueIdentifier: trigger.issue.identifier,
          lines: [trigger.error],
          result: "blocked",
        };
      } else {
        const module = resolveIssueModule(workflow.modules, trigger.issue);
        const isManagedParent =
          !trigger.issue.hasParent && hasIssueLabel(trigger.issue, "io") && Boolean(module);
        const issueIdentifier = module
          ? `${trigger.issue.identifier} / ${module.id}`
          : trigger.issue.identifier;

        if (!isManagedParent) {
          reply = {
            command: trigger.command,
            issueIdentifier,
            lines: ["The parent is not currently eligible for managed `@io` commands."],
            result: "blocked",
          };
        } else if (trigger.command === "help") {
          reply = {
            command: trigger.command,
            issueIdentifier,
            lines: [
              "Accepted commands: backlog, focus, status, help.",
              "Accepted keys: docs, dryRun, note.",
              "Only top-level comments on managed parent issues are processed.",
            ],
            result: "noop",
          };
        } else if (trigger.command === "status") {
          reply = {
            command: trigger.command,
            issueIdentifier,
            lines: [
              `Module: ${module!.id}`,
              `Managed block present: ${trigger.issue.description.includes("<!-- io-managed:backlog-proposal:start -->") ? "yes" : "no"}`,
              `Requested docs: ${trigger.payload.docs.length ? trigger.payload.docs.join(", ") : "none"}`,
            ],
            result: "noop",
          };
        } else if (trigger.command === "focus") {
          const focusDocPathRef = MANAGED_STREAM_FOCUS_DOC_PATH;
          const resolvedContext = await resolveIssueContext({
            baseSelection: resolveIssueRouting(workflow.issues, trigger.issue, workflow.modules),
            issue: trigger.issue,
            repoRoot: this.#repoRoot,
            workflow,
          });
          const proposal = buildManagedParentProposal({
            issue: trigger.issue,
            module: module!,
            repoRoot: this.#repoRoot,
            resolvedContext: resolvedContext.bundle,
          });
          const focusDoc = `${renderManagedFocusDoc({
            docs: uniqueOrdered([focusDocPathRef, ...trigger.payload.docs]),
            issue: trigger.issue,
            module: module!,
            parentDescription: proposal.description,
            repoRoot: this.#repoRoot,
            resolvedContext: resolvedContext.bundle,
          })}\n`;
          const focusDocPath = resolve(
            this.#repoRoot,
            focusDocPathRef.replace(/^\.\//, ""),
          );
          const existingFocusDoc = await this.#readOptionalFile(focusDocPath);
          const changed = existingFocusDoc !== focusDoc;
          if (changed && !trigger.payload.dryRun) {
            await mkdir(dirname(focusDocPath), { recursive: true });
            await writeFile(focusDocPath, focusDoc, "utf8");
          }
          reply = {
            command: trigger.command,
            issueIdentifier,
            lines: trigger.payload.dryRun
              ? [
                  changed
                    ? `Dry run: would update ${focusDocPathRef}.`
                    : `Dry run: ${focusDocPathRef} is already up to date.`,
                ]
              : [
                  changed
                    ? `Updated ${focusDocPathRef}.`
                    : `${focusDocPathRef} was already up to date.`,
                ],
            result: trigger.payload.dryRun ? "noop" : changed ? "updated" : "noop",
          };
        } else {
          const resolvedContext = await resolveIssueContext({
            baseSelection: resolveIssueRouting(workflow.issues, trigger.issue, workflow.modules),
            issue: trigger.issue,
            repoRoot: this.#repoRoot,
            workflow,
          });
          const proposal = buildManagedParentProposal({
            issue: trigger.issue,
            module: module!,
            repoRoot: this.#repoRoot,
            resolvedContext: resolvedContext.bundle,
          });
          parentDescription = proposal.description;
          children = buildManagedBacklogChildren({
            docs: uniqueOrdered(trigger.payload.docs.length ? trigger.payload.docs : module!.docs),
            issue: trigger.issue,
            note: trigger.payload.note,
            parentDescription: proposal.description,
            primaryModuleId: module!.id,
          });
          reply = {
            command: trigger.command,
            issueIdentifier,
            lines: [],
            result: "noop",
          };
        }
      }

      const result = await tracker.applyManagedCommentMutation({
        children,
        comment: trigger,
        parentDescription,
        reply,
      });
      if (result.warnings.length) {
        this.#log.warn("managed_comment.warning", {
          commentId: trigger.commentId,
          issueIdentifier: trigger.issue.identifier,
          warnings: result.warnings,
        });
      }
      await recordHandledManagedComment(workflow.workspace.root, trigger.issue.identifier, trigger);
    }
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
    const isManagedParent =
      !issue.hasParent &&
      hasIssueLabel(issue, "io") &&
      Boolean(resolveIssueModule(workflow.modules, issue));
    if (isManagedParent) {
      return normalizeState(issue.state) === "todo";
    }
    if (!issue.hasChildren || issue.hasParent) {
      return true;
    }
    return resolveIssueRouting(workflow.issues, issue, workflow.modules).agent === "backlog";
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
    let beforeRunCompleted = false;
    let result: IssueRunResult;
    try {
      let resolvedContext = await resolveIssueContext({
        baseSelection: resolveIssueRouting(workflow.issues, issue, workflow.modules),
        issue,
        repoRoot: this.#repoRoot,
        workflow,
      });
      const module = resolveIssueModule(workflow.modules, issue);
      if (
        tracker.updateIssueDescription &&
        resolvedContext.selection.agent === "backlog" &&
        !issue.hasParent &&
        module &&
        hasIssueLabel(issue, "io")
      ) {
        const proposal = buildManagedParentProposal({
          issue,
          module,
          repoRoot: this.#repoRoot,
          resolvedContext: resolvedContext.bundle,
        });
        if (proposal.changed) {
          await tracker.updateIssueDescription(issue.id, proposal.description);
          issue = {
            ...issue,
            description: proposal.description,
          };
          resolvedContext = await resolveIssueContext({
            baseSelection: resolveIssueRouting(workflow.issues, issue, workflow.modules),
            issue,
            repoRoot: this.#repoRoot,
            workflow,
          });
        }
      }
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
      const prompt = renderPrompt(renderContextBundle(resolvedContext.bundle), {
        attempt: 1,
        issue: resolvedContext.issue,
        selection: resolvedContext.selection,
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
      result.resolvedContext = resolvedContext.bundle;
      if (resolvedContext.warnings.length) {
        result.warnings = [...resolvedContext.warnings];
      }
    } catch (error) {
      if (beforeRunCompleted) {
        await workspaceManager.runAfterRunHook(workspace.path);
      }
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

  async #readOptionalFile(path: string) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return "";
      }
      throw error;
    }
  }

  async #appendIssueOutput(path: string | undefined, text: string) {
    if (!path) {
      return;
    }
    await appendFile(path, text);
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
