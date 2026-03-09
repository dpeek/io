import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { HookConfig } from "./types.js";

import { readIssueRuntimeState, WorkspaceManager } from "./workspace.js";

const hooks: HookConfig = { timeoutMs: 5_000 };

async function run(command: string[], cwd: string) {
  const proc = Bun.spawn({
    cmd: command,
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || command.join(" "));
  }
  return stdout.trim();
}

async function createSourceRepo(root: string) {
  const remoteRoot = resolve(root, "remote.git");
  const repoRoot = resolve(root, "source");
  await run(["git", "init", "--bare", remoteRoot], root);
  await mkdir(repoRoot, { recursive: true });
  await run(["git", "init", "-b", "main"], repoRoot);
  await writeFile(resolve(repoRoot, "README.md"), "hello\n");
  await run(["git", "add", "README.md"], repoRoot);
  await run(
    [
      "git",
      "-c",
      "user.name=Agent Test",
      "-c",
      "user.email=agent@example.com",
      "commit",
      "-m",
      "initial",
    ],
    repoRoot,
  );
  await run(["git", "remote", "add", "origin", remoteRoot], repoRoot);
  await run(["git", "push", "-u", "origin", "main"], repoRoot);
  return { remoteRoot, repoRoot };
}

async function commitAll(cwd: string, message: string) {
  await run(["git", "add", "-A"], cwd);
  await run(
    [
      "git",
      "-c",
      "user.name=Agent Test",
      "-c",
      "user.email=agent@example.com",
      "commit",
      "-m",
      message,
    ],
    cwd,
  );
  return await run(["git", "rev-parse", "HEAD"], cwd);
}

function issue(identifier: string, title = "Example") {
  return {
    blockedBy: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    description: "",
    id: identifier,
    identifier,
    labels: [],
    priority: 1,
    state: "Todo",
    title,
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

test("WorkspaceManager prepares a dedicated issue worktree with external runtime state", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-workspace-"));
  const runtimeRoot = resolve(root, "runtime");
  try {
    const { repoRoot } = await createSourceRepo(root);
    const manager = new WorkspaceManager({
      hooks,
      repoRoot,
      rootDir: runtimeRoot,
      workerId: "worker-1",
    });
    const workspace = await manager.prepare(issue("OPE-43", "Add Worker Checkout"));

    expect(workspace.branchName).toBe("ope-43");
    expect(workspace.controlPath).toBe(repoRoot);
    expect(workspace.workerId).toBe("worker-1");
    expect(workspace.path).toBe(resolve(runtimeRoot, "worktrees", "ope-43"));
    expect(workspace.runtimePath).toBe(resolve(runtimeRoot, "issues", "ope-43"));
    expect(await run(["git", "branch", "--show-current"], workspace.path)).toBe("ope-43");
    expect(await run(["git", "worktree", "list", "--porcelain"], repoRoot)).toContain(
      workspace.path,
    );

    const state = JSON.parse(
      await readFile(resolve(runtimeRoot, "workers", "worker-1", "worker-state.json"), "utf8"),
    ) as { activeIssue?: { identifier: string }; checkoutPath: string; status: string };
    expect(state.status).toBe("running");
    expect(state.activeIssue?.identifier).toBe("OPE-43");
    expect(state.checkoutPath).toBe(workspace.path);

    const issueState = await readIssueRuntimeState(runtimeRoot, "OPE-43");
    expect(issueState).toMatchObject({
      branchName: "ope-43",
      issueIdentifier: "OPE-43",
      status: "running",
      worktreePath: workspace.path,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager preserves a dirty worktree for the same issue", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-workspace-"));
  try {
    const { repoRoot } = await createSourceRepo(root);
    const manager = new WorkspaceManager({
      hooks,
      repoRoot,
      rootDir: resolve(root, "runtime"),
      workerId: "worker-1",
    });
    const first = await manager.prepare(issue("OPE-43"));
    await writeFile(join(first.path, "notes.txt"), "keep working\n");

    const second = await manager.prepare(issue("OPE-43"));
    expect(second.createdNow).toBe(false);
    expect(await readFile(join(second.path, "notes.txt"), "utf8")).toBe("keep working\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager blocks switching issues when a worktree is dirty", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-workspace-"));
  try {
    const { repoRoot } = await createSourceRepo(root);
    const manager = new WorkspaceManager({
      hooks,
      repoRoot,
      rootDir: resolve(root, "runtime"),
      workerId: "worker-1",
    });
    const workspace = await manager.prepare(issue("OPE-43"));
    await writeFile(join(workspace.path, "notes.txt"), "keep working\n");

    await expect(manager.prepare(issue("OPE-44"))).rejects.toThrow("worker_checkout_dirty");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager can commit an issue branch from its worktree without pushing", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-workspace-"));
  const runtimeRoot = resolve(root, "runtime");
  try {
    const { remoteRoot, repoRoot } = await createSourceRepo(root);
    const manager = new WorkspaceManager({
      hooks,
      repoRoot,
      rootDir: runtimeRoot,
      workerId: "worker-1",
    });
    const activeIssue = issue("OPE-43", "Add Worker Checkout");
    const workspace = await manager.prepare(activeIssue);

    await writeFile(join(workspace.path, "README.md"), "updated\n");
    const completion = await manager.complete(workspace, activeIssue);

    expect(completion.commitSha).toHaveLength(40);
    expect(await run(["git", "branch", "--list", "ope-43"], repoRoot)).toContain("ope-43");
    expect(await run(["git", "--git-dir", remoteRoot, "branch", "--list", "ope-43"], root)).toBe("");

    const workerState = JSON.parse(
      await readFile(resolve(runtimeRoot, "workers", "worker-1", "worker-state.json"), "utf8"),
    ) as { activeIssue?: { identifier: string }; status: string };
    expect(workerState.status).toBe("idle");
    expect(workerState.activeIssue).toBeUndefined();

    const issueState = await readIssueRuntimeState(runtimeRoot, "OPE-43");
    expect(issueState?.status).toBe("completed");
    expect(issueState?.commitSha).toBe(completion.commitSha);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager merges done branches into main and cleans up worktree artifacts", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-workspace-"));
  const runtimeRoot = resolve(root, "runtime");
  try {
    const { remoteRoot, repoRoot } = await createSourceRepo(root);
    const manager = new WorkspaceManager({
      hooks,
      repoRoot,
      rootDir: runtimeRoot,
      workerId: "worker-1",
    });
    const activeIssue = issue("OPE-43", "Add Worker Checkout");
    const workspace = await manager.prepare(activeIssue);

    await writeFile(join(workspace.path, "README.md"), "merged\n");
    await writeFile(workspace.outputPath!, "tail me\n");
    await manager.complete(workspace, activeIssue);

    await manager.reconcileTerminalIssues(
      {
        fetchIssueStatesByIds: async () => new Map([[activeIssue.id, "Done"]]),
      },
      ["Done"],
    );

    expect(await readFile(resolve(repoRoot, "README.md"), "utf8")).toBe("merged\n");
    expect(await run(["git", "branch", "--show-current"], repoRoot)).toBe("main");
    expect(await run(["git", "log", "--format=%s", "-1", "main"], repoRoot)).toBe(
      "OPE-43 Add Worker Checkout",
    );
    expect(await run(["git", "branch", "--list", "ope-43"], repoRoot)).toBe("");
    expect(await run(["git", "--git-dir", remoteRoot, "branch", "--list", "ope-43"], root)).toBe(
      "",
    );
    expect(existsSync(workspace.path)).toBe(false);
    expect(existsSync(resolve(runtimeRoot, "issues", "ope-43"))).toBe(false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager recreates a missing worktree before merging a done branch", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-workspace-"));
  const runtimeRoot = resolve(root, "runtime");
  try {
    const { repoRoot } = await createSourceRepo(root);
    const manager = new WorkspaceManager({
      hooks,
      repoRoot,
      rootDir: runtimeRoot,
      workerId: "worker-1",
    });
    const activeIssue = issue("OPE-43", "Add Worker Checkout");
    const workspace = await manager.prepare(activeIssue);

    await writeFile(join(workspace.path, "README.md"), "merged after recreate\n");
    await manager.complete(workspace, activeIssue);
    await rm(workspace.path, { force: true, recursive: true });

    await manager.reconcileTerminalIssues(
      {
        fetchIssueStatesByIds: async () => new Map([[activeIssue.id, "Done"]]),
      },
      ["Done"],
    );

    expect(await readFile(resolve(repoRoot, "README.md"), "utf8")).toBe("merged after recreate\n");
    expect(existsSync(workspace.path)).toBe(false);
    expect(await run(["git", "branch", "--list", "ope-43"], repoRoot)).toBe("");
    expect(await readIssueRuntimeState(runtimeRoot, "OPE-43")).toBeUndefined();
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager cleans up a done issue when its commit is already on main", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-workspace-"));
  const runtimeRoot = resolve(root, "runtime");
  try {
    const { remoteRoot, repoRoot } = await createSourceRepo(root);
    const manager = new WorkspaceManager({
      hooks,
      repoRoot,
      rootDir: runtimeRoot,
      workerId: "worker-1",
    });
    const activeIssue = issue("OPE-43", "Add Worker Checkout");
    const workspace = await manager.prepare(activeIssue);

    await writeFile(join(workspace.path, "README.md"), "already merged\n");
    await manager.complete(workspace, activeIssue);
    await run(["git", "checkout", "main"], repoRoot);
    await run(["git", "merge", "--no-edit", "ope-43"], repoRoot);
    await run(["git", "push", "origin", "main"], repoRoot);
    await run(["git", "worktree", "remove", "--force", workspace.path], repoRoot);
    await run(["git", "branch", "-D", "ope-43"], repoRoot);

    await manager.reconcileTerminalIssues(
      {
        fetchIssueStatesByIds: async () => new Map([[activeIssue.id, "Done"]]),
      },
      ["Done"],
    );

    expect(await readFile(resolve(repoRoot, "README.md"), "utf8")).toBe("already merged\n");
    expect(await run(["git", "--git-dir", remoteRoot, "branch", "--list", "ope-43"], root)).toBe("");
    expect(await readIssueRuntimeState(runtimeRoot, "OPE-43")).toBeUndefined();
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager continues reconciling when one done issue can no longer be merged", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-workspace-"));
  const runtimeRoot = resolve(root, "runtime");
  try {
    const { repoRoot } = await createSourceRepo(root);
    const manager = new WorkspaceManager({
      hooks,
      repoRoot,
      rootDir: runtimeRoot,
      workerId: "worker-1",
    });

    const staleIssue = issue("OPE-43", "Stale Branch");
    const staleWorkspace = await manager.prepare(staleIssue);
    await writeFile(join(staleWorkspace.path, "stale.txt"), "stale\n");
    await manager.complete(staleWorkspace, staleIssue);
    await run(["git", "worktree", "remove", "--force", staleWorkspace.path], repoRoot);
    await run(["git", "branch", "-D", "ope-43"], repoRoot);

    const activeIssue = issue("OPE-44", "Healthy Branch");
    const activeWorkspace = await manager.prepare(activeIssue);
    await writeFile(join(activeWorkspace.path, "healthy.txt"), "healthy\n");
    await manager.complete(activeWorkspace, activeIssue);

    await expect(
      manager.reconcileTerminalIssues(
        {
          fetchIssueStatesByIds: async () =>
            new Map([
              [staleIssue.id, "Done"],
              [activeIssue.id, "Done"],
            ]),
        },
        ["Done"],
      ),
    ).resolves.toBeUndefined();

    expect(await readIssueRuntimeState(runtimeRoot, "OPE-43")).toMatchObject({
      issueIdentifier: "OPE-43",
      status: "completed",
    });
    expect(await readIssueRuntimeState(runtimeRoot, "OPE-44")).toBeUndefined();
    expect(await readFile(resolve(repoRoot, "healthy.txt"), "utf8")).toBe("healthy\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager rebases a done branch onto the latest main before merging", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-workspace-"));
  const runtimeRoot = resolve(root, "runtime");
  try {
    const { repoRoot } = await createSourceRepo(root);
    const manager = new WorkspaceManager({
      hooks,
      repoRoot,
      rootDir: runtimeRoot,
      workerId: "worker-1",
    });
    const activeIssue = issue("OPE-43", "Add Worker Checkout");
    const workspace = await manager.prepare(activeIssue);

    await writeFile(join(workspace.path, "feature.txt"), "issue change\n");
    await manager.complete(workspace, activeIssue);

    await writeFile(resolve(repoRoot, "README.md"), "main advanced\n");
    const mainAdvanceSha = await commitAll(repoRoot, "advance main");
    await run(["git", "push", "origin", "main"], repoRoot);

    await manager.reconcileTerminalIssues(
      {
        fetchIssueStatesByIds: async () => new Map([[activeIssue.id, "Done"]]),
      },
      ["Done"],
    );

    expect(await readFile(resolve(repoRoot, "README.md"), "utf8")).toBe("main advanced\n");
    expect(await readFile(resolve(repoRoot, "feature.txt"), "utf8")).toBe("issue change\n");
    expect(await run(["git", "rev-parse", "main^"], repoRoot)).toBe(mainAdvanceSha);
    expect(await run(["git", "log", "--format=%s", "-2", "main"], repoRoot)).toBe(
      "OPE-43 Add Worker Checkout\nadvance main",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager preserves worktree state when rebasing a done branch conflicts", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-workspace-"));
  const runtimeRoot = resolve(root, "runtime");
  try {
    const { repoRoot } = await createSourceRepo(root);
    const manager = new WorkspaceManager({
      hooks,
      repoRoot,
      rootDir: runtimeRoot,
      workerId: "worker-1",
    });
    const activeIssue = issue("OPE-43", "Add Worker Checkout");
    const workspace = await manager.prepare(activeIssue);

    await writeFile(join(workspace.path, "README.md"), "issue side\n");
    await manager.complete(workspace, activeIssue);

    await writeFile(resolve(repoRoot, "README.md"), "main side\n");
    await commitAll(repoRoot, "advance main");
    await run(["git", "push", "origin", "main"], repoRoot);

    await expect(
      manager.reconcileTerminalIssues(
        {
          fetchIssueStatesByIds: async () => new Map([[activeIssue.id, "Done"]]),
        },
        ["Done"],
      ),
    ).resolves.toBeUndefined();

    expect(await readFile(resolve(repoRoot, "README.md"), "utf8")).toBe("main side\n");
    expect(existsSync(workspace.path)).toBe(true);
    expect(await run(["git", "status", "--short"], workspace.path)).toContain("README.md");
    expect(await run(["git", "branch", "--list", "ope-43"], repoRoot)).toContain("ope-43");
    expect(await readIssueRuntimeState(runtimeRoot, "OPE-43")).toMatchObject({
      issueIdentifier: "OPE-43",
      status: "completed",
      worktreePath: workspace.path,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
