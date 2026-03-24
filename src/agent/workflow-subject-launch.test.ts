import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { CodexSessionLaunchRequest } from "../tui/index.js";
import type { AgentIssue, HookConfig, IssueRunResult, PreparedWorkspace } from "./types.js";
import { WorkflowSubjectLaunchCoordinator } from "./workflow-subject-launch.js";
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
  return { repoRoot };
}

function issue(overrides: Partial<AgentIssue> = {}): AgentIssue {
  return {
    blockedBy: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    description: "",
    hasChildren: false,
    hasParent: false,
    id: "issue-1",
    identifier: "OPE-470",
    labels: [],
    priority: 1,
    projectSlug: "io",
    state: "Todo",
    title: "Build shared launch coordinator",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function request(): CodexSessionLaunchRequest {
  return {
    actorId: "principal:operator",
    kind: "execution",
    projectId: "project:io",
    subject: {
      branchId: "branch:workflow-runtime-contract",
      commitId: "commit:shared-launch",
      kind: "commit",
    },
  };
}

test("WorkflowSubjectLaunchCoordinator prepares workspace and persists launched session metadata", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-subject-launch-"));
  try {
    const { repoRoot } = await createSourceRepo(root);
    const workspaceManager = new WorkspaceManager({
      hooks,
      repoRoot,
      rootDir: resolve(root, "runtime"),
      workerId: "worker-1",
    });
    const launches: Array<{ issue: AgentIssue; prompt: string; workspace: PreparedWorkspace }> = [];
    const coordinator = new WorkflowSubjectLaunchCoordinator({
      runner: {
        launch: async (options) => {
          launches.push(options);
          return {
            completion: Promise.resolve({
              issue: options.issue,
              prompt: options.prompt,
              stderr: [],
              stdout: [],
              success: true,
              workspace: options.workspace,
            } satisfies IssueRunResult),
            session: options.session!,
            threadId: "thread-1",
            turnId: "turn-1",
          };
        },
      },
      workspaceManager,
    });

    const launched = await coordinator.launch(request(), {
      issue: issue(),
      managedBranchName: "workflow/runtime-contract",
      prompt: "Launch prompt",
      repositoryId: "repo:io",
      repositoryRoot: repoRoot,
    });

    expect(launches).toHaveLength(1);
    expect(launches[0]?.workspace.path).toBe(resolve(root, "runtime", "tree", "ope-470"));
    expect(launched.launch).toMatchObject({
      launch: {
        attach: {
          sessionId: "worker:worker-1:1",
        },
        disposition: "launched",
        managedBranchName: "workflow/runtime-contract",
        repositoryId: "repo:io",
        repositoryRoot: repoRoot,
        worktreePath: resolve(root, "runtime", "tree", "ope-470"),
      },
    });

    const runtimeState = await workspaceManager.readIssueState("OPE-470");
    expect(runtimeState).toMatchObject({
      sessionId: "worker:worker-1:1",
      status: "running",
      threadId: "thread-1",
      turnId: "turn-1",
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("WorkflowSubjectLaunchCoordinator attaches to a running workflow subject without relaunching", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-subject-launch-"));
  try {
    const { repoRoot } = await createSourceRepo(root);
    const workspaceManager = new WorkspaceManager({
      hooks,
      repoRoot,
      rootDir: resolve(root, "runtime"),
      workerId: "worker-1",
    });
    let launchCount = 0;
    const coordinator = new WorkflowSubjectLaunchCoordinator({
      runner: {
        launch: async (options) => {
          launchCount += 1;
          return {
            completion: new Promise<IssueRunResult>(() => undefined),
            session: options.session!,
            threadId: "thread-1",
            turnId: "turn-1",
          };
        },
      },
      workspaceManager,
    });

    await coordinator.launch(request(), {
      issue: issue(),
      managedBranchName: "workflow/runtime-contract",
      prompt: "Launch prompt",
      repositoryId: "repo:io",
      repositoryRoot: repoRoot,
    });
    const attached = await coordinator.launch(request(), {
      issue: issue(),
      managedBranchName: "workflow/runtime-contract",
      prompt: "Launch prompt",
      repositoryId: "repo:io",
      repositoryRoot: repoRoot,
    });

    expect(launchCount).toBe(1);
    expect(attached.completion).toBeUndefined();
    expect(attached.launch).toMatchObject({
      launch: {
        attach: {
          sessionId: "worker:worker-1:1",
        },
        disposition: "attached",
        worktreePath: resolve(root, "runtime", "tree", "ope-470"),
      },
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
