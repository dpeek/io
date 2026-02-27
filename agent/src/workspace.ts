import { createLogger, type Logger } from "@io/lib";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import type { AgentIssue, HookConfig, PreparedWorkspace } from "./types.js";

import { toId } from "./util.js";
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
  repoRoot?: string;
  rootDir: string;
  runCommand?: CommandRunner;
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

export class WorkspaceManager {
  readonly #hooks: HookConfig;
  readonly #log: Logger;
  readonly #repoRoot?: string;
  readonly #rootDir: string;
  readonly #runCommand: CommandRunner;

  constructor(options: WorkspaceManagerOptions) {
    this.#hooks = options.hooks;
    this.#log = (options.log ?? createLogger({ pkg: "agent" })).child({
      event_prefix: "workspace",
    });
    this.#repoRoot = options.repoRoot;
    this.#rootDir = options.rootDir;
    this.#runCommand = options.runCommand ?? defaultRunCommand;
  }

  async prepare(issue: AgentIssue): Promise<PreparedWorkspace> {
    await mkdir(this.#rootDir, { recursive: true });
    const workspaceKey = toWorkspaceKey(issue.identifier);
    const path = resolve(this.#rootDir, workspaceKey);
    const branchName = this.getBranchName(issue);
    const createdNow = !existsSync(path);
    if (createdNow) {
      if (this.#repoRoot && existsSync(resolve(this.#repoRoot, ".git"))) {
        const result = await this.#runCommand(
          ["git", "worktree", "add", path, "-b", branchName],
          this.#repoRoot,
          this.#hooks.timeoutMs,
        );
        if (result.exitCode !== 0) {
          await rm(path, { force: true, recursive: true }).catch(() => undefined);
          throw new Error(result.stderr.trim() || `Failed to create git worktree ${branchName}`);
        }
      } else {
        await mkdir(path, { recursive: true });
      }
      await this.runHook("afterCreate", this.#hooks.afterCreate, path, true);
    }
    return { branchName, createdNow, path, workspaceKey };
  }

  async cleanup(workspace: PreparedWorkspace) {
    await this.runHook("beforeRemove", this.#hooks.beforeRemove, workspace.path, false);
    if (this.#repoRoot && existsSync(resolve(workspace.path, ".git"))) {
      await this.#runCommand(
        ["git", "worktree", "remove", "--force", workspace.path],
        this.#repoRoot,
        this.#hooks.timeoutMs,
      );
      return;
    }
    await rm(workspace.path, { force: true, recursive: true });
  }

  getBranchName(issue: AgentIssue) {
    const issueSlug = toId(issue.title).slice(0, 48) || "issue";
    return `codex/${toId(issue.identifier)}-${issueSlug}`;
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
}
