import { expect, test } from "bun:test";
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

    expect(await readIssueRuntimeState(runtimeRoot, "OPE-43")).toMatchObject({
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

test("WorkspaceManager preserves dirty work on the same issue and blocks switching issues", async () => {
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

    const resumed = await manager.prepare(issue("OPE-43"));
    expect(resumed.createdNow).toBe(false);
    expect(await readFile(join(resumed.path, "notes.txt"), "utf8")).toBe("keep working\n");

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
    expect(await readIssueRuntimeState(runtimeRoot, "OPE-43")).toMatchObject({
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

    await writeFile(join(workspace.path, "README.md"), "merged\n");
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
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager lands task work onto the latest parent feature branch", async () => {
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
      parentIssueId: "feature-1",
      parentIssueIdentifier: "OPE-12",
      streamIssueId: "stream-1",
      streamIssueIdentifier: "OPE-1",
    });
    const workspace = await manager.prepare(childIssue);

    expect(workspace.branchName).toBe("io/ope-12");
    expect(workspace.baseBranchName).toBe("io/ope-1");
    expect(await run(["git", "branch", "--list", "io/ope-1"], repoRoot)).toContain("io/ope-1");
    expect(await run(["git", "merge-base", "io/ope-1", "io/ope-12"], repoRoot)).toBe(
      await run(["git", "rev-parse", "io/ope-1"], repoRoot),
    );

    await run(["git", "checkout", "io/ope-12"], repoRoot);
    await writeFile(resolve(repoRoot, "feature.txt"), "feature branch advance\n");
    const featureCommitSha = await commitAll(repoRoot, "advance feature branch");
    await run(["git", "checkout", "main"], repoRoot);

    await writeFile(join(workspace.path, "task.txt"), "task change\n");
    const completion = await manager.complete(workspace, childIssue);

    expect(await run(["git", "show", "io/ope-12:feature.txt"], repoRoot)).toBe(
      "feature branch advance",
    );
    expect(await run(["git", "show", "io/ope-12:task.txt"], repoRoot)).toBe("task change");
    expect(await run(["git", "rev-parse", `${completion.commitSha}^`], repoRoot)).toBe(
      featureCommitSha,
    );
    expect(await run(["git", "rev-parse", "HEAD"], workspace.path)).toBe(completion.commitSha);
    expect(await readIssueRuntimeState(runtimeRoot, "OPE-13")).toMatchObject({
      branchName: "io/ope-12",
      commitSha: completion.commitSha,
      landedCommitSha: completion.commitSha,
      issueIdentifier: "OPE-13",
      status: "completed",
      streamIssueIdentifier: "OPE-1",
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager preserves task worktree state when landing rebase conflicts", async () => {
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
      parentIssueId: "feature-1",
      parentIssueIdentifier: "OPE-12",
      streamIssueId: "stream-1",
      streamIssueIdentifier: "OPE-1",
    });
    const workspace = await manager.prepare(childIssue);

    await writeFile(join(workspace.path, "README.md"), "task side\n");
    await run(["git", "checkout", "io/ope-12"], repoRoot);
    await writeFile(resolve(repoRoot, "README.md"), "feature side\n");
    const featureCommitSha = await commitAll(repoRoot, "advance feature branch");
    await run(["git", "checkout", "main"], repoRoot);

    await expect(manager.complete(workspace, childIssue)).rejects.toThrow(
      "task_landing_rebase_failed",
    );

    expect(await run(["git", "rev-parse", "io/ope-12"], repoRoot)).toBe(featureCommitSha);
    expect(await run(["git", "status", "--short"], workspace.path)).toContain("UU README.md");
    expect(existsSync(workspace.path)).toBe(true);
    expect(await readIssueRuntimeState(runtimeRoot, "OPE-13")).toMatchObject({
      issueIdentifier: "OPE-13",
      status: "running",
      worktreePath: workspace.path,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkspaceManager squashes a done feature branch onto its stream branch and cleans up", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-workspace-"));
  const runtimeRoot = resolve(root, "runtime");
  const featureStatePath = resolve(runtimeRoot, "stream", "ope-167.json");
  try {
    const { repoRoot } = await createSourceRepo(root);
    const manager = new WorkspaceManager({
      hooks,
      repoRoot,
      rootDir: runtimeRoot,
      workerId: "worker-1",
    });
    const task = issue("OPE-171", "Land task work", {
      hasParent: true,
      id: "task-171",
      parentIssueId: "feature-167",
      parentIssueIdentifier: "OPE-167",
      streamIssueId: "stream-121",
      streamIssueIdentifier: "OPE-121",
    });
    const workspace = await manager.prepare(task);

    await writeFile(join(workspace.path, "feature.txt"), "feature change\n");
    await manager.complete(workspace, task);
    await manager.reconcileTerminalIssues(
      {
        fetchIssueStatesByIds: async (issueIds) =>
          new Map(issueIds.map((issueId) => [issueId, "Done"] as const)),
        fetchIssuesByIds: async () =>
          new Map([
            [
              "feature-167",
              issue("OPE-167", "Tighten feature finalization", {
                hasChildren: true,
                hasParent: true,
                id: "feature-167",
                parentIssueId: "stream-121",
                parentIssueIdentifier: "OPE-121",
                state: "Done",
                streamIssueId: "stream-121",
                streamIssueIdentifier: "OPE-121",
              }),
            ],
          ]),
      },
      ["Done"],
    );

    const streamHead = await run(["git", "rev-parse", "io/ope-121"], repoRoot);
    expect(await run(["git", "show", "io/ope-121:feature.txt"], repoRoot)).toBe("feature change");
    expect(await run(["git", "branch", "--list", "io/ope-167"], repoRoot)).toBe("");
    expect(await readIssueRuntimeState(runtimeRoot, "OPE-171")).toMatchObject({
      finalizedLinearState: "Done",
      issueIdentifier: "OPE-171",
      status: "finalized",
    });
    expect(JSON.parse(await readFile(featureStatePath, "utf8"))).toMatchObject({
      branchName: "io/ope-167",
      latestLandedCommitSha: streamHead,
      parentIssueIdentifier: "OPE-167",
      status: "completed",
      streamIssueIdentifier: "OPE-121",
    });
    expect(await run(["git", "log", "--format=%s%n%b", "-1", "io/ope-121"], repoRoot)).toContain(
      "OPE-167 Tighten feature finalization",
    );
    expect(await run(["git", "log", "--format=%s%n%b", "-1", "io/ope-121"], repoRoot)).toContain(
      "- OPE-171 Land task work",
    );
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
