import { createLogger, type Logger } from "@io/lib";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { AgentIssue, HookConfig, PreparedWorkspace } from "./types.js";

import { toWorkspaceKey } from "./workflow.js";

type CommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

type CommandRunner = (command: string[], cwd: string, timeoutMs?: number) => Promise<CommandResult>;

export interface WorkspaceManagerOptions {
  hooks: HookConfig;
  log?: Logger;
  originPath?: string;
  repoRoot?: string;
  rootDir: string;
  runCommand?: CommandRunner;
  workerId: string;
}

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

type WorkerState = {
  activeIssue?: {
    identifier: string;
    title: string;
  };
  branchName?: string;
  checkoutPath: string;
  originPath: string;
  pid: number;
  sourceRepoPath?: string;
  status: "blocked" | "idle" | "running";
  updatedAt: string;
  workerId: string;
};

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
    const { createdNow, path } = await this.ensureCheckout();
    const branchName = this.getBranchName(issue);
    if (this.#repoRoot && this.getOriginPath() !== this.#repoRoot) {
      await this.#ensureRemote(path, "upstream", this.#repoRoot);
    }

    const state = await this.#readState();
    const dirty = await this.#isDirty(path);
    const currentBranch = await this.#currentBranch(path);
    if (dirty) {
      if (state?.activeIssue?.identifier !== issue.identifier && currentBranch !== branchName) {
        throw new Error(
          `worker_checkout_dirty:${this.#workerId}:${currentBranch || "unknown"}:${state?.activeIssue?.identifier ?? "unknown"}`,
        );
      }
      const preparedWorkspace = this.#buildPreparedWorkspace(branchName, createdNow, path);
      await this.#writeState(preparedWorkspace, "running", issue);
      return preparedWorkspace;
    }

    const useUpstream = Boolean(this.#repoRoot && this.getOriginPath() !== this.#repoRoot);
    const baseRef = useUpstream ? "upstream/main" : "origin/main";
    if (useUpstream) {
      await this.#runOrThrow(["git", "fetch", "--prune", "upstream"], path);
    } else {
      await this.#runOrThrow(["git", "fetch", "--prune", "origin"], path);
    }
    await this.#runOrThrow(["git", "checkout", "-B", "main", baseRef], path);
    await this.#runOrThrow(["git", "checkout", "-B", branchName, baseRef], path);

    const preparedWorkspace = this.#buildPreparedWorkspace(branchName, createdNow, path);
    await this.#writeState(preparedWorkspace, "running", issue);
    return preparedWorkspace;
  }

  async ensureCheckout() {
    await mkdir(this.getWorkerRoot(), { recursive: true });
    const path = this.getCheckoutPath();
    const createdNow = !existsSync(path);
    if (createdNow) {
      await this.#runOrThrow(["git", "clone", this.getOriginPath(), path], this.getWorkerRoot());
      await this.runHook("afterCreate", this.#hooks.afterCreate, path, true);
    }
    await this.#ensureRemote(path, "origin", this.getOriginPath());
    if (this.#repoRoot && this.getOriginPath() !== this.#repoRoot) {
      await this.#ensureRemote(path, "upstream", this.#repoRoot);
    }
    return { createdNow, path };
  }

  async ensureSessionStartState() {
    const checkout = await this.ensureCheckout();
    const dirty = await this.#isDirty(checkout.path);
    if (dirty) {
      const currentBranch = await this.#currentBranch(checkout.path);
      throw new Error(`worker_checkout_dirty_on_start:${this.#workerId}:${currentBranch || "unknown"}`);
    }
    const checkoutMain = await this.#runCommand(
      ["git", "checkout", "main"],
      checkout.path,
      this.#hooks.timeoutMs,
    );
    if (checkoutMain.exitCode !== 0) {
      await this.#runOrThrow(["git", "checkout", "-B", "main", "origin/main"], checkout.path);
    }
    await this.#runOrThrow(["git", "pull", "--ff-only", "origin", "main"], checkout.path);
    return checkout;
  }

  async cleanup(workspace: PreparedWorkspace) {
    await this.#writeState(workspace, "idle");
  }

  async markBlocked(workspace: PreparedWorkspace, issue: AgentIssue) {
    await this.#writeState(workspace, "blocked", issue);
  }

  getBranchName(issue: AgentIssue) {
    return toWorkspaceKey(issue.identifier);
  }

  createIdleWorkspace() {
    return this.#buildPreparedWorkspace("main", !existsSync(this.getCheckoutPath()), this.getCheckoutPath());
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

  getCheckoutPath() {
    return resolve(this.getWorkerRoot(), "repo");
  }

  getOriginPath() {
    return this.#originPath ?? this.#repoRoot ?? resolve(this.#rootDir, "remotes", "origin.git");
  }

  getWorkerRoot() {
    return resolve(this.#rootDir, "workers", this.#workerId);
  }

  async #currentBranch(cwd: string) {
    const result = await this.#runCommand(["git", "branch", "--show-current"], cwd, this.#hooks.timeoutMs);
    if (result.exitCode !== 0) {
      return "";
    }
    return result.stdout.trim();
  }

  #buildPreparedWorkspace(branchName: string, createdNow: boolean, path: string): PreparedWorkspace {
    return {
      branchName,
      createdNow,
      originPath: this.getOriginPath(),
      path,
      sourceRepoPath: this.#repoRoot,
      workerId: this.#workerId,
    };
  }

  async #ensureRemote(cwd: string, name: string, remotePath: string) {
    const setUrl = await this.#runCommand(["git", "remote", "set-url", name, remotePath], cwd, this.#hooks.timeoutMs);
    if (setUrl.exitCode === 0) {
      return;
    }
    await this.#runOrThrow(["git", "remote", "add", name, remotePath], cwd);
  }

  async #isDirty(cwd: string) {
    const result = await this.#runOrThrow(["git", "status", "--porcelain"], cwd);
    return result.stdout.trim().length > 0;
  }

  async #readState(): Promise<WorkerState | undefined> {
    try {
      const text = await readFile(resolve(this.getWorkerRoot(), "worker-state.json"), "utf8");
      return JSON.parse(text) as WorkerState;
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

  async #writeState(workspace: PreparedWorkspace, status: WorkerState["status"], issue?: AgentIssue) {
    const state: WorkerState = {
      activeIssue: issue ? { identifier: issue.identifier, title: issue.title } : undefined,
      branchName: workspace.branchName,
      checkoutPath: workspace.path,
      originPath: workspace.originPath,
      pid: process.pid,
      sourceRepoPath: workspace.sourceRepoPath,
      status,
      updatedAt: new Date().toISOString(),
      workerId: workspace.workerId,
    };
    await mkdir(this.getWorkerRoot(), { recursive: true });
    await writeFile(resolve(this.getWorkerRoot(), "worker-state.json"), JSON.stringify(state, null, 2));
  }
}

export { CheckoutManager as WorkspaceManager };
