import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createLogger, type Logger } from "@io/core/lib";

import type { AgentIssue, HookConfig, PreparedWorkspace, StreamRuntimeState } from "./types.js";
import { toWorkspaceKey } from "./workflow.js";

type CommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

type CommandRunner = (command: string[], cwd: string, timeoutMs?: number) => Promise<CommandResult>;

type WorkerStatus = "blocked" | "idle" | "interrupted" | "running";

type IssueRuntimeStatus = "blocked" | "completed" | "finalized" | "interrupted" | "running";

type TaskLandingResult = {
  landedCommitSha: string;
  taskCommitSha: string;
};

type ControlRepo = {
  createdNow: boolean;
  path: string;
  usesControlClone: boolean;
};

type WorkerState = {
  activeIssue?: {
    identifier: string;
    title: string;
  };
  branchName?: string;
  checkoutPath: string;
  controlPath: string;
  issueRuntimePath?: string;
  originPath: string;
  outputPath?: string;
  pid: number;
  sourceRepoPath?: string;
  status: WorkerStatus;
  updatedAt: string;
  workerId: string;
};

export interface IssueRuntimeState {
  baseBranchName?: string;
  baseIssueId?: string;
  baseIssueIdentifier?: string;
  blockedReason?: string;
  branchName: string;
  commitSha?: string;
  controlPath: string;
  finalizedAt?: string;
  finalizedLinearState?: string;
  interruptedReason?: string;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  landedAt?: string;
  landedCommitSha?: string;
  originPath: string;
  outputPath: string;
  parentIssueId?: string;
  parentIssueIdentifier?: string;
  runtimePath: string;
  sourceRepoPath?: string;
  status: IssueRuntimeStatus;
  streamIssueId: string;
  streamIssueIdentifier: string;
  streamRuntimePath: string;
  updatedAt: string;
  workerId: string;
  worktreePath: string;
}

export interface WorkspaceManagerOptions {
  hooks: HookConfig;
  log?: Logger;
  originPath?: string;
  repoRoot?: string;
  rootDir: string;
  runCommand?: CommandRunner;
  workerId: string;
}

type IssueStateTracker = {
  fetchIssuesByIds?: (issueIds: string[]) => Promise<Map<string, AgentIssue>>;
  fetchIssueStatesByIds: (issueIds: string[]) => Promise<Map<string, string>>;
};

const defaultRunCommand: CommandRunner = async (command, cwd, timeoutMs = 60_000) => {
  const proc = Bun.spawn({
    cmd: command,
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const timer = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      // ignore
    }
  }, timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stderr, stdout };
  } finally {
    clearTimeout(timer);
  }
};

function normalizeStateName(state: string) {
  return state.trim().toLowerCase();
}

function resolveBranchOwnerIssue(
  issue: Pick<
    AgentIssue,
    "id" | "identifier" | "parentIssueId" | "parentIssueIdentifier" | "parentIssueTitle" | "title"
  >,
) {
  return {
    id: issue.parentIssueId ?? issue.id,
    identifier: issue.parentIssueIdentifier ?? issue.identifier,
    title: issue.parentIssueTitle ?? issue.title,
  };
}

function resolveWorkflowStreamIssue(
  issue: Pick<
    AgentIssue,
    | "id"
    | "identifier"
    | "grandparentIssueId"
    | "grandparentIssueIdentifier"
    | "parentIssueId"
    | "parentIssueIdentifier"
    | "streamIssueId"
    | "streamIssueIdentifier"
  >,
) {
  return {
    id: issue.streamIssueId ?? issue.grandparentIssueId ?? issue.parentIssueId ?? issue.id,
    identifier:
      issue.streamIssueIdentifier ??
      issue.grandparentIssueIdentifier ??
      issue.parentIssueIdentifier ??
      issue.identifier,
  };
}

function toStreamBranchName(issueIdentifier: string) {
  return `io/${toWorkspaceKey(issueIdentifier)}`;
}

export function toIssueRuntimeKey(issueIdentifier: string) {
  return toWorkspaceKey(issueIdentifier);
}

export function resolveIssueRuntimePath(rootDir: string, issueIdentifier: string) {
  return resolve(rootDir, "issue", toIssueRuntimeKey(issueIdentifier));
}

export function resolveIssueOutputPath(rootDir: string, issueIdentifier: string) {
  return resolve(resolveIssueRuntimePath(rootDir, issueIdentifier), "output.log");
}

export function resolveStreamRuntimePath(rootDir: string, issueIdentifier: string) {
  return resolve(rootDir, "stream", `${toWorkspaceKey(issueIdentifier)}.json`);
}

export function resolveIssueWorktreePath(rootDir: string, issueIdentifier: string) {
  return resolve(rootDir, "tree", toWorkspaceKey(issueIdentifier));
}

export async function readIssueRuntimeState(rootDir: string, issueIdentifier: string) {
  try {
    const text = await readFile(
      resolve(resolveIssueRuntimePath(rootDir, issueIdentifier), "issue-state.json"),
      "utf8",
    );
    return JSON.parse(text) as IssueRuntimeState;
  } catch {
    return undefined;
  }
}

async function readStreamRuntimeState(rootDir: string, issueIdentifier: string) {
  try {
    const text = await readFile(resolveStreamRuntimePath(rootDir, issueIdentifier), "utf8");
    return JSON.parse(text) as StreamRuntimeState;
  } catch {
    return undefined;
  }
}

export class CheckoutManager {
  readonly #hooks: HookConfig;
  readonly #log: Logger;
  readonly #originPath?: string;
  readonly #repoRoot?: string;
  readonly #rootDir: string;
  readonly #runCommand: CommandRunner;
  readonly #workerId: string;

  constructor(options: WorkspaceManagerOptions) {
    this.#hooks = options.hooks;
    this.#log = (options.log ?? createLogger({ pkg: "agent" })).child({
      event_prefix: "workspace",
    });
    this.#originPath = options.originPath;
    this.#repoRoot = options.repoRoot;
    this.#rootDir = options.rootDir;
    this.#runCommand = options.runCommand ?? defaultRunCommand;
    this.#workerId = options.workerId;
  }

  async prepare(issue: AgentIssue): Promise<PreparedWorkspace> {
    const control = await this.ensureCheckout();
    const branchOwnerIssue = resolveBranchOwnerIssue(issue);
    const streamIssue = resolveWorkflowStreamIssue(issue);
    const baseIssue =
      branchOwnerIssue.identifier === streamIssue.identifier ? undefined : streamIssue;
    const branchName = this.getBranchName(issue);
    const baseBranchName = baseIssue ? toStreamBranchName(baseIssue.identifier) : undefined;
    const streamBranchName = toStreamBranchName(streamIssue.identifier);
    const path = this.getWorktreePath(issue.identifier);
    const issueRuntimePath = this.getIssueRuntimePath(issue.identifier);
    const outputPath = resolveIssueOutputPath(this.#rootDir, issue.identifier);
    const streamRuntimePath = this.getStreamRuntimePath(branchOwnerIssue.identifier);

    await mkdir(issueRuntimePath, { recursive: true });
    const workerState = await this.#readState();
    if (
      workerState?.activeIssue?.identifier &&
      workerState.activeIssue.identifier !== issue.identifier &&
      workerState.status !== "idle"
    ) {
      throw new Error(
        `worker_checkout_dirty:${this.#workerId}:${workerState.branchName || "unknown"}:${workerState.activeIssue.identifier}`,
      );
    }

    const priorIssueState = await readIssueRuntimeState(this.#rootDir, issue.identifier);
    if (existsSync(path)) {
      const dirty = await this.#isDirty(path);
      const priorBranchName = priorIssueState?.branchName;
      if (dirty) {
        if (
          workerState?.activeIssue?.identifier !== issue.identifier ||
          (priorBranchName && priorBranchName !== branchName)
        ) {
          throw new Error(
            `worker_checkout_dirty:${this.#workerId}:${priorBranchName || "unknown"}:${priorIssueState?.issueIdentifier ?? "unknown"}`,
          );
        }
      } else if (priorBranchName && priorBranchName !== branchName) {
        await this.#removeWorktree(control.path, path, true);
      }
    }

    await this.#ensureBranch(control, streamBranchName);
    if (branchName !== streamBranchName) {
      await this.#ensureBranch(control, branchName, streamBranchName);
    }
    const createdNow = await this.#ensureWorktree(control, branchName, path);
    const preparedWorkspace = this.#buildPreparedWorkspace({
      baseBranchName,
      baseIssueId: baseIssue?.id,
      baseIssueIdentifier: baseIssue?.identifier,
      branchName,
      branchOwnerIssueId: branchOwnerIssue.id,
      branchOwnerIssueIdentifier: branchOwnerIssue.identifier,
      controlPath: control.path,
      createdNow,
      issueRuntimePath,
      outputPath,
      path,
      runtimePath: issueRuntimePath,
      streamIssueId: streamIssue.id,
      streamIssueIdentifier: streamIssue.identifier,
      streamRuntimePath,
    });
    await this.#writeIssueState(preparedWorkspace, issue, "running");
    await this.#upsertStreamState(
      {
        baseBranchName,
        baseIssueId: baseIssue?.id,
        baseIssueIdentifier: baseIssue?.identifier,
        branchName,
        parentIssueId: branchOwnerIssue.id,
        parentIssueIdentifier: branchOwnerIssue.identifier,
        parentIssueTitle: branchOwnerIssue.title,
        streamIssueId: streamIssue.id,
        streamIssueIdentifier: streamIssue.identifier,
      },
      {
        activeIssue: { id: issue.id, identifier: issue.identifier },
        status: "active",
      },
    );
    await this.#writeState(preparedWorkspace, "running", issue);
    return preparedWorkspace;
  }

  async ensureCheckout() {
    await mkdir(this.getWorkerRoot(), { recursive: true });
    if (!this.#usesControlClone()) {
      return {
        createdNow: false,
        path: this.getControlRepoPath(),
        usesControlClone: false,
      } satisfies ControlRepo;
    }

    const path = this.getControlRepoPath();
    const createdNow = !existsSync(path);
    if (createdNow) {
      await this.#runOrThrow(["git", "clone", this.getOriginPath(), path], this.getWorkerRoot());
    }
    await this.#ensureRemote(path, "origin", this.getOriginPath());
    if (this.#repoRoot && this.getOriginPath() !== this.#repoRoot) {
      await this.#ensureRemote(path, "upstream", this.#repoRoot);
    }
    return { createdNow, path, usesControlClone: true } satisfies ControlRepo;
  }

  async ensureSessionStartState() {
    const control = await this.ensureCheckout();
    if (control.usesControlClone) {
      const dirty = await this.#isDirty(control.path);
      if (dirty) {
        const currentBranch = await this.#currentBranch(control.path);
        throw new Error(
          `worker_checkout_dirty_on_start:${this.#workerId}:${currentBranch || "unknown"}`,
        );
      }
      const checkoutMain = await this.#runCommand(
        ["git", "checkout", "main"],
        control.path,
        this.#hooks.timeoutMs,
      );
      if (checkoutMain.exitCode !== 0) {
        await this.#runOrThrow(["git", "checkout", "-B", "main", "origin/main"], control.path);
      }
      await this.#runOrThrow(["git", "pull", "--ff-only", "origin", "main"], control.path);
    }
    return { createdNow: control.createdNow, path: this.getWorkerRoot() };
  }

  async cleanup(workspace: PreparedWorkspace) {
    await this.#writeState(workspace, "idle");
  }

  async complete(workspace: PreparedWorkspace, issue: AgentIssue) {
    const taskCommitSha = await this.#commit(workspace, issue);
    const landing = await this.#landTaskCommitOnBranch(workspace, issue, taskCommitSha);
    const landedAt = new Date().toISOString();

    await this.#writeIssueState(workspace, issue, "completed", {
      commitSha: landing.taskCommitSha,
      landedAt,
      landedCommitSha: landing.landedCommitSha,
    });
    await this.#upsertStreamState(
      {
        baseBranchName: workspace.baseBranchName,
        baseIssueId: workspace.baseIssueId,
        baseIssueIdentifier: workspace.baseIssueIdentifier,
        branchName: workspace.branchName,
        parentIssueId: workspace.branchOwnerIssueId ?? issue.parentIssueId ?? issue.id,
        parentIssueIdentifier:
          workspace.branchOwnerIssueIdentifier ?? issue.parentIssueIdentifier ?? issue.identifier,
        parentIssueTitle: issue.parentIssueTitle ?? issue.title,
        streamIssueId:
          workspace.streamIssueId ?? issue.streamIssueId ?? issue.parentIssueId ?? issue.id,
        streamIssueIdentifier:
          workspace.streamIssueIdentifier ??
          issue.streamIssueIdentifier ??
          issue.parentIssueIdentifier ??
          issue.identifier,
      },
      {
        activeIssue: issue.hasParent ? { id: issue.id, identifier: issue.identifier } : null,
        latestLandedCommitSha: landing.landedCommitSha,
        status: "active",
      },
    );
    await this.#writeState(workspace, "idle");
    return { commitSha: landing.landedCommitSha };
  }

  async completeReview(workspace: PreparedWorkspace, issue: AgentIssue) {
    if (await this.#isDirty(workspace.path)) {
      throw new Error(`review_checkout_dirty:${issue.identifier}`);
    }
    const priorIssueState = await readIssueRuntimeState(this.#rootDir, issue.identifier);
    const commitSha = priorIssueState?.landedCommitSha ?? priorIssueState?.commitSha;
    if (!commitSha) {
      throw new Error(`review_commit_missing:${issue.identifier}`);
    }
    await this.#writeIssueState(workspace, issue, "completed");
    await this.#upsertStreamState(
      {
        baseBranchName: workspace.baseBranchName,
        baseIssueId: workspace.baseIssueId,
        baseIssueIdentifier: workspace.baseIssueIdentifier,
        branchName: workspace.branchName,
        parentIssueId: workspace.branchOwnerIssueId ?? issue.parentIssueId ?? issue.id,
        parentIssueIdentifier:
          workspace.branchOwnerIssueIdentifier ?? issue.parentIssueIdentifier ?? issue.identifier,
        parentIssueTitle: issue.parentIssueTitle ?? issue.title,
        streamIssueId:
          workspace.streamIssueId ?? issue.streamIssueId ?? issue.parentIssueId ?? issue.id,
        streamIssueIdentifier:
          workspace.streamIssueIdentifier ??
          issue.streamIssueIdentifier ??
          issue.parentIssueIdentifier ??
          issue.identifier,
      },
      {
        activeIssue: issue.hasParent ? { id: issue.id, identifier: issue.identifier } : null,
        latestLandedCommitSha: priorIssueState?.landedCommitSha,
        status: "active",
      },
    );
    await this.#writeState(workspace, "idle");
    return { commitSha };
  }

  async markBlocked(workspace: PreparedWorkspace, issue: AgentIssue, reason?: string) {
    await this.#writeIssueState(workspace, issue, "blocked", {
      blockedReason: reason,
    });
    await this.#upsertStreamState(
      {
        baseBranchName: workspace.baseBranchName,
        baseIssueId: workspace.baseIssueId,
        baseIssueIdentifier: workspace.baseIssueIdentifier,
        branchName: workspace.branchName,
        parentIssueId: workspace.branchOwnerIssueId ?? issue.parentIssueId ?? issue.id,
        parentIssueIdentifier:
          workspace.branchOwnerIssueIdentifier ?? issue.parentIssueIdentifier ?? issue.identifier,
        parentIssueTitle: issue.parentIssueTitle ?? issue.title,
        streamIssueId:
          workspace.streamIssueId ?? issue.streamIssueId ?? issue.parentIssueId ?? issue.id,
        streamIssueIdentifier:
          workspace.streamIssueIdentifier ??
          issue.streamIssueIdentifier ??
          issue.parentIssueIdentifier ??
          issue.identifier,
      },
      {
        activeIssue: { id: issue.id, identifier: issue.identifier },
        status: "active",
      },
    );
    await this.#writeState(workspace, "blocked", issue);
  }

  async markInterrupted(workspace: PreparedWorkspace, issue: AgentIssue, reason?: string) {
    await this.#writeIssueState(workspace, issue, "interrupted", {
      interruptedReason: reason,
    });
    await this.#upsertStreamState(
      {
        baseBranchName: workspace.baseBranchName,
        baseIssueId: workspace.baseIssueId,
        baseIssueIdentifier: workspace.baseIssueIdentifier,
        branchName: workspace.branchName,
        parentIssueId: workspace.branchOwnerIssueId ?? issue.parentIssueId ?? issue.id,
        parentIssueIdentifier:
          workspace.branchOwnerIssueIdentifier ?? issue.parentIssueIdentifier ?? issue.identifier,
        parentIssueTitle: issue.parentIssueTitle ?? issue.title,
        streamIssueId:
          workspace.streamIssueId ?? issue.streamIssueId ?? issue.parentIssueId ?? issue.id,
        streamIssueIdentifier:
          workspace.streamIssueIdentifier ??
          issue.streamIssueIdentifier ??
          issue.parentIssueIdentifier ??
          issue.identifier,
      },
      {
        activeIssue: { id: issue.id, identifier: issue.identifier },
        status: "active",
      },
    );
    await this.#writeState(workspace, "interrupted", issue);
  }

  async listOccupiedStreams() {
    const issueStateByIdentifier = new Map(
      (await this.#listIssueStates()).map((issue) => [issue.issueIdentifier, issue] as const),
    );
    const occupiedStreams = new Map<string, string>();
    for (const state of await this.#listStreamStates()) {
      if (!state.activeIssueIdentifier) {
        continue;
      }
      const activeIssue = issueStateByIdentifier.get(state.activeIssueIdentifier);
      if (!activeIssue || activeIssue.status === "finalized") {
        await this.#upsertStreamState(
          {
            branchName: state.branchName,
            parentIssueId: state.parentIssueId,
            parentIssueIdentifier: state.parentIssueIdentifier,
          },
          {
            activeIssue: null,
            status: state.status,
          },
        );
        continue;
      }
      occupiedStreams.set(toWorkspaceKey(state.parentIssueIdentifier), state.activeIssueIdentifier);
    }
    return occupiedStreams;
  }

  async listRetainedIssues() {
    return (await this.#listIssueStates()).filter((issue) => issue.status !== "finalized");
  }

  async reconcileTerminalIssues(tracker: IssueStateTracker, terminalStates: string[]) {
    const retainedIssues: IssueRuntimeState[] = [];
    for (const issue of await this.#listIssueStates()) {
      if (issue.status === "finalized") {
        continue;
      }
      if (issue.status !== "running") {
        retainedIssues.push(issue);
        continue;
      }
      if (await this.#isIssueWorkerActive(issue)) {
        continue;
      }
      this.#log.info("issue.runtime.stale", {
        issueIdentifier: issue.issueIdentifier,
        workerId: issue.workerId,
      });
      this.#reportIssueProgress(issue, `recovering stale ${issue.branchName} worker state`);
      retainedIssues.push(issue);
    }
    const terminalStateSet = new Set(terminalStates.map(normalizeStateName));
    if (retainedIssues.length) {
      const stateByIssueId = await tracker.fetchIssueStatesByIds(
        retainedIssues.map((issue) => issue.issueId),
      );
      for (const issue of retainedIssues) {
        const state = stateByIssueId.get(issue.issueId);
        if (!state || !terminalStateSet.has(normalizeStateName(state))) {
          continue;
        }
        try {
          await this.#finalizeTerminalIssue(issue, state);
        } catch (error) {
          this.#log.error("terminal_issue_finalize.failed", {
            error: error instanceof Error ? error : new Error(String(error)),
            issueIdentifier: issue.issueIdentifier,
            linearState: state,
          });
        }
      }
    }
    await this.#reconcileTerminalFeatureBranches(tracker, terminalStateSet);
  }

  getBranchName(issue: AgentIssue) {
    return toStreamBranchName(resolveBranchOwnerIssue(issue).identifier);
  }

  createIdleWorkspace() {
    return this.#buildPreparedWorkspace({
      branchName: "main",
      controlPath: this.getControlRepoPath(),
      createdNow: false,
      path: this.getWorkerRoot(),
    });
  }

  async runAfterRunHook(path: string) {
    await this.runHook("afterRun", this.#hooks.afterRun, path, false);
  }

  async runBeforeRunHook(path: string) {
    await this.runHook("beforeRun", this.#hooks.beforeRun, path, true);
  }

  async runHook(
    name: "afterCreate" | "afterRun" | "beforeRemove" | "beforeRun",
    script: string | undefined,
    cwd: string,
    fatal: boolean,
  ) {
    if (!script?.trim()) {
      return;
    }
    this.#log.info("hook.start", { cwd, hook: name });
    const result = await this.#runCommand(["bash", "-lc", script], cwd, this.#hooks.timeoutMs);
    if (result.exitCode === 0) {
      return;
    }
    const error = new Error(result.stderr.trim() || result.stdout.trim() || `${name} failed`);
    this.#log.error("hook.failed", { cwd, error, hook: name });
    if (fatal) {
      throw error;
    }
  }

  getControlRepoPath() {
    return this.#usesControlClone() ? resolve(this.getWorkerRoot(), "repo") : this.#repoRoot!;
  }

  getOriginPath() {
    return this.#originPath ?? this.#repoRoot ?? resolve(this.#rootDir, "remotes", "origin.git");
  }

  getWorkerRoot() {
    return resolve(this.#rootDir, "workers", this.#workerId);
  }

  #buildPreparedWorkspace(
    options: Pick<
      PreparedWorkspace,
      | "baseBranchName"
      | "baseIssueId"
      | "baseIssueIdentifier"
      | "branchName"
      | "branchOwnerIssueId"
      | "branchOwnerIssueIdentifier"
      | "controlPath"
      | "createdNow"
      | "issueRuntimePath"
      | "outputPath"
      | "path"
      | "runtimePath"
      | "streamIssueId"
      | "streamIssueIdentifier"
      | "streamRuntimePath"
    >,
  ): PreparedWorkspace {
    return {
      baseBranchName: options.baseBranchName,
      baseIssueId: options.baseIssueId,
      baseIssueIdentifier: options.baseIssueIdentifier,
      branchName: options.branchName,
      branchOwnerIssueId: options.branchOwnerIssueId,
      branchOwnerIssueIdentifier: options.branchOwnerIssueIdentifier,
      controlPath: options.controlPath,
      createdNow: options.createdNow,
      issueRuntimePath: options.issueRuntimePath,
      originPath: this.getOriginPath(),
      outputPath: options.outputPath,
      path: options.path,
      runtimePath: options.runtimePath,
      sourceRepoPath: this.#repoRoot,
      streamIssueId: options.streamIssueId,
      streamIssueIdentifier: options.streamIssueIdentifier,
      streamRuntimePath: options.streamRuntimePath,
      workerId: this.#workerId,
    };
  }

  getIssueRuntimePath(issueIdentifier: string) {
    return resolveIssueRuntimePath(this.#rootDir, issueIdentifier);
  }

  getStreamRuntimePath(issueIdentifier: string) {
    return resolveStreamRuntimePath(this.#rootDir, issueIdentifier);
  }

  getWorktreePath(issueIdentifier: string) {
    return resolveIssueWorktreePath(this.#rootDir, issueIdentifier);
  }

  async #commit(workspace: PreparedWorkspace, issue: AgentIssue) {
    const dirty = await this.#isDirty(workspace.path);
    if (dirty) {
      await this.#runOrThrow(["git", "add", "-A"], workspace.path);
      await this.#commitWithMessage(workspace.path, `${issue.identifier} ${issue.title}`);
    }
    return await this.#revParseHead(workspace.path);
  }

  async #commitWithMessage(cwd: string, subject: string, body?: string) {
    const commitArgs = ["git"];
    if (!(await this.#gitConfigValue(cwd, "user.name"))) {
      commitArgs.push("-c", "user.name=IO Agent");
    }
    if (!(await this.#gitConfigValue(cwd, "user.email"))) {
      commitArgs.push("-c", "user.email=io-agent@localhost");
    }
    commitArgs.push("commit", "-m", subject);
    if (body?.trim()) {
      commitArgs.push("-m", body.trim());
    }
    await this.#runOrThrow(commitArgs, cwd);
  }

  async #ensureBranch(control: ControlRepo, branchName: string, fallbackRef?: string) {
    if (await this.#localBranchExists(control.path, branchName)) {
      return;
    }
    await this.#runOrThrow(["git", "fetch", "--prune", "origin"], control.path);
    if (await this.#remoteBranchExists(control.path, branchName)) {
      await this.#runOrThrow(["git", "branch", branchName, `origin/${branchName}`], control.path);
      return;
    }
    const baseRef = fallbackRef ?? (await this.#resolveBaseRef(control));
    await this.#runOrThrow(["git", "branch", branchName, baseRef], control.path);
  }

  async #createWorktree(control: ControlRepo, branchName: string, path: string) {
    await this.#runOrThrow(["git", "worktree", "prune"], control.path);
    await this.#runOrThrow(["git", "worktree", "add", "--detach", path, branchName], control.path);
  }

  async #currentBranch(cwd: string) {
    const result = await this.#runCommand(
      ["git", "branch", "--show-current"],
      cwd,
      this.#hooks.timeoutMs,
    );
    if (result.exitCode !== 0) {
      return "";
    }
    return result.stdout.trim();
  }

  async #deleteLocalBranch(cwd: string, branchName: string) {
    if (!(await this.#localBranchExists(cwd, branchName))) {
      return false;
    }
    await this.#runCommand(["git", "branch", "-D", branchName], cwd, this.#hooks.timeoutMs);
    return true;
  }

  async #ensureRemote(cwd: string, name: string, remotePath: string) {
    const setUrl = await this.#runCommand(
      ["git", "remote", "set-url", name, remotePath],
      cwd,
      this.#hooks.timeoutMs,
    );
    if (setUrl.exitCode === 0) {
      return;
    }
    await this.#runOrThrow(["git", "remote", "add", name, remotePath], cwd);
  }

  async #ensureWorktree(control: ControlRepo, branchName: string, path: string) {
    await mkdir(resolve(this.#rootDir, "tree"), { recursive: true });
    if (existsSync(path)) {
      return false;
    }
    await this.#createWorktree(control, branchName, path);
    await this.runHook("afterCreate", this.#hooks.afterCreate, path, true);
    return true;
  }

  async #finalizeTerminalIssue(issue: IssueRuntimeState, linearState: string) {
    this.#reportIssueProgress(issue, `finalizing terminal issue from ${linearState}`);
    if (issue.parentIssueId) {
      await this.#finalizeChildIssue(issue, linearState);
      return;
    }
    await this.#finalizeStreamOwnerIssue(issue, linearState);
  }

  async #finalizeChildIssue(issue: IssueRuntimeState, linearState: string) {
    if (!(await this.#hasIssueCommitLandedOnStream(issue))) {
      this.#reportIssueProgress(
        issue,
        `preserving ${issue.issueIdentifier}; commit not yet on ${issue.branchName}`,
      );
      return;
    }
    await this.#removeIssueWorktree(issue);
    await this.#updateIssueRuntimeState(issue, {
      finalizedAt: new Date().toISOString(),
      finalizedLinearState: linearState,
      status: "finalized",
    });
    const branchOwnerIdentifier = issue.parentIssueIdentifier ?? issue.issueIdentifier;
    await this.#upsertStreamState(
      {
        branchName: issue.branchName,
        parentIssueId: issue.parentIssueId ?? issue.issueId,
        parentIssueIdentifier: branchOwnerIdentifier,
        streamIssueId: issue.streamIssueId,
        streamIssueIdentifier: issue.streamIssueIdentifier,
      },
      {
        activeIssue:
          issue.issueId === (await this.#readStreamState(branchOwnerIdentifier))?.activeIssueId
            ? null
            : undefined,
        status: "active",
      },
    );
    await this.#clearActiveWorker(issue);
  }

  async #finalizeStreamOwnerIssue(issue: IssueRuntimeState, linearState: string) {
    if (normalizeStateName(linearState) === "done") {
      await this.#mergeStreamBranch(issue);
    }
    if (!(await this.#hasStreamLandedOnMain(issue))) {
      this.#reportIssueProgress(issue, `preserving ${issue.branchName}; stream not yet on main`);
      return;
    }
    await this.#removeIssueWorktree(issue);
    if (await this.#deleteLocalBranch(issue.controlPath, issue.branchName)) {
      this.#reportIssueProgress(issue, `deleted local branch ${issue.branchName}`);
    }
    await this.#updateIssueRuntimeState(issue, {
      finalizedAt: new Date().toISOString(),
      finalizedLinearState: linearState,
      status: "finalized",
    });
    await this.#upsertStreamState(
      {
        branchName: issue.branchName,
        parentIssueId: issue.issueId,
        parentIssueIdentifier: issue.issueIdentifier,
        streamIssueId: issue.streamIssueId,
        streamIssueIdentifier: issue.streamIssueIdentifier,
      },
      {
        activeIssue: null,
        status: "completed",
      },
    );
    await this.#clearActiveWorker(issue);
  }

  async #reconcileTerminalFeatureBranches(tracker: IssueStateTracker, terminalStates: Set<string>) {
    const branchStates = (await this.#listStreamStates()).filter(
      (state) => Boolean(state.baseBranchName) && state.status !== "completed",
    );
    if (!branchStates.length) {
      return;
    }
    const featureIssueIds = branchStates.map((state) => state.parentIssueId);
    const stateByIssueId = await tracker.fetchIssueStatesByIds(featureIssueIds);
    const featureByIssueId =
      (await tracker.fetchIssuesByIds?.(featureIssueIds)) ?? new Map<string, AgentIssue>();
    for (const branchState of branchStates) {
      const featureIssue = featureByIssueId.get(branchState.parentIssueId);
      const linearState = featureIssue?.state ?? stateByIssueId.get(branchState.parentIssueId);
      if (!linearState || !terminalStates.has(normalizeStateName(linearState))) {
        continue;
      }
      const streamIssueIdentifier =
        branchState.streamIssueIdentifier ??
        featureIssue?.parentIssueIdentifier ??
        featureIssue?.streamIssueIdentifier;
      if (!streamIssueIdentifier || streamIssueIdentifier === branchState.parentIssueIdentifier) {
        continue;
      }
      try {
        await this.#finalizeCompletedFeatureBranch({
          ...branchState,
          parentIssueTitle: featureIssue?.title ?? branchState.parentIssueTitle,
          streamIssueIdentifier,
        });
      } catch (error) {
        this.#reportStreamProgress(
          branchState,
          `preserving ${branchState.branchName}; feature finalization into ${streamIssueIdentifier} failed`,
        );
        this.#log.error("feature_branch_finalize.failed", {
          error: error instanceof Error ? error : new Error(String(error)),
          issueIdentifier: branchState.parentIssueIdentifier,
        });
      }
    }
  }
  async #removeIssueWorktree(issue: IssueRuntimeState) {
    if (!existsSync(issue.worktreePath)) {
      return;
    }
    await this.runHook("beforeRemove", this.#hooks.beforeRemove, issue.worktreePath, false);
    this.#reportIssueProgress(issue, `removing worktree ${issue.worktreePath}`);
    await this.#removeWorktree(issue.controlPath, issue.worktreePath, true);
  }

  async #clearActiveWorker(issue: IssueRuntimeState) {
    const workerState = await this.#readState();
    if (workerState?.activeIssue?.identifier === issue.issueIdentifier) {
      await this.#writeState(this.createIdleWorkspace(), "idle");
    }
  }

  async #gitConfigValue(cwd: string, key: string) {
    const result = await this.#runCommand(
      ["git", "config", "--get", key],
      cwd,
      this.#hooks.timeoutMs,
    );
    if (result.exitCode !== 0) {
      return undefined;
    }
    return result.stdout.trim() || undefined;
  }

  async #isDirty(cwd: string) {
    const result = await this.#runOrThrow(["git", "status", "--porcelain"], cwd);
    return result.stdout.trim().length > 0;
  }

  async #listIssueStates() {
    try {
      const entries = await readdir(resolve(this.#rootDir, "issue"), { withFileTypes: true });
      const issues = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => {
            try {
              const text = await readFile(
                resolve(this.#rootDir, "issue", entry.name, "issue-state.json"),
                "utf8",
              );
              return JSON.parse(text) as IssueRuntimeState;
            } catch {
              return undefined;
            }
          }),
      );
      return issues.filter((issue): issue is IssueRuntimeState => Boolean(issue));
    } catch {
      return [];
    }
  }

  async #listStreamStates() {
    try {
      const entries = await readdir(resolve(this.#rootDir, "stream"), { withFileTypes: true });
      const streams = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map(async (entry) => {
            try {
              const text = await readFile(resolve(this.#rootDir, "stream", entry.name), "utf8");
              return JSON.parse(text) as StreamRuntimeState;
            } catch {
              return undefined;
            }
          }),
      );
      return streams.filter((stream): stream is StreamRuntimeState => Boolean(stream));
    } catch {
      return [];
    }
  }

  async #localBranchExists(cwd: string, branchName: string) {
    const result = await this.#runCommand(
      ["git", "show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
      cwd,
      this.#hooks.timeoutMs,
    );
    return result.exitCode === 0;
  }

  async #remoteBranchExists(cwd: string, branchName: string) {
    const result = await this.#runCommand(
      ["git", "show-ref", "--verify", "--quiet", `refs/remotes/origin/${branchName}`],
      cwd,
      this.#hooks.timeoutMs,
    );
    return result.exitCode === 0;
  }

  async #isAncestor(cwd: string, ancestor: string, descendant: string) {
    const result = await this.#runCommand(
      ["git", "merge-base", "--is-ancestor", ancestor, descendant],
      cwd,
      this.#hooks.timeoutMs,
    );
    return result.exitCode === 0;
  }

  async #isCommitOnMain(cwd: string, commitSha: string) {
    return await this.#isAncestor(cwd, commitSha, "main");
  }

  async #hasIssueCommitLandedOnStream(issue: IssueRuntimeState) {
    const commitSha =
      issue.landedCommitSha ?? issue.commitSha ?? (await this.#ensureIssueCommitSha(issue));
    if (!commitSha) {
      return false;
    }
    const repoPath = this.#resolveRepoPath(issue);
    if (!repoPath) {
      return false;
    }
    if (await this.#tryRevParse(repoPath, issue.branchName)) {
      return await this.#isAncestor(repoPath, commitSha, issue.branchName);
    }
    if (await this.#tryRevParse(repoPath, `origin/${issue.branchName}`)) {
      return await this.#isAncestor(repoPath, commitSha, `origin/${issue.branchName}`);
    }
    return await this.#isCommitOnMain(repoPath, commitSha);
  }

  async #ensureIssueControlRepo(issue: IssueRuntimeState) {
    if (existsSync(issue.controlPath)) {
      return;
    }
    if (issue.sourceRepoPath && issue.controlPath === issue.sourceRepoPath) {
      throw new Error(
        `issue_control_repo_missing_for_finalize:${issue.issueIdentifier}:${issue.controlPath}`,
      );
    }
    this.#log.info("issue.control_repo.recreate", {
      branchName: issue.branchName,
      controlPath: issue.controlPath,
      issueIdentifier: issue.issueIdentifier,
      originPath: issue.originPath,
    });
    await mkdir(dirname(issue.controlPath), { recursive: true });
    await this.#runOrThrow(
      ["git", "clone", issue.originPath, issue.controlPath],
      dirname(issue.controlPath),
    );
    await this.#ensureRemote(issue.controlPath, "origin", issue.originPath);
    if (issue.sourceRepoPath && issue.originPath !== issue.sourceRepoPath) {
      await this.#ensureRemote(issue.controlPath, "upstream", issue.sourceRepoPath);
    }
  }

  #resolveRepoPath(issue: IssueRuntimeState) {
    if (issue.sourceRepoPath && existsSync(issue.sourceRepoPath)) {
      return issue.sourceRepoPath;
    }
    if (existsSync(issue.controlPath)) {
      return issue.controlPath;
    }
    return undefined;
  }

  async #hasStreamLandedOnMain(issue: IssueRuntimeState) {
    const repoPath = this.#resolveRepoPath(issue);
    if (!repoPath) {
      return false;
    }
    const streamRef = await this.#resolveStreamMergeRef(issue);
    if (!streamRef) {
      return true;
    }
    return await this.#isAncestor(repoPath, streamRef, "main");
  }

  async #refreshControlRepoMain(controlPath: string) {
    const checkoutMain = await this.#runCommand(
      ["git", "checkout", "main"],
      controlPath,
      this.#hooks.timeoutMs,
    );
    if (checkoutMain.exitCode !== 0) {
      await this.#runOrThrow(["git", "checkout", "-B", "main", "origin/main"], controlPath);
      return;
    }
    await this.#runOrThrow(["git", "pull", "--ff-only", "origin", "main"], controlPath);
  }

  async #refreshSourceRepoMain(repoPath: string) {
    const currentBranch = await this.#currentBranch(repoPath);
    if (currentBranch === "main") {
      if (await this.#isDirty(repoPath)) {
        throw new Error(`source_repo_dirty_on_main:${repoPath}`);
      }
      await this.#runOrThrow(["git", "pull", "--ff-only", "origin", "main"], repoPath);
      return;
    }
    await this.#runOrThrow(["git", "fetch", "--prune", "origin"], repoPath);
    const originMain = await this.#revParse(repoPath, "origin/main");
    await this.#runOrThrow(["git", "update-ref", "refs/heads/main", originMain], repoPath);
  }

  async #mergeIntoControlRepo(issue: IssueRuntimeState, streamRef: string) {
    this.#reportIssueProgress(issue, `merging ${streamRef} into main via control repo`);
    await this.#runOrThrow(["git", "checkout", "main"], issue.controlPath);
    await this.#runOrThrow(["git", "merge", "--no-edit", streamRef], issue.controlPath);
    await this.#runOrThrow(["git", "push", "origin", "main"], issue.controlPath);
    this.#reportIssueProgress(issue, "pushed merged main to origin");
  }

  async #mergeIntoSourceRepo(issue: IssueRuntimeState, streamRef: string) {
    const repoPath = issue.sourceRepoPath!;
    const mergeRoot = resolve(this.getWorkerRoot(), "merge");
    const mergeBranch = `io-merge-${toWorkspaceKey(issue.streamIssueIdentifier)}`;
    const mergePath = resolve(mergeRoot, toWorkspaceKey(issue.streamIssueIdentifier));

    await mkdir(mergeRoot, { recursive: true });
    await rm(mergePath, { force: true, recursive: true });
    await this.#runOrThrow(["git", "worktree", "prune"], repoPath);
    await this.#runOrThrow(["git", "worktree", "add", "--detach", mergePath, "main"], repoPath);
    try {
      this.#reportIssueProgress(issue, `merging ${streamRef} into local main`);
      await this.#runOrThrow(["git", "switch", "-c", mergeBranch], mergePath);
      await this.#runOrThrow(["git", "merge", "--no-edit", streamRef], mergePath);
      const mergedSha = await this.#revParseHead(mergePath);
      const currentBranch = await this.#currentBranch(repoPath);
      if (currentBranch === "main") {
        if (await this.#isDirty(repoPath)) {
          throw new Error(`source_repo_dirty_on_main:${repoPath}`);
        }
        await this.#runOrThrow(["git", "merge", "--ff-only", mergedSha], repoPath);
      } else {
        await this.#runOrThrow(["git", "update-ref", "refs/heads/main", mergedSha], repoPath);
      }
      this.#reportIssueProgress(issue, `updated local main to ${mergedSha}`);
    } finally {
      if (existsSync(mergePath)) {
        await this.#runCommand(
          ["git", "worktree", "remove", "--force", mergePath],
          repoPath,
          this.#hooks.timeoutMs,
        );
      }
      await this.#runCommand(["git", "branch", "-D", mergeBranch], repoPath, this.#hooks.timeoutMs);
    }
  }

  async #mergeStreamBranch(issue: IssueRuntimeState) {
    const streamRef = await this.#resolveStreamMergeRef(issue);
    if (!streamRef) {
      this.#reportIssueProgress(issue, `no stream ref found for ${issue.branchName}`);
      return;
    }
    if (await this.#hasStreamLandedOnMain(issue)) {
      this.#reportIssueProgress(issue, `${issue.branchName} already merged into main`);
      return;
    }
    if (issue.sourceRepoPath && issue.controlPath === issue.sourceRepoPath) {
      await this.#refreshSourceRepoMain(issue.sourceRepoPath);
      await this.#mergeIntoSourceRepo(issue, streamRef);
      return;
    }
    await this.#ensureIssueControlRepo(issue);
    await this.#refreshControlRepoMain(issue.controlPath);
    await this.#mergeIntoControlRepo(issue, streamRef);
  }

  async #finalizeCompletedFeatureBranch(stream: StreamRuntimeState) {
    if (!stream.baseBranchName) {
      return;
    }

    const control = await this.ensureCheckout();
    const featureHead = await this.#tryRevParse(control.path, stream.branchName);
    if (!featureHead) {
      await this.#upsertStreamState(
        {
          ...stream,
        },
        {
          activeIssue: null,
          status: "completed",
        },
      );
      return;
    }

    const baseHead = await this.#revParse(control.path, stream.baseBranchName);
    if (await this.#isAncestor(control.path, featureHead, stream.baseBranchName)) {
      this.#reportStreamProgress(
        stream,
        `${stream.branchName} already merged into ${stream.baseBranchName}`,
      );
      await this.#upsertStreamState(
        {
          ...stream,
        },
        {
          activeIssue: null,
          latestLandedCommitSha: baseHead,
          status: "completed",
        },
      );
      await this.#deleteLocalBranch(control.path, stream.branchName);
      return;
    }

    const taskStates = await this.#listFeatureTaskStates(stream.parentIssueIdentifier);
    const commitSha = await this.#squashFeatureBranchIntoBase(control.path, stream, taskStates);
    await this.#upsertStreamState(
      {
        ...stream,
      },
      {
        activeIssue: null,
        latestLandedCommitSha: commitSha,
        status: "completed",
      },
    );
    if (await this.#deleteLocalBranch(control.path, stream.branchName)) {
      this.#reportStreamProgress(stream, `deleted local branch ${stream.branchName}`);
    }
  }

  async #listFeatureTaskStates(featureIssueIdentifier: string) {
    return (await this.#listIssueStates())
      .filter((issue) => issue.parentIssueIdentifier === featureIssueIdentifier)
      .filter((issue) => ["completed", "finalized"].includes(issue.status))
      .sort((left, right) => left.issueIdentifier.localeCompare(right.issueIdentifier));
  }

  async #squashFeatureBranchIntoBase(
    controlPath: string,
    stream: StreamRuntimeState,
    taskStates: IssueRuntimeState[],
  ) {
    const finalizeRoot = resolve(this.getWorkerRoot(), "feature-finalize");
    const finalizePath = resolve(finalizeRoot, toWorkspaceKey(stream.parentIssueIdentifier));
    const finalizeBranch = `io-finalize-${toWorkspaceKey(stream.parentIssueIdentifier)}`;
    const commitBody = this.#renderFeatureCommitBody(taskStates);

    await mkdir(finalizeRoot, { recursive: true });
    await rm(finalizePath, { force: true, recursive: true });
    await this.#runOrThrow(["git", "worktree", "prune"], controlPath);
    await this.#runOrThrow(
      ["git", "worktree", "add", "--detach", finalizePath, stream.baseBranchName!],
      controlPath,
    );

    try {
      this.#reportStreamProgress(
        stream,
        `squashing ${stream.branchName} onto ${stream.baseBranchName}`,
      );
      await this.#runOrThrow(["git", "switch", "-c", finalizeBranch], finalizePath);
      await this.#runOrThrow(["git", "merge", "--squash", stream.branchName], finalizePath);

      const commitArgs = ["git"];
      if (!(await this.#gitConfigValue(finalizePath, "user.name"))) {
        commitArgs.push("-c", "user.name=IO Agent");
      }
      if (!(await this.#gitConfigValue(finalizePath, "user.email"))) {
        commitArgs.push("-c", "user.email=io-agent@localhost");
      }
      commitArgs.push(
        "commit",
        "-m",
        `${stream.parentIssueIdentifier} ${stream.parentIssueTitle ?? stream.parentIssueIdentifier}`,
      );
      if (commitBody) {
        commitArgs.push("-m", commitBody);
      }
      await this.#runOrThrow(commitArgs, finalizePath);

      const squashedSha = await this.#revParseHead(finalizePath);
      const baseHead = await this.#revParse(controlPath, stream.baseBranchName!);
      await this.#runOrThrow(
        ["git", "update-ref", `refs/heads/${stream.baseBranchName}`, squashedSha, baseHead],
        controlPath,
      );
      this.#reportStreamProgress(
        stream,
        `merged ${stream.branchName} into ${stream.baseBranchName} as ${squashedSha}`,
      );
      return squashedSha;
    } finally {
      if (existsSync(finalizePath)) {
        await this.#runCommand(
          ["git", "worktree", "remove", "--force", finalizePath],
          controlPath,
          this.#hooks.timeoutMs,
        );
      }
      await this.#runCommand(
        ["git", "branch", "-D", finalizeBranch],
        controlPath,
        this.#hooks.timeoutMs,
      );
    }
  }

  #renderFeatureCommitBody(taskStates: IssueRuntimeState[]) {
    const lines = taskStates.length
      ? taskStates.map((task) => `- ${task.issueIdentifier} ${task.issueTitle}`)
      : ["- No completed task runs were recorded in tmp/workspace runtime state."];
    return ["Tasks completed:", ...lines].join("\n");
  }

  async #resolveStreamMergeRef(issue: IssueRuntimeState) {
    const repoPath = this.#resolveRepoPath(issue);
    if (repoPath) {
      if (await this.#tryRevParse(repoPath, issue.branchName)) {
        return issue.branchName;
      }
      if (await this.#tryRevParse(repoPath, `origin/${issue.branchName}`)) {
        return `origin/${issue.branchName}`;
      }
    }
    const streamState = await this.#readStreamState(issue.streamIssueIdentifier);
    return streamState?.latestLandedCommitSha ?? issue.landedCommitSha ?? issue.commitSha;
  }

  async #readState(): Promise<WorkerState | undefined> {
    try {
      const text = await readFile(resolve(this.getWorkerRoot(), "worker-state.json"), "utf8");
      return JSON.parse(text) as WorkerState;
    } catch {
      return undefined;
    }
  }

  async #readWorkerState(workerId: string): Promise<WorkerState | undefined> {
    try {
      const text = await readFile(
        resolve(this.#rootDir, "workers", workerId, "worker-state.json"),
        "utf8",
      );
      return JSON.parse(text) as WorkerState;
    } catch {
      return undefined;
    }
  }

  async #readStreamState(issueIdentifier: string) {
    return await readStreamRuntimeState(this.#rootDir, issueIdentifier);
  }

  async #removeWorktree(controlPath: string, path: string, force: boolean) {
    const args = ["git", "worktree", "remove"];
    if (force) {
      args.push("--force");
    }
    args.push(path);
    await this.#runOrThrow(args, controlPath);
  }

  async #resolveBaseRef(control: ControlRepo) {
    if (!control.usesControlClone) {
      return "main";
    }
    const useUpstream = Boolean(this.#repoRoot && this.getOriginPath() !== this.#repoRoot);
    if (useUpstream) {
      await this.#runOrThrow(["git", "fetch", "--prune", "upstream"], control.path);
      return "upstream/main";
    }
    await this.#runOrThrow(["git", "fetch", "--prune", "origin"], control.path);
    return "origin/main";
  }

  async #revParseHead(cwd: string) {
    return await this.#revParse(cwd, "HEAD");
  }

  async #revParse(cwd: string, ref: string) {
    const result = await this.#runOrThrow(["git", "rev-parse", ref], cwd);
    return result.stdout.trim();
  }

  async #tryRevParse(cwd: string, ref: string) {
    try {
      return await this.#revParse(cwd, ref);
    } catch {
      return undefined;
    }
  }

  async #runOrThrow(command: string[], cwd: string) {
    const result = await this.#runCommand(command, cwd, this.#hooks.timeoutMs);
    if (result.exitCode === 0) {
      return result;
    }
    throw new Error(result.stderr.trim() || result.stdout.trim() || `${command.join(" ")} failed`);
  }

  async #landTaskCommitOnBranch(
    workspace: PreparedWorkspace,
    issue: Pick<AgentIssue, "identifier">,
    commitSha: string,
  ): Promise<TaskLandingResult> {
    let taskCommitSha = commitSha;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const branchHead = await this.#revParse(workspace.controlPath, workspace.branchName);
      if (branchHead === taskCommitSha) {
        return { landedCommitSha: branchHead, taskCommitSha };
      }
      if (await this.#isAncestor(workspace.controlPath, branchHead, taskCommitSha)) {
        const landedCommitSha = await this.#mergeTaskCommitIntoBranch(
          workspace,
          issue,
          taskCommitSha,
          branchHead,
        );
        return { landedCommitSha, taskCommitSha };
      }
      if (await this.#isAncestor(workspace.controlPath, taskCommitSha, branchHead)) {
        this.#reportIssueProgress(
          {
            branchName: workspace.branchName,
            issueIdentifier: issue.identifier,
          },
          `task work already covered by ${workspace.branchName} at ${branchHead}`,
        );
        return { landedCommitSha: branchHead, taskCommitSha };
      }
      taskCommitSha = await this.#rebaseTaskCommitOntoBranch(workspace, issue);
    }
    throw new Error(`task_landing_did_not_converge:${issue.identifier}:${workspace.branchName}`);
  }

  async #rebaseTaskCommitOntoBranch(
    workspace: PreparedWorkspace,
    issue: Pick<AgentIssue, "identifier">,
  ) {
    this.#reportIssueProgress(
      {
        branchName: workspace.branchName,
        issueIdentifier: issue.identifier,
      },
      `rebasing task work onto ${workspace.branchName}`,
    );
    const result = await this.#runCommand(
      ["git", "rebase", workspace.branchName],
      workspace.path,
      this.#hooks.timeoutMs,
    );
    if (result.exitCode !== 0) {
      this.#reportIssueProgress(
        {
          branchName: workspace.branchName,
          issueIdentifier: issue.identifier,
        },
        `preserving ${workspace.path}; task landing rebase onto ${workspace.branchName} failed`,
      );
      throw new Error(
        `task_landing_rebase_failed:${issue.identifier}:${workspace.branchName}:${result.stderr.trim() || result.stdout.trim() || "git rebase failed"}`,
      );
    }
    const rebasedCommitSha = await this.#revParseHead(workspace.path);
    this.#reportIssueProgress(
      {
        branchName: workspace.branchName,
        issueIdentifier: issue.identifier,
      },
      `rebased task work onto ${workspace.branchName} as ${rebasedCommitSha}`,
    );
    return rebasedCommitSha;
  }

  async #mergeTaskCommitIntoBranch(
    workspace: PreparedWorkspace,
    issue: Pick<AgentIssue, "identifier">,
    taskCommitSha: string,
    branchHead: string,
  ) {
    const landingRoot = resolve(this.getWorkerRoot(), "task-landing");
    const landingPath = resolve(landingRoot, toWorkspaceKey(issue.identifier));
    const landingBranch = `io-land-${toWorkspaceKey(issue.identifier)}`;

    await mkdir(landingRoot, { recursive: true });
    await rm(landingPath, { force: true, recursive: true });
    await this.#runOrThrow(["git", "worktree", "prune"], workspace.controlPath);
    await this.#runCommand(
      ["git", "branch", "-D", landingBranch],
      workspace.controlPath,
      this.#hooks.timeoutMs,
    );
    await this.#runOrThrow(
      ["git", "worktree", "add", "--detach", landingPath, branchHead],
      workspace.controlPath,
    );
    try {
      this.#reportIssueProgress(
        {
          branchName: workspace.branchName,
          issueIdentifier: issue.identifier,
        },
        `merging task work into ${workspace.branchName}`,
      );
      await this.#runOrThrow(["git", "switch", "-c", landingBranch], landingPath);
      await this.#runOrThrow(["git", "merge", "--ff-only", taskCommitSha], landingPath);
      const landedCommitSha = await this.#revParseHead(landingPath);
      await this.#runOrThrow(
        ["git", "update-ref", `refs/heads/${workspace.branchName}`, landedCommitSha, branchHead],
        workspace.controlPath,
      );
      this.#reportIssueProgress(
        {
          branchName: workspace.branchName,
          issueIdentifier: issue.identifier,
        },
        `landed task work on ${workspace.branchName} as ${landedCommitSha}`,
      );
      return landedCommitSha;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `task_landing_merge_failed:${issue.identifier}:${workspace.branchName}:${message}`,
      );
    } finally {
      if (existsSync(landingPath)) {
        await this.#runCommand(
          ["git", "worktree", "remove", "--force", landingPath],
          workspace.controlPath,
          this.#hooks.timeoutMs,
        );
      }
      await this.#runCommand(
        ["git", "branch", "-D", landingBranch],
        workspace.controlPath,
        this.#hooks.timeoutMs,
      );
    }
  }

  async #ensureIssueCommitSha(issue: IssueRuntimeState, preferWorktree = false) {
    if (issue.commitSha && !preferWorktree) {
      return issue.commitSha;
    }
    const refs = [
      preferWorktree && existsSync(issue.worktreePath)
        ? { cwd: issue.worktreePath, ref: "HEAD" }
        : undefined,
      existsSync(issue.worktreePath) ? { cwd: issue.worktreePath, ref: "HEAD" } : undefined,
      existsSync(issue.controlPath) ? { cwd: issue.controlPath, ref: issue.branchName } : undefined,
      existsSync(issue.controlPath)
        ? { cwd: issue.controlPath, ref: `origin/${issue.branchName}` }
        : undefined,
    ].filter((value): value is { cwd: string; ref: string } => Boolean(value));
    for (const candidate of refs) {
      try {
        const commitSha = await this.#revParse(candidate.cwd, candidate.ref);
        await this.#updateIssueRuntimeState(issue, { commitSha });
        return commitSha;
      } catch {
        continue;
      }
    }
    return issue.commitSha;
  }

  #isPidAlive(pid: number) {
    if (!Number.isInteger(pid) || pid <= 0) {
      return false;
    }
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  async #isIssueWorkerActive(issue: IssueRuntimeState) {
    const workerState = await this.#readWorkerState(issue.workerId);
    if (!workerState) {
      return false;
    }
    if (workerState.status !== "running") {
      return false;
    }
    if (workerState.activeIssue?.identifier !== issue.issueIdentifier) {
      return false;
    }
    return this.#isPidAlive(workerState.pid);
  }

  #reportIssueProgress(
    issue: Pick<IssueRuntimeState, "branchName" | "issueIdentifier">,
    message: string,
  ) {
    this.#log.info("issue.finalize.progress", {
      branchName: issue.branchName,
      issueIdentifier: issue.issueIdentifier,
      message,
    });
    process.stdout.write(`${issue.issueIdentifier}: ${message}\n`);
  }

  #reportStreamProgress(
    stream: Pick<StreamRuntimeState, "branchName" | "parentIssueIdentifier">,
    message: string,
  ) {
    this.#log.info("stream.finalize.progress", {
      branchName: stream.branchName,
      issueIdentifier: stream.parentIssueIdentifier,
      message,
    });
    process.stdout.write(`${stream.parentIssueIdentifier}: ${message}\n`);
  }

  #usesControlClone() {
    return !this.#repoRoot || this.getOriginPath() !== this.#repoRoot;
  }

  async #writeIssueState(
    workspace: PreparedWorkspace,
    issue: AgentIssue,
    status: IssueRuntimeStatus,
    options: {
      blockedReason?: string;
      commitSha?: string;
      interruptedReason?: string;
      landedAt?: string;
      landedCommitSha?: string;
    } = {},
  ) {
    const streamIssue = resolveWorkflowStreamIssue(issue);
    const branchOwnerIssue = resolveBranchOwnerIssue(issue);
    const runtimePath =
      workspace.issueRuntimePath ??
      workspace.runtimePath ??
      this.getIssueRuntimePath(issue.identifier);
    const previousState = await readIssueRuntimeState(this.#rootDir, issue.identifier);
    const state: IssueRuntimeState = {
      baseBranchName: workspace.baseBranchName,
      baseIssueId: workspace.baseIssueId,
      baseIssueIdentifier: workspace.baseIssueIdentifier,
      blockedReason: options.blockedReason,
      branchName: workspace.branchName,
      commitSha: options.commitSha ?? previousState?.commitSha,
      controlPath: workspace.controlPath,
      finalizedAt: undefined,
      finalizedLinearState: undefined,
      interruptedReason: options.interruptedReason,
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      issueTitle: issue.title,
      landedAt: options.landedAt ?? previousState?.landedAt,
      landedCommitSha: options.landedCommitSha ?? previousState?.landedCommitSha,
      originPath: workspace.originPath,
      outputPath: workspace.outputPath ?? resolve(runtimePath, "output.log"),
      parentIssueId: issue.parentIssueId,
      parentIssueIdentifier: issue.parentIssueIdentifier,
      runtimePath,
      sourceRepoPath: workspace.sourceRepoPath,
      status,
      streamIssueId: streamIssue.id,
      streamIssueIdentifier: streamIssue.identifier,
      streamRuntimePath:
        workspace.streamRuntimePath ?? this.getStreamRuntimePath(branchOwnerIssue.identifier),
      updatedAt: new Date().toISOString(),
      workerId: workspace.workerId,
      worktreePath: workspace.path,
    };
    await this.#writeIssueRuntimeState(state);
  }

  async #updateIssueRuntimeState(
    issue: IssueRuntimeState,
    updates: Partial<
      Pick<
        IssueRuntimeState,
        | "commitSha"
        | "finalizedAt"
        | "finalizedLinearState"
        | "blockedReason"
        | "interruptedReason"
        | "landedAt"
        | "landedCommitSha"
        | "status"
      >
    >,
  ) {
    const state: IssueRuntimeState = {
      ...issue,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    Object.assign(issue, state);
    await this.#writeIssueRuntimeState(state);
  }

  async #writeIssueRuntimeState(state: IssueRuntimeState) {
    await mkdir(state.runtimePath, { recursive: true });
    await writeFile(resolve(state.runtimePath, "issue-state.json"), JSON.stringify(state, null, 2));
  }

  async #upsertStreamState(
    stream: {
      baseBranchName?: string;
      baseIssueId?: string;
      baseIssueIdentifier?: string;
      branchName: string;
      parentIssueId: string;
      parentIssueIdentifier: string;
      streamIssueId?: string;
      streamIssueIdentifier?: string;
      parentIssueTitle?: string;
    },
    updates: {
      activeIssue?: { id: string; identifier: string } | null;
      latestLandedCommitSha?: string;
      status?: StreamRuntimeState["status"];
    },
  ) {
    const current = await this.#readStreamState(stream.parentIssueIdentifier);
    const state: StreamRuntimeState = {
      activeIssueId:
        updates.activeIssue === undefined ? current?.activeIssueId : updates.activeIssue?.id,
      activeIssueIdentifier:
        updates.activeIssue === undefined
          ? current?.activeIssueIdentifier
          : updates.activeIssue?.identifier,
      baseBranchName: stream.baseBranchName ?? current?.baseBranchName,
      baseIssueId: stream.baseIssueId ?? current?.baseIssueId,
      baseIssueIdentifier: stream.baseIssueIdentifier ?? current?.baseIssueIdentifier,
      branchName: stream.branchName,
      createdAt: current?.createdAt ?? new Date().toISOString(),
      latestLandedCommitSha: updates.latestLandedCommitSha ?? current?.latestLandedCommitSha,
      parentIssueId: stream.parentIssueId,
      parentIssueIdentifier: stream.parentIssueIdentifier,
      parentIssueTitle: stream.parentIssueTitle ?? current?.parentIssueTitle,
      status: updates.status ?? current?.status ?? "active",
      streamIssueId: stream.streamIssueId ?? current?.streamIssueId,
      streamIssueIdentifier: stream.streamIssueIdentifier ?? current?.streamIssueIdentifier,
      updatedAt: new Date().toISOString(),
      worktreeRoot: resolve(this.#rootDir, "tree"),
    };
    await this.#writeStreamRuntimeState(state);
  }

  async #writeStreamRuntimeState(state: StreamRuntimeState) {
    await mkdir(dirname(resolveStreamRuntimePath(this.#rootDir, state.parentIssueIdentifier)), {
      recursive: true,
    });
    await writeFile(
      resolveStreamRuntimePath(this.#rootDir, state.parentIssueIdentifier),
      JSON.stringify(state, null, 2),
    );
  }

  async #writeState(workspace: PreparedWorkspace, status: WorkerStatus, issue?: AgentIssue) {
    const state: WorkerState = {
      activeIssue: issue ? { identifier: issue.identifier, title: issue.title } : undefined,
      branchName: workspace.branchName,
      checkoutPath: workspace.path,
      controlPath: workspace.controlPath,
      issueRuntimePath: workspace.issueRuntimePath ?? workspace.runtimePath,
      originPath: workspace.originPath,
      outputPath: workspace.outputPath,
      pid: process.pid,
      sourceRepoPath: workspace.sourceRepoPath,
      status,
      updatedAt: new Date().toISOString(),
      workerId: workspace.workerId,
    };
    await mkdir(this.getWorkerRoot(), { recursive: true });
    await writeFile(
      resolve(this.getWorkerRoot(), "worker-state.json"),
      JSON.stringify(state, null, 2),
    );
  }
}

export { CheckoutManager as WorkspaceManager };
