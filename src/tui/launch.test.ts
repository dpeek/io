import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { bootstrap, createStore, createTypeClient } from "@io/core/graph";

import type { Workflow } from "../agent/types.js";
import type { IssueRunResult, PreparedWorkspace } from "../agent/types.js";
import { WorkflowSubjectLaunchCoordinator } from "../agent/workflow-subject-launch.js";
import { WorkspaceManager } from "../agent/workspace.js";
import { core } from "../graph/modules/core.js";
import { ops } from "../graph/modules/ops.js";
import {
  createWorkflowProjectionIndex,
  WorkflowProjectionQueryError,
} from "../graph/modules/ops/workflow/query.js";
import { createWorkflowTuiLaunchActionExecutor } from "./launch.js";
import { createWorkflowTuiWorkflowModelFromProjection } from "./model.js";
import type { WorkflowTuiActionModel } from "./model.js";

const productGraph = { ...core, ...ops } as const;

function date(value: string): Date {
  return new Date(value);
}

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

function createWorkflow(workspaceRoot: string): Workflow {
  return {
    agent: {
      maxConcurrentAgents: 1,
      maxRetryBackoffMs: 1,
      maxTurns: 1,
    },
    codex: {
      approvalPolicy: "never",
      command: "codex",
      readTimeoutMs: 1,
      stallTimeoutMs: 1,
      threadSandbox: "workspace-write",
      turnTimeoutMs: 1,
    },
    context: {
      docs: {},
      overrides: {},
      profiles: {},
    },
    entrypoint: {
      configPath: "/workspace/io.ts",
      kind: "io",
      promptPath: "/workspace/io.md",
    },
    entrypointContent: "Workflow branch launch\n\n{{ issue.title }}\n{{ issue.description }}",
    hooks: {
      timeoutMs: 5_000,
    },
    issues: {
      defaultAgent: "execute",
      defaultProfile: "execute",
      routing: [
        {
          agent: "backlog",
          if: {
            labelsAny: ["planning"],
          },
          profile: "backlog",
        },
      ],
    },
    modules: {},
    polling: {
      intervalMs: 1,
    },
    tracker: {
      activeStates: ["Todo"],
      endpoint: "https://linear.example",
      kind: "linear",
      terminalStates: ["Done"],
    },
    tui: {
      graph: {
        kind: "http",
      },
      initialScope: {},
    },
    workspace: {
      root: workspaceRoot,
    },
  };
}

function createRuntimeFixture(repoRoot: string) {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, ops);
  const graph = createTypeClient(store, productGraph);

  const projectId = graph.workflowProject.create({
    name: "IO",
    projectKey: "project:io",
    createdAt: date("2026-01-01T00:00:00.000Z"),
    updatedAt: date("2026-01-01T00:00:00.000Z"),
  });
  const repositoryId = graph.workflowRepository.create({
    name: "io",
    project: projectId,
    repositoryKey: "repo:io",
    repoRoot,
    defaultBaseBranch: "main",
    createdAt: date("2026-01-01T00:00:00.000Z"),
    updatedAt: date("2026-01-01T00:00:00.000Z"),
  });
  const branchId = graph.workflowBranch.create({
    name: "Workflow runtime contract",
    project: projectId,
    branchKey: "branch:workflow-runtime-contract",
    state: ops.workflowBranchState.values.active.id,
    queueRank: 1,
    goalSummary: "Define the canonical branch board and commit queue contract.",
    createdAt: date("2026-01-01T00:00:00.000Z"),
    updatedAt: date("2026-01-02T00:00:00.000Z"),
  });
  graph.repositoryBranch.create({
    name: "workflow/runtime-contract",
    project: projectId,
    repository: repositoryId,
    workflowBranch: branchId,
    managed: true,
    branchName: "workflow/runtime-contract",
    baseBranchName: "main",
    latestReconciledAt: date("2026-01-02T00:00:00.000Z"),
    createdAt: date("2026-01-01T00:00:00.000Z"),
    updatedAt: date("2026-01-02T00:00:00.000Z"),
  });
  const commitId = graph.workflowCommit.create({
    name: "Document commit queue scope",
    branch: branchId,
    commitKey: "commit:document-commit-queue-scope",
    state: ops.workflowCommitState.values.active.id,
    order: 1,
    createdAt: date("2026-01-01T00:00:00.000Z"),
    updatedAt: date("2026-01-02T00:00:00.000Z"),
  });

  const projection = createWorkflowProjectionIndex(graph);
  return {
    action: {
      availability: "available",
      description: "Start a branch-scoped planning session from the selected workflow branch.",
      id: "branch-session",
      label: "Launch branch session",
      subject: {
        branchId,
        kind: "branch",
      },
    } satisfies WorkflowTuiActionModel,
    commitAction: {
      availability: "available",
      description: "Start a commit-scoped execution session from the selected workflow commit.",
      id: "commit-session",
      label: "Launch commit session",
      subject: {
        branchId,
        commitId,
        kind: "commit",
      },
    } satisfies WorkflowTuiActionModel,
    runtime: {
      projectId,
      projection,
      runtimeClient: {
        graph,
      },
      surfaceModel: createWorkflowTuiWorkflowModelFromProjection({
        projection,
        projectId,
      }),
    },
  };
}

test("createWorkflowTuiLaunchActionExecutor launches a branch-scoped planning session", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-tui-launch-"));
  try {
    const runtimeRoot = resolve(root, "runtime");
    const { repoRoot } = await createSourceRepo(root);
    const workflow = createWorkflow(runtimeRoot);
    const { action, runtime } = createRuntimeFixture(repoRoot);
    const launches: Array<{ prompt: string; workspace: PreparedWorkspace }> = [];
    const executor = createWorkflowTuiLaunchActionExecutor({
      createCoordinator: (issueIdentifier) =>
        new WorkflowSubjectLaunchCoordinator({
          runner: {
            launch: async (options) => {
              launches.push({
                prompt: options.prompt,
                workspace: options.workspace,
              });
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
          workspaceManager: new WorkspaceManager({
            hooks: workflow.hooks,
            repoRoot,
            rootDir: runtimeRoot,
            workerId: issueIdentifier,
          }),
        }),
      getRuntime: () => runtime,
      repoRoot,
      workflow,
    });

    const result = await executor(action);

    expect(result).toMatchObject({
      launch: {
        attach: {
          sessionId: "worker:branch-workflow-runtime-contract:1",
        },
        disposition: "launched",
        managedBranchName: "workflow/runtime-contract",
        repositoryId: expect.any(String),
        repositoryRoot: repoRoot,
        worktreePath: resolve(runtimeRoot, "tree", "branch-workflow-runtime-contract"),
      },
      ok: true,
      session: {
        kind: "planning",
        subject: {
          branchId: action.subject.branchId,
          kind: "branch",
        },
      },
    });
    expect(launches).toHaveLength(1);
    expect(launches[0]?.prompt).toContain("Workflow branch launch");
    expect(launches[0]?.prompt).toContain("Workflow runtime contract");
    expect(launches[0]?.prompt).toContain("branch:workflow-runtime-contract");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("createWorkflowTuiLaunchActionExecutor launches a commit-scoped execution session", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-tui-launch-"));
  try {
    const runtimeRoot = resolve(root, "runtime");
    const { repoRoot } = await createSourceRepo(root);
    const workflow = createWorkflow(runtimeRoot);
    const { commitAction, runtime } = createRuntimeFixture(repoRoot);
    const launches: Array<{ prompt: string; workspace: PreparedWorkspace }> = [];
    const executor = createWorkflowTuiLaunchActionExecutor({
      createCoordinator: (issueIdentifier) =>
        new WorkflowSubjectLaunchCoordinator({
          runner: {
            launch: async (options) => {
              launches.push({
                prompt: options.prompt,
                workspace: options.workspace,
              });
              return {
                completion: new Promise<IssueRunResult>(() => undefined),
                session: options.session!,
                threadId: "thread-1",
                turnId: "turn-1",
              };
            },
          },
          workspaceManager: new WorkspaceManager({
            hooks: workflow.hooks,
            repoRoot,
            rootDir: runtimeRoot,
            workerId: issueIdentifier,
          }),
        }),
      getRuntime: () => runtime,
      repoRoot,
      workflow,
    });

    const result = await executor(commitAction);

    expect(result).toMatchObject({
      launch: {
        attach: {
          sessionId: "worker:commit-document-commit-queue-scope:1",
        },
        disposition: "launched",
        managedBranchName: "workflow/runtime-contract",
        repositoryId: expect.any(String),
        repositoryRoot: repoRoot,
        worktreePath: resolve(runtimeRoot, "tree", "commit-document-commit-queue-scope"),
      },
      ok: true,
      session: {
        kind: "execution",
        subject: {
          branchId: commitAction.subject.branchId,
          commitId: commitAction.subject.commitId,
          kind: "commit",
        },
      },
    });
    expect(launches).toHaveLength(1);
    expect(launches[0]?.prompt).toContain("Document commit queue scope");
    expect(launches[0]?.prompt).toContain("Launch a commit-scoped execution session");
    expect(launches[0]?.prompt).toContain("commit:document-commit-queue-scope");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("createWorkflowTuiLaunchActionExecutor attaches to an existing branch-scoped session", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-tui-launch-"));
  try {
    const runtimeRoot = resolve(root, "runtime");
    const { repoRoot } = await createSourceRepo(root);
    const workflow = createWorkflow(runtimeRoot);
    const { action, runtime } = createRuntimeFixture(repoRoot);
    let launchCount = 0;
    const executor = createWorkflowTuiLaunchActionExecutor({
      createCoordinator: (issueIdentifier) =>
        new WorkflowSubjectLaunchCoordinator({
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
          workspaceManager: new WorkspaceManager({
            hooks: workflow.hooks,
            repoRoot,
            rootDir: runtimeRoot,
            workerId: issueIdentifier,
          }),
        }),
      getRuntime: () => runtime,
      repoRoot,
      workflow,
    });

    const first = await executor(action);
    const second = await executor({
      ...action,
      label: "Attach branch session",
    });

    expect(first?.ok).toBe(true);
    expect(second).toMatchObject({
      launch: {
        attach: {
          sessionId: "worker:branch-workflow-runtime-contract:1",
        },
        disposition: "attached",
        worktreePath: resolve(runtimeRoot, "tree", "branch-workflow-runtime-contract"),
      },
      ok: true,
    });
    expect(launchCount).toBe(1);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("createWorkflowTuiLaunchActionExecutor attaches to an existing commit-scoped session", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-tui-launch-"));
  try {
    const runtimeRoot = resolve(root, "runtime");
    const { repoRoot } = await createSourceRepo(root);
    const workflow = createWorkflow(runtimeRoot);
    const { commitAction, runtime } = createRuntimeFixture(repoRoot);
    let launchCount = 0;
    const executor = createWorkflowTuiLaunchActionExecutor({
      createCoordinator: (issueIdentifier) =>
        new WorkflowSubjectLaunchCoordinator({
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
          workspaceManager: new WorkspaceManager({
            hooks: workflow.hooks,
            repoRoot,
            rootDir: runtimeRoot,
            workerId: issueIdentifier,
          }),
        }),
      getRuntime: () => runtime,
      repoRoot,
      workflow,
    });

    const first = await executor(commitAction);
    const second = await executor({
      ...commitAction,
      label: "Attach commit session",
    });

    expect(first?.ok).toBe(true);
    expect(second).toMatchObject({
      launch: {
        attach: {
          sessionId: "worker:commit-document-commit-queue-scope:1",
        },
        disposition: "attached",
        worktreePath: resolve(runtimeRoot, "tree", "commit-document-commit-queue-scope"),
      },
      ok: true,
      session: {
        kind: "execution",
        subject: {
          branchId: commitAction.subject.branchId,
          commitId: commitAction.subject.commitId,
          kind: "commit",
        },
      },
    });
    expect(launchCount).toBe(1);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("createWorkflowTuiLaunchActionExecutor returns repository mismatch failures explicitly", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-tui-launch-"));
  try {
    const runtimeRoot = resolve(root, "runtime");
    const { repoRoot } = await createSourceRepo(root);
    const workflow = createWorkflow(runtimeRoot);
    const { action, runtime } = createRuntimeFixture(repoRoot);
    const executor = createWorkflowTuiLaunchActionExecutor({
      getRuntime: () => runtime,
      repoRoot: resolve(root, "different-repo"),
      workflow,
    });

    const result = await executor(action);

    expect(result).toEqual({
      code: "repository-mismatch",
      message: `The selected workflow subject is attached to repository root "${repoRoot}", but io tui is running from "${resolve(root, "different-repo")}".`,
      ok: false,
      subject: {
        branchId: action.subject.branchId,
        kind: "branch",
      },
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("createWorkflowTuiLaunchActionExecutor returns subject locked failures explicitly", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-tui-launch-"));
  try {
    const runtimeRoot = resolve(root, "runtime");
    const { repoRoot } = await createSourceRepo(root);
    const workflow = createWorkflow(runtimeRoot);
    const { action, runtime } = createRuntimeFixture(repoRoot);
    const executor = createWorkflowTuiLaunchActionExecutor({
      createCoordinator: () =>
        ({
          launch: async () => {
            throw new Error(
              "worker_checkout_dirty:worker-1:io/branch:workflow-runtime-contract:OPE-999",
            );
          },
        }) as unknown as WorkflowSubjectLaunchCoordinator,
      getRuntime: () => runtime,
      repoRoot,
      workflow,
    });

    const result = await executor(action);

    expect(result).toEqual({
      code: "subject-locked",
      message:
        "Another session already owns the selected workflow subject or its workspace checkout.",
      ok: false,
      subject: {
        branchId: action.subject.branchId,
        kind: "branch",
      },
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("createWorkflowTuiLaunchActionExecutor returns policy denied failures explicitly", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-tui-launch-"));
  try {
    const runtimeRoot = resolve(root, "runtime");
    const { repoRoot } = await createSourceRepo(root);
    const workflow = createWorkflow(runtimeRoot);
    const { action, runtime } = createRuntimeFixture(repoRoot);
    const executor = createWorkflowTuiLaunchActionExecutor({
      getRuntime: () => ({
        ...runtime,
        projection: {
          ...runtime.projection,
          readProjectBranchScope: () => {
            throw new WorkflowProjectionQueryError("policy-denied", "denied");
          },
        },
      }),
      repoRoot,
      workflow,
    });

    const result = await executor(action);

    expect(result).toEqual({
      code: "policy-denied",
      message: "The current operator scope does not allow launching the selected workflow subject.",
      ok: false,
      subject: {
        branchId: action.subject.branchId,
        kind: "branch",
      },
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("createWorkflowTuiLaunchActionExecutor returns workspace state missing failures explicitly", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-tui-launch-"));
  try {
    const runtimeRoot = resolve(root, "runtime");
    const { repoRoot } = await createSourceRepo(root);
    const workflow = createWorkflow(runtimeRoot);
    const { action, runtime } = createRuntimeFixture(repoRoot);
    const executor = createWorkflowTuiLaunchActionExecutor({
      getRuntime: () => ({
        ...runtime,
        projection: {
          ...runtime.projection,
          readProjectBranchScope: () => ({
            ...runtime.projection.readProjectBranchScope({
              filter: {
                showUnmanagedRepositoryBranches: true,
              },
              projectId: runtime.projectId,
            }),
            repository: undefined,
          }),
        },
      }),
      repoRoot,
      workflow,
    });

    const result = await executor(action);

    expect(result).toEqual({
      code: "workspace-state-missing",
      message:
        "The selected workflow branch does not have attached repository metadata for launch.",
      ok: false,
      subject: {
        branchId: action.subject.branchId,
        kind: "branch",
      },
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
