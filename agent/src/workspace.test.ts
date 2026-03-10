import { expect, mock, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { AgentIssue, HookConfig } from "./types.js";

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

async function writeWorkerState(
  rootDir: string,
  workerId: string,
  state: Record<string, unknown>,
) {
  await mkdir(resolve(rootDir, "workers", workerId), { recursive: true });
  await writeFile(
    resolve(rootDir, "workers", workerId, "worker-state.json"),
    JSON.stringify(state, null, 2),
  );
}

function issue(
  identifier: string,
  title = "Example",
  overrides: Partial<AgentIssue> = {},
): AgentIssue {
  return {
    blockedBy: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    description: "",
    hasChildren: false,
    hasParent: false,
    id: identifier,
    identifier,
    labels: [],
    priority: 1,
    projectSlug: "io",
    state: "Todo",
    title,
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("WorkspaceManager prepares a detached issue worktree with flat runtime state", async () => {
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

    expect(workspace.branchName).toBe("io/ope-43");
    expect(workspace.controlPath).toBe(repoRoot);
    expect(workspace.workerId).toBe("worker-1");
    expect(workspace.path).toBe(resolve(runtimeRoot, "tree", "ope-43"));
    expect(workspace.runtimePath).toBe(resolve(runtimeRoot, "issue", "ope-43"));
    expect(await run(["git", "rev-parse", "--abbrev-ref", "HEAD"], workspace.path)).toBe("HEAD");
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
      branchName: "io/ope-43",
      issueIdentifier: "OPE-43",
      status: "running",
      streamIssueIdentifier: "OPE-43",
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

test("WorkspaceManager lands detached issue commits onto the local stream branch", async () => {
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
    expect(await run(["git", "branch", "--list", "io/ope-43"], repoRoot)).toContain("io/ope-43");
    expect(await run(["git", "rev-parse", "io/ope-43"], repoRoot)).toBe(completion.commitSha);
    expect(await run(["git", "--git-dir", remoteRoot, "branch", "--list", "io/ope-43"], root)).toBe(
      "",
    );

    const workerState = JSON.parse(
      await readFile(resolve(runtimeRoot, "workers", "worker-1", "worker-state.json"), "utf8"),
    ) as { activeIssue?: { identifier: string }; status: string };
    expect(workerState.status).toBe("idle");
    expect(workerState.activeIssue).toBeUndefined();

    const issueState = await readIssueRuntimeState(runtimeRoot, "OPE-43");
    expect(issueState).toMatchObject({
      branchName: "io/ope-43",
      commitSha: completion.commitSha,
      landedCommitSha: completion.commitSha,
      status: "completed",
    });
    expect(Array.from(await manager.listOccupiedStreams())).toEqual([]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager merges a done standalone stream into main and cleans up", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-workspace-"));
  const runtimeRoot = resolve(root, "runtime");
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const writeSpy = mock((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  });
  try {
    process.stdout.write = writeSpy as typeof process.stdout.write;
    const { repoRoot } = await createSourceRepo(root);
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
    expect(await run(["git", "branch", "--list", "io/ope-43"], repoRoot)).toBe("");
    expect(existsSync(workspace.path)).toBe(false);
    expect(await readIssueRuntimeState(runtimeRoot, "OPE-43")).toMatchObject({
      finalizedLinearState: "Done",
      issueIdentifier: "OPE-43",
      status: "finalized",
    });
    expect(writes.some((entry) => entry.includes("merging io/ope-43 into local main"))).toBe(true);
  } finally {
    process.stdout.write = originalWrite;
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager skips already finalized terminal issues", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-workspace-"));
  const runtimeRoot = resolve(root, "runtime");
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const writeSpy = mock((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  });
  try {
    process.stdout.write = writeSpy as typeof process.stdout.write;
    const { repoRoot } = await createSourceRepo(root);
    const manager = new WorkspaceManager({
      hooks,
      repoRoot,
      rootDir: runtimeRoot,
      workerId: "worker-1",
    });
    const activeIssue = issue("OPE-43", "Add Worker Checkout");
    const workspace = await manager.prepare(activeIssue);

    await writeFile(join(workspace.path, "README.md"), "merged\n");
    await manager.complete(workspace, activeIssue);

    await manager.reconcileTerminalIssues(
      {
        fetchIssueStatesByIds: async () => new Map([[activeIssue.id, "Done"]]),
      },
      ["Done"],
    );

    writes.length = 0;

    await manager.reconcileTerminalIssues(
      {
        fetchIssueStatesByIds: async () => new Map([[activeIssue.id, "Done"]]),
      },
      ["Done"],
    );

    expect(writes).toEqual([]);
    expect(await readIssueRuntimeState(runtimeRoot, "OPE-43")).toMatchObject({
      finalizedLinearState: "Done",
      issueIdentifier: "OPE-43",
      status: "finalized",
    });
  } finally {
    process.stdout.write = originalWrite;
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager uses the parent stream branch for child issues", async () => {
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
    const childIssue = issue("OPE-13", "Implement child", {
      hasParent: true,
      id: "child-1",
      parentIssueId: "parent-1",
      parentIssueIdentifier: "OPE-12",
    });
    const workspace = await manager.prepare(childIssue);

    expect(workspace.branchName).toBe("io/ope-12");
    expect(workspace.path).toBe(resolve(runtimeRoot, "tree", "ope-13"));

    await writeFile(join(workspace.path, "child.txt"), "child change\n");
    const completion = await manager.complete(workspace, childIssue);
    const issueState = await readIssueRuntimeState(runtimeRoot, "OPE-13");

    expect(completion.commitSha).toHaveLength(40);
    expect(issueState).toMatchObject({
      branchName: "io/ope-12",
      issueIdentifier: "OPE-13",
      landedCommitSha: completion.commitSha,
      parentIssueIdentifier: "OPE-12",
      status: "completed",
      streamIssueIdentifier: "OPE-12",
    });
    expect(Array.from(await manager.listOccupiedStreams())).toEqual([["ope-12", "OPE-13"]]);

    await manager.reconcileTerminalIssues(
      {
        fetchIssueStatesByIds: async () => new Map([[childIssue.id, "Done"]]),
      },
      ["Done"],
    );

    expect(existsSync(workspace.path)).toBe(false);
    expect(await run(["git", "branch", "--list", "io/ope-12"], repoRoot)).toContain("io/ope-12");
    expect(await readIssueRuntimeState(runtimeRoot, "OPE-13")).toMatchObject({
      finalizedLinearState: "Done",
      issueIdentifier: "OPE-13",
      status: "finalized",
    });
    await expect(readFile(resolve(repoRoot, "child.txt"), "utf8")).rejects.toThrow();
    expect(Array.from(await manager.listOccupiedStreams())).toEqual([]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager keeps interrupted issues resumable on their own stream", async () => {
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

    await writeFile(join(workspace.path, "notes.txt"), "resume me\n");
    await manager.markInterrupted(workspace, activeIssue);

    expect(await readIssueRuntimeState(runtimeRoot, "OPE-43")).toMatchObject({
      issueIdentifier: "OPE-43",
      status: "interrupted",
      worktreePath: workspace.path,
    });
    expect(Array.from(await manager.listOccupiedStreams())).toEqual([["ope-43", "OPE-43"]]);

    const resumed = await manager.prepare(activeIssue);
    expect(resumed.createdNow).toBe(false);
    expect(await readFile(join(resumed.path, "notes.txt"), "utf8")).toBe("resume me\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager preserves standalone stream state when merging to main conflicts", async () => {
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
    expect(await run(["git", "branch", "--list", "io/ope-43"], repoRoot)).toContain("io/ope-43");
    expect(await run(["git", "status", "--short"], workspace.path)).toBe("");
    expect(await readIssueRuntimeState(runtimeRoot, "OPE-43")).toMatchObject({
      issueIdentifier: "OPE-43",
      status: "completed",
      worktreePath: workspace.path,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager preserves standalone terminal issues until the stream lands on main", async () => {
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

    await writeFile(join(workspace.path, "README.md"), "not landed\n");
    await manager.complete(workspace, activeIssue);

    await manager.reconcileTerminalIssues(
      {
        fetchIssueStatesByIds: async () => new Map([[activeIssue.id, "Canceled"]]),
      },
      ["Done", "Canceled"],
    );

    expect(existsSync(workspace.path)).toBe(true);
    expect(await run(["git", "branch", "--list", "io/ope-43"], repoRoot)).toContain("io/ope-43");
    expect(await readIssueRuntimeState(runtimeRoot, "OPE-43")).toMatchObject({
      issueIdentifier: "OPE-43",
      status: "completed",
      worktreePath: workspace.path,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager reconciles stale running issues using landed stream refs", async () => {
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
    const commitSha = await commitAll(workspace.path, "OPE-43 Add Worker Checkout");
    await run(["git", "update-ref", "refs/heads/io/ope-43", commitSha], repoRoot);
    await writeWorkerState(runtimeRoot, "worker-1", {
      activeIssue: { identifier: "OPE-43", title: "Add Worker Checkout" },
      branchName: "io/ope-43",
      checkoutPath: workspace.path,
      controlPath: repoRoot,
      issueRuntimePath: workspace.runtimePath,
      originPath: repoRoot,
      outputPath: workspace.outputPath,
      pid: 999999,
      sourceRepoPath: repoRoot,
      status: "running",
      updatedAt: new Date().toISOString(),
      workerId: "worker-1",
    });

    await manager.reconcileTerminalIssues(
      {
        fetchIssueStatesByIds: async () => new Map([[activeIssue.id, "Done"]]),
      },
      ["Done"],
    );

    expect(await readFile(resolve(repoRoot, "feature.txt"), "utf8")).toBe("issue change\n");
    expect(existsSync(workspace.path)).toBe(false);
    expect(await run(["git", "branch", "--list", "io/ope-43"], repoRoot)).toBe("");
    expect(await readIssueRuntimeState(runtimeRoot, "OPE-43")).toMatchObject({
      finalizedLinearState: "Done",
      issueIdentifier: "OPE-43",
      status: "finalized",
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager clears ghost occupied streams when the active issue runtime is gone", async () => {
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

    await rm(workspace.runtimePath!, { force: true, recursive: true });

    expect(Array.from(await manager.listOccupiedStreams())).toEqual([]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
