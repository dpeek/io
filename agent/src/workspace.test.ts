import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { HookConfig } from "./types.js";

import { WorkspaceManager } from "./workspace.js";

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
  const repoRoot = resolve(root, "source");
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
  return repoRoot;
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

test("WorkspaceManager prepares a persistent worker checkout and state file", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-workspace-"));
  try {
    const repoRoot = await createSourceRepo(root);
    const manager = new WorkspaceManager({ hooks, repoRoot, rootDir: resolve(root, "runtime"), workerId: "worker-1" });
    const workspace = await manager.prepare(issue("OPE-43", "Add Worker Checkout"));

    expect(workspace.branchName).toBe("ope-43");
    expect(workspace.workerId).toBe("worker-1");
    expect(await run(["git", "branch", "--show-current"], workspace.path)).toBe("ope-43");
    expect(workspace.originPath).toBe(repoRoot);
    expect(await run(["git", "remote", "get-url", "origin"], workspace.path)).toBe(repoRoot);
    await expect(run(["git", "remote", "get-url", "upstream"], workspace.path)).rejects.toThrow();

    const state = JSON.parse(
      await readFile(resolve(root, "runtime", "workers", "worker-1", "worker-state.json"), "utf8"),
    ) as { activeIssue?: { identifier: string }; status: string };
    expect(state.status).toBe("running");
    expect(state.activeIssue?.identifier).toBe("OPE-43");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager preserves a dirty checkout for the same issue", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-workspace-"));
  try {
    const repoRoot = await createSourceRepo(root);
    const manager = new WorkspaceManager({ hooks, repoRoot, rootDir: resolve(root, "runtime"), workerId: "worker-1" });
    const first = await manager.prepare(issue("OPE-43"));
    await writeFile(join(first.path, "notes.txt"), "keep working\n");

    const second = await manager.prepare(issue("OPE-43"));
    expect(second.createdNow).toBe(false);
    expect(await readFile(join(second.path, "notes.txt"), "utf8")).toBe("keep working\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager blocks switching issues when a worker checkout is dirty", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-workspace-"));
  try {
    const repoRoot = await createSourceRepo(root);
    const manager = new WorkspaceManager({ hooks, repoRoot, rootDir: resolve(root, "runtime"), workerId: "worker-1" });
    const workspace = await manager.prepare(issue("OPE-43"));
    await writeFile(join(workspace.path, "notes.txt"), "keep working\n");

    await expect(manager.prepare(issue("OPE-44"))).rejects.toThrow("worker_checkout_dirty");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager checkout can push issue branches to local origin", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-workspace-"));
  try {
    const repoRoot = await createSourceRepo(root);
    const manager = new WorkspaceManager({ hooks, repoRoot, rootDir: resolve(root, "runtime"), workerId: "worker-1" });
    const workspace = await manager.prepare(issue("OPE-43"));

    await writeFile(join(workspace.path, "README.md"), "updated\n");
    await run(["git", "add", "README.md"], workspace.path);
    await run(
      [
        "git",
        "-c",
        "user.name=Agent Test",
        "-c",
        "user.email=agent@example.com",
        "commit",
        "-m",
        "OPE-43 Add Worker Checkout",
      ],
      workspace.path,
    );
    await run(["git", "push", "-u", "origin", "HEAD"], workspace.path);

    expect(await run(["git", "branch", "--list", "ope-43"], repoRoot)).toContain("ope-43");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager session start checks out main and fast-forwards from origin", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-workspace-"));
  try {
    const repoRoot = await createSourceRepo(root);
    const manager = new WorkspaceManager({ hooks, repoRoot, rootDir: resolve(root, "runtime"), workerId: "worker-1" });
    const workspace = await manager.prepare(issue("OPE-43"));

    await run(["git", "checkout", "main"], workspace.path);
    await writeFile(resolve(repoRoot, "README.md"), "hello from origin\n");
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
        "update main",
      ],
      repoRoot,
    );

    await manager.ensureSessionStartState();

    expect(await run(["git", "branch", "--show-current"], workspace.path)).toBe("main");
    expect(await readFile(resolve(workspace.path, "README.md"), "utf8")).toBe("hello from origin\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager session start aborts if checkout is dirty", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-workspace-"));
  try {
    const repoRoot = await createSourceRepo(root);
    const manager = new WorkspaceManager({ hooks, repoRoot, rootDir: resolve(root, "runtime"), workerId: "worker-1" });
    const workspace = await manager.prepare(issue("OPE-43"));

    await writeFile(join(workspace.path, "notes.txt"), "local change\n");

    await expect(manager.ensureSessionStartState()).rejects.toThrow("worker_checkout_dirty_on_start");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
