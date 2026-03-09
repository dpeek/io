import { createLogger, type Logger } from "@io/lib";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { AgentIssue, HookConfig, PreparedWorkspace } from "./types.js";

import { toWorkspaceKey } from "./workflow.js";

type CommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

type CommandRunner = (command: string[], cwd: string, timeoutMs?: number) => Promise<CommandResult>;

type WorkerStatus = "blocked" | "idle" | "running";

type IssueRuntimeStatus = "blocked" | "completed" | "running";

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
  branchName: string;
  commitSha?: string;
  controlPath: string;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  originPath: string;
  outputPath: string;
  runtimePath: string;
  sourceRepoPath?: string;
  status: IssueRuntimeStatus;
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

export function toIssueRuntimeKey(issueIdentifier: string) {
  return toWorkspaceKey(issueIdentifier);
}

export function resolveIssueRuntimePath(rootDir: string, issueIdentifier: string) {
  return resolve(rootDir, "issues", toIssueRuntimeKey(issueIdentifier));
}

export function resolveIssueOutputPath(rootDir: string, issueIdentifier: string) {
  return resolve(resolveIssueRuntimePath(rootDir, issueIdentifier), "output.log");
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
    const branchName = this.getBranchName(issue);
    const path = this.getWorktreePath(branchName);
    const runtimePath = this.getIssueRuntimePath(branchName);
    const outputPath = resolve(runtimePath, "output.log");

    await mkdir(runtimePath, { recursive: true });
    const state = await this.#readState();
    if (
      state?.activeIssue?.identifier &&
      state.activeIssue.identifier !== issue.identifier &&
      state.status !== "idle"
    ) {
      const currentBranch =
        state.checkoutPath && existsSync(state.checkoutPath)
          ? await this.#currentBranch(state.checkoutPath)
          : (state.branchName ?? "");
      throw new Error(
        `worker_checkout_dirty:${this.#workerId}:${currentBranch || "unknown"}:${state.activeIssue.identifier}`,
      );
    }

    if (existsSync(path)) {
      const dirty = await this.#isDirty(path);
      const currentBranch = await this.#currentBranch(path);
      if (dirty) {
        if (state?.activeIssue?.identifier !== issue.identifier && currentBranch !== branchName) {
          throw new Error(
            `worker_checkout_dirty:${this.#workerId}:${currentBranch || "unknown"}:${state?.activeIssue?.identifier ?? "unknown"}`,
          );
        }
      } else if (currentBranch && currentBranch !== branchName) {
        await this.#removeWorktree(control.path, path, false);
      }
    }

    const createdNow = await this.#ensureWorktree(control, branchName, path);
    const preparedWorkspace = this.#buildPreparedWorkspace({
      branchName,
      controlPath: control.path,
      createdNow,
      outputPath,
      path,
      runtimePath,
    });
    await this.#writeIssueState(preparedWorkspace, issue, "running");
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
    const commitSha = await this.#commitAndPush(workspace, issue);
    await this.#writeIssueState(workspace, issue, "completed", { commitSha });
    await this.#writeState(workspace, "idle");
    return { commitSha };
  }

  async markBlocked(workspace: PreparedWorkspace, issue: AgentIssue) {
    await this.#writeIssueState(workspace, issue, "blocked");
    await this.#writeState(workspace, "blocked", issue);
  }

  async reconcileTerminalIssues(tracker: IssueStateTracker, terminalStates: string[]) {
    const retainedIssues = (await this.#listIssueStates()).filter(
      (issue) => issue.status !== "running",
    );
    if (!retainedIssues.length) {
      return;
    }

    const terminalStateSet = new Set(terminalStates.map(normalizeStateName));
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

  getBranchName(issue: AgentIssue) {
    return toWorkspaceKey(issue.identifier);
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
      "branchName" | "controlPath" | "createdNow" | "outputPath" | "path" | "runtimePath"
    >,
  ): PreparedWorkspace {
    return {
      branchName: options.branchName,
      controlPath: options.controlPath,
      createdNow: options.createdNow,
      originPath: this.getOriginPath(),
      outputPath: options.outputPath,
      path: options.path,
      runtimePath: options.runtimePath,
      sourceRepoPath: this.#repoRoot,
      workerId: this.#workerId,
    };
  }

  getIssueRuntimePath(issueIdentifier: string) {
    return resolveIssueRuntimePath(this.#rootDir, issueIdentifier);
  }

  getWorktreePath(branchName: string) {
    return resolve(this.#rootDir, "worktrees", branchName);
  }

  async #commitAndPush(workspace: PreparedWorkspace, issue: AgentIssue) {
    const dirty = await this.#isDirty(workspace.path);
    if (dirty) {
      await this.#runOrThrow(["git", "add", "-A"], workspace.path);
      const commitArgs = ["git"];
      if (!(await this.#gitConfigValue(workspace.path, "user.name"))) {
        commitArgs.push("-c", "user.name=IO Agent");
      }
      if (!(await this.#gitConfigValue(workspace.path, "user.email"))) {
        commitArgs.push("-c", "user.email=io-agent@localhost");
      }
      commitArgs.push("commit", "-m", `${issue.identifier} ${issue.title}`);
      await this.#runOrThrow(commitArgs, workspace.path);
    }
    await this.#runOrThrow(["git", "push", "-u", "origin", "HEAD"], workspace.path);
    return await this.#revParseHead(workspace.path);
  }

  async #createWorktree(control: ControlRepo, branchName: string, path: string) {
    await this.#runOrThrow(["git", "worktree", "prune"], control.path);
    if (await this.#localBranchExists(control.path, branchName)) {
      await this.#runOrThrow(["git", "worktree", "add", path, branchName], control.path);
      return;
    }
    const baseRef = await this.#resolveBaseRef(control);
    await this.#runOrThrow(
      ["git", "worktree", "add", "--checkout", "-B", branchName, path, baseRef],
      control.path,
    );
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
    await this.#runCommand(["git", "branch", "-D", branchName], cwd, this.#hooks.timeoutMs);
  }

  async #deleteRemoteBranch(cwd: string, branchName: string) {
    await this.#runCommand(
      ["git", "push", "origin", "--delete", branchName],
      cwd,
      this.#hooks.timeoutMs,
    );
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
    await mkdir(resolve(this.#rootDir, "worktrees"), { recursive: true });
    if (existsSync(path)) {
      return false;
    }
    await this.#createWorktree(control, branchName, path);
    await this.runHook("afterCreate", this.#hooks.afterCreate, path, true);
    return true;
  }

  async #finalizeTerminalIssue(issue: IssueRuntimeState, linearState: string) {
    if (normalizeStateName(linearState) === "done") {
      await this.#mergeIssueBranch(issue);
    }
    if (existsSync(issue.worktreePath)) {
      await this.runHook("beforeRemove", this.#hooks.beforeRemove, issue.worktreePath, false);
      await this.#removeWorktree(issue.controlPath, issue.worktreePath, true);
    }
    await this.#deleteLocalBranch(issue.controlPath, issue.branchName);
    await this.#deleteRemoteBranch(issue.controlPath, issue.branchName);
    await rm(issue.runtimePath, { force: true, recursive: true });
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
      const entries = await readdir(resolve(this.#rootDir, "issues"), { withFileTypes: true });
      const issues = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => {
            try {
              const text = await readFile(
                resolve(this.#rootDir, "issues", entry.name, "issue-state.json"),
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

  async #isCommitOnMain(cwd: string, commitSha: string) {
    const result = await this.#runCommand(
      ["git", "merge-base", "--is-ancestor", commitSha, "main"],
      cwd,
      this.#hooks.timeoutMs,
    );
    return result.exitCode === 0;
  }

  async #ensureIssueControlRepo(issue: IssueRuntimeState) {
    if (existsSync(issue.controlPath)) {
      return;
    }
    if (issue.sourceRepoPath && issue.controlPath === issue.sourceRepoPath) {
      throw new Error(`issue_control_repo_missing_for_finalize:${issue.issueIdentifier}:${issue.controlPath}`);
    }
    this.#log.info("issue.control_repo.recreate", {
      branchName: issue.branchName,
      controlPath: issue.controlPath,
      issueIdentifier: issue.issueIdentifier,
      originPath: issue.originPath,
    });
    await mkdir(dirname(issue.controlPath), { recursive: true });
    await this.#runOrThrow(["git", "clone", issue.originPath, issue.controlPath], dirname(issue.controlPath));
    await this.#ensureRemote(issue.controlPath, "origin", issue.originPath);
    if (issue.sourceRepoPath && issue.originPath !== issue.sourceRepoPath) {
      await this.#ensureRemote(issue.controlPath, "upstream", issue.sourceRepoPath);
    }
  }

  async #canFinalizeWithoutBranch(issue: IssueRuntimeState) {
    if (!issue.commitSha) {
      return false;
    }
    const repoPath =
      issue.sourceRepoPath && existsSync(issue.sourceRepoPath)
        ? issue.sourceRepoPath
        : existsSync(issue.controlPath)
          ? issue.controlPath
          : undefined;
    if (!repoPath) {
      return false;
    }
    const alreadyMerged = await this.#isCommitOnMain(repoPath, issue.commitSha);
    if (alreadyMerged) {
      this.#log.info("issue.finalize.already_merged", {
        branchName: issue.branchName,
        commitSha: issue.commitSha,
        issueIdentifier: issue.issueIdentifier,
      });
    }
    return alreadyMerged;
  }

  async #ensureIssueWorktree(issue: IssueRuntimeState) {
    if (existsSync(issue.worktreePath)) {
      return;
    }
    await this.#ensureIssueControlRepo(issue);
    this.#log.info("issue.worktree.recreate", {
      branchName: issue.branchName,
      issueIdentifier: issue.issueIdentifier,
      worktreePath: issue.worktreePath,
    });
    await mkdir(resolve(this.#rootDir, "worktrees"), { recursive: true });
    await this.#runOrThrow(["git", "worktree", "prune"], issue.controlPath);
    if (await this.#localBranchExists(issue.controlPath, issue.branchName)) {
      await this.#runOrThrow(
        ["git", "worktree", "add", issue.worktreePath, issue.branchName],
        issue.controlPath,
      );
      return;
    }
    await this.#runOrThrow(["git", "fetch", "--prune", "origin"], issue.controlPath);
    if (await this.#remoteBranchExists(issue.controlPath, issue.branchName)) {
      await this.#runOrThrow(
        [
          "git",
          "worktree",
          "add",
          "--checkout",
          "-B",
          issue.branchName,
          issue.worktreePath,
          `origin/${issue.branchName}`,
        ],
        issue.controlPath,
      );
      return;
    }
    if (await this.#canFinalizeWithoutBranch(issue)) {
      return;
    }
    throw new Error(`issue_branch_missing_for_finalize:${issue.issueIdentifier}:${issue.branchName}`);
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

  async #refreshMainAndRebaseIssueBranch(issue: IssueRuntimeState) {
    if (issue.sourceRepoPath && issue.controlPath === issue.sourceRepoPath) {
      await this.#refreshSourceRepoMain(issue.sourceRepoPath);
    } else {
      await this.#ensureIssueControlRepo(issue);
      await this.#refreshControlRepoMain(issue.controlPath);
    }
    await this.#ensureIssueWorktree(issue);
    if (!existsSync(issue.worktreePath)) {
      return false;
    }
    await this.#runOrThrow(["git", "rebase", "main"], issue.worktreePath);
    return true;
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

  async #mergeIntoControlRepo(issue: IssueRuntimeState) {
    await this.#runOrThrow(["git", "checkout", "main"], issue.controlPath);
    await this.#runOrThrow(["git", "merge", "--no-edit", issue.branchName], issue.controlPath);
    await this.#runOrThrow(["git", "push", "origin", "main"], issue.controlPath);
  }

  async #mergeIntoSourceRepo(issue: IssueRuntimeState) {
    const repoPath = issue.sourceRepoPath!;
    const mergeRoot = resolve(this.getWorkerRoot(), "merge");
    const mergeBranch = `io-merge-${issue.branchName}`;
    const mergePath = resolve(mergeRoot, issue.branchName);

    await mkdir(mergeRoot, { recursive: true });
    await rm(mergePath, { force: true, recursive: true });
    await this.#runOrThrow(["git", "worktree", "prune"], repoPath);
    await this.#runOrThrow(["git", "worktree", "add", "--detach", mergePath, "main"], repoPath);
    try {
      await this.#runOrThrow(["git", "switch", "-c", mergeBranch], mergePath);
      await this.#runOrThrow(["git", "merge", "--no-edit", issue.branchName], mergePath);
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

  async #mergeIssueBranch(issue: IssueRuntimeState) {
    if (!(await this.#refreshMainAndRebaseIssueBranch(issue))) {
      return;
    }
    if (issue.sourceRepoPath && issue.controlPath === issue.sourceRepoPath) {
      await this.#mergeIntoSourceRepo(issue);
      return;
    }
    await this.#mergeIntoControlRepo(issue);
  }

  async #readState(): Promise<WorkerState | undefined> {
    try {
      const text = await readFile(resolve(this.getWorkerRoot(), "worker-state.json"), "utf8");
      return JSON.parse(text) as WorkerState;
    } catch {
      return undefined;
    }
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

  async #runOrThrow(command: string[], cwd: string) {
    const result = await this.#runCommand(command, cwd, this.#hooks.timeoutMs);
    if (result.exitCode === 0) {
      return result;
    }
    throw new Error(result.stderr.trim() || result.stdout.trim() || `${command.join(" ")} failed`);
  }

  #usesControlClone() {
    return !this.#repoRoot || this.getOriginPath() !== this.#repoRoot;
  }

  async #writeIssueState(
    workspace: PreparedWorkspace,
    issue: AgentIssue,
    status: IssueRuntimeStatus,
    options: { commitSha?: string } = {},
  ) {
    const runtimePath = workspace.runtimePath ?? this.getIssueRuntimePath(issue.identifier);
    const state: IssueRuntimeState = {
      branchName: workspace.branchName,
      commitSha: options.commitSha,
      controlPath: workspace.controlPath,
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      issueTitle: issue.title,
      originPath: workspace.originPath,
      outputPath: workspace.outputPath ?? resolve(runtimePath, "output.log"),
      runtimePath,
      sourceRepoPath: workspace.sourceRepoPath,
      status,
      updatedAt: new Date().toISOString(),
      workerId: workspace.workerId,
      worktreePath: workspace.path,
    };
    await mkdir(runtimePath, { recursive: true });
    await writeFile(resolve(runtimePath, "issue-state.json"), JSON.stringify(state, null, 2));
  }

  async #writeState(workspace: PreparedWorkspace, status: WorkerStatus, issue?: AgentIssue) {
    const state: WorkerState = {
      activeIssue: issue ? { identifier: issue.identifier, title: issue.title } : undefined,
      branchName: workspace.branchName,
      checkoutPath: workspace.path,
      controlPath: workspace.controlPath,
      issueRuntimePath: workspace.runtimePath,
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
