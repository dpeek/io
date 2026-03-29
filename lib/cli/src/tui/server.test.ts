import { expect, mock, test } from "bun:test";

import { bootstrap } from "@io/graph-bootstrap";
import { createGraphClient } from "@io/graph-client";
import { createGraphStore as createStore } from "@io/graph-kernel";
import { core, coreGraphBootstrapOptions } from "@io/graph-module-core";
import { workflow } from "@io/graph-module-workflow";
import { projectionSchema } from "@io/graph-module-workflow";

import type { Workflow } from "../agent/types.js";
import {
  createWorkflowTuiStartupFailureModel,
  createWorkflowTuiStartupLoadingModel,
} from "./model.js";
import {
  createWorkflowTuiRuntimeBootstrap,
  parseWorkflowTuiCliArgs,
  runWorkflowTuiCli,
} from "./server.js";
import { resolveWorkflowTuiStartupContract } from "./startup.js";
import type { WorkflowTui, WorkflowTuiOptions } from "./tui.js";

const productGraph = { ...core, ...workflow } as const;

function date(value: string): Date {
  return new Date(value);
}

function createWorkflow(overrides: Partial<Workflow["tui"]> = {}): Workflow {
  const graph = {
    kind: "http" as const,
    ...overrides.graph,
  };
  const initialScope = {
    ...overrides.initialScope,
  };

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
    entrypointContent: "# io",
    hooks: {
      timeoutMs: 1,
    },
    issues: {
      defaultAgent: "execute",
      defaultProfile: "execute",
      routing: [],
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
      ...overrides,
      graph,
      initialScope,
    },
    workspace: {
      root: "/workspace/tmp",
    },
  };
}

function createWorkflowGraphFixture(
  options: {
    branchCount?: number;
    projectCount?: number;
  } = {},
) {
  const branchCount = options.branchCount ?? 1;
  const projectCount = options.projectCount ?? 1;
  const store = createStore();
  bootstrap(store, core, coreGraphBootstrapOptions);
  bootstrap(store, workflow, coreGraphBootstrapOptions);
  const graph = createGraphClient(store, productGraph);
  const projectIds: string[] = [];
  const branchIds: string[] = [];

  for (let projectIndex = 0; projectIndex < projectCount; projectIndex += 1) {
    const projectNumber = projectIndex + 1;
    const projectId = graph.project.create({
      name: `Project ${projectNumber}`,
      projectKey: `project:${projectNumber}`,
      createdAt: date(`2026-01-0${projectNumber}T00:00:00.000Z`),
      updatedAt: date(`2026-01-0${projectNumber}T00:00:00.000Z`),
    });
    projectIds.push(projectId);

    const repositoryId = graph.repository.create({
      name: `repo-${projectNumber}`,
      project: projectId,
      repositoryKey: `repo:${projectNumber}`,
      repoRoot: `/tmp/repo-${projectNumber}`,
      defaultBaseBranch: "main",
      createdAt: date(`2026-01-0${projectNumber}T00:00:00.000Z`),
      updatedAt: date(`2026-01-0${projectNumber}T00:00:00.000Z`),
    });

    for (
      let branchIndex = 0;
      branchIndex < (projectCount === 1 ? branchCount : 1);
      branchIndex += 1
    ) {
      const branchNumber = branchIndex + 1;
      const branchId = graph.branch.create({
        name: `Branch ${projectNumber}.${branchNumber}`,
        project: projectId,
        branchKey: `branch:project-${projectNumber}-branch-${branchNumber}`,
        state: workflow.branchState.values.backlog.id,
        queueRank: branchNumber,
        createdAt: date(`2026-01-0${projectNumber}T00:00:00.000Z`),
        updatedAt: date(`2026-01-0${projectNumber}T00:00:00.000Z`),
      });
      branchIds.push(branchId);

      graph.commit.create({
        name: `Commit ${projectNumber}.${branchNumber}`,
        branch: branchId,
        commitKey: `commit:project-${projectNumber}-branch-${branchNumber}`,
        state: workflow.commitState.values.planned.id,
        order: 1,
        createdAt: date(`2026-01-0${projectNumber}T01:00:00.000Z`),
        updatedAt: date(`2026-01-0${projectNumber}T01:00:00.000Z`),
      });

      graph.repositoryBranch.create({
        name: `repo-${projectNumber}/branch-${branchNumber}`,
        project: projectId,
        repository: repositoryId,
        branch: branchId,
        managed: true,
        branchName: `repo-${projectNumber}/branch-${branchNumber}`,
        baseBranchName: "main",
        latestReconciledAt: date(`2026-01-0${projectNumber}T01:00:00.000Z`),
        createdAt: date(`2026-01-0${projectNumber}T01:00:00.000Z`),
        updatedAt: date(`2026-01-0${projectNumber}T01:00:00.000Z`),
      });
    }
  }

  return {
    branchIds,
    graph,
    projectIds,
  };
}

function createWorkflowResult(workflow: Workflow): { ok: true; value: Workflow } {
  return {
    ok: true,
    value: workflow,
  };
}

test("parseWorkflowTuiCliArgs accepts the default bootstrap command shape", () => {
  expect(parseWorkflowTuiCliArgs([])).toEqual({
    branchId: undefined,
    graphUrl: undefined,
    help: false,
    projectId: undefined,
    workflowPath: undefined,
  });
  expect(parseWorkflowTuiCliArgs(["./io.ts"])).toEqual({
    branchId: undefined,
    graphUrl: undefined,
    help: false,
    projectId: undefined,
    workflowPath: "./io.ts",
  });
});

test("parseWorkflowTuiCliArgs accepts help flags", () => {
  expect(parseWorkflowTuiCliArgs(["--help"])).toEqual({
    branchId: undefined,
    graphUrl: undefined,
    help: true,
    projectId: undefined,
    workflowPath: undefined,
  });
  expect(parseWorkflowTuiCliArgs(["-h"])).toEqual({
    branchId: undefined,
    graphUrl: undefined,
    help: true,
    projectId: undefined,
    workflowPath: undefined,
  });
});

test("parseWorkflowTuiCliArgs accepts graph bootstrap overrides", () => {
  expect(
    parseWorkflowTuiCliArgs([
      "./io.ts",
      "--graph-url",
      "https://graph.example/",
      "--project",
      "project:io",
      "--branch",
      "branch:workflow-shell",
    ]),
  ).toEqual({
    branchId: "branch:workflow-shell",
    graphUrl: "https://graph.example/",
    help: false,
    projectId: "project:io",
    workflowPath: "./io.ts",
  });
});

test("parseWorkflowTuiCliArgs rejects unexpected extra arguments, missing values, or flags", () => {
  expect(() => parseWorkflowTuiCliArgs(["./io.ts", "./io.md"])).toThrow(
    "Usage: io tui [entrypointPath]",
  );
  expect(() => parseWorkflowTuiCliArgs(["--once"])).toThrow("Unknown option: --once");
  expect(() => parseWorkflowTuiCliArgs(["--graph-url"])).toThrow("Missing value for --graph-url");
  expect(() => parseWorkflowTuiCliArgs(["--project"])).toThrow("Missing value for --project");
  expect(() => parseWorkflowTuiCliArgs(["--branch"])).toThrow("Missing value for --branch");
});

test("runWorkflowTuiCli bootstraps the synced workflow runtime before creating the TUI", async () => {
  const { branchIds, graph } = createWorkflowGraphFixture({ branchCount: 2 });
  const workflow = createWorkflow({
    graph: {
      kind: "http",
      url: "https://graph.example/runtime",
    },
  });
  const startup = resolveWorkflowTuiStartupContract(workflow);
  const createGraphClient = mock(async (namespace: typeof projectionSchema, options: object) => {
    expect(namespace).toBe(projectionSchema);
    expect(options).toEqual({
      requestedScope: startup.graph.requestedScope,
      url: "https://graph.example/runtime",
    });

    return {
      graph,
    };
  });
  let createdTuiOptions: WorkflowTuiOptions | undefined;
  let surfaceModel: ReturnType<WorkflowTui["getSurfaceModel"]> | undefined;
  const start = mock(async () => {
    if (!createdTuiOptions?.startup?.hydrate) {
      return;
    }
    surfaceModel = await createdTuiOptions.startup.hydrate();
  });
  const stop = mock(async () => {});
  const createTui = mock((options: WorkflowTuiOptions) => {
    createdTuiOptions = options;
    surfaceModel = options.startup
      ? createWorkflowTuiStartupLoadingModel(options.startup)
      : options.surfaceModel;
    return {
      getSurfaceModel() {
        if (!surfaceModel) {
          throw new Error("Expected the test TUI to retain a surface model.");
        }
        return surfaceModel;
      },
      setSurfaceModel() {},
      start,
      stop,
    } satisfies WorkflowTui;
  });

  const originalExitCode = process.exitCode ?? 0;
  process.exitCode = 0;

  try {
    await runWorkflowTuiCli(["./io.ts"], {
      createGraphClient,
      createTui,
      handleExit: () => {},
      loadWorkflow: async () => createWorkflowResult(workflow),
      waitForExit: async () => {},
    });

    expect(createGraphClient).toHaveBeenCalledTimes(1);
    expect(createTui).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(createdTuiOptions?.startup?.contract).toEqual(startup);
    expect(surfaceModel?.kind).toBe("workflow");
    expect(surfaceModel).toMatchObject({
      kind: "workflow",
      selectedBranchId: branchIds[0],
    });
    if (!surfaceModel || surfaceModel.kind !== "workflow") {
      throw new Error("Expected io tui to build a workflow surface model.");
    }
    expect(surfaceModel.branchBoard.rows).toHaveLength(2);
    expect(Number(process.exitCode ?? 0)).toBe(0);
  } finally {
    process.exitCode = originalExitCode;
  }
});

test("runWorkflowTuiCli keeps graph bootstrap failures inside the TUI startup shell", async () => {
  const workflow = createWorkflow();
  const createGraphClient = mock(async () => {
    throw new Error("Sync request failed with 503 Service Unavailable.");
  });
  let createdTuiOptions: WorkflowTuiOptions | undefined;
  let surfaceModel: ReturnType<WorkflowTui["getSurfaceModel"]> | undefined;
  let hydrationError: unknown;
  const start = mock(async () => {
    if (!createdTuiOptions?.startup?.hydrate) {
      return;
    }
    try {
      surfaceModel = await createdTuiOptions.startup.hydrate();
    } catch (error) {
      hydrationError = error;
      surfaceModel = createWorkflowTuiStartupFailureModel({
        ...createdTuiOptions.startup,
        error,
      });
    }
  });
  const stop = mock(async () => {});
  const createTui = mock((options: WorkflowTuiOptions) => {
    createdTuiOptions = options;
    surfaceModel = options.startup
      ? createWorkflowTuiStartupLoadingModel(options.startup)
      : options.surfaceModel;
    return {
      getSurfaceModel() {
        if (!surfaceModel) {
          throw new Error("Expected the test TUI to retain a surface model.");
        }
        return surfaceModel;
      },
      setSurfaceModel() {},
      start,
      stop,
    } satisfies WorkflowTui;
  });
  const originalConsoleError = console.error;
  const originalExitCode = process.exitCode ?? 0;
  const errorLines: string[] = [];

  console.error = mock((message?: unknown) => {
    errorLines.push(String(message));
  }) as typeof console.error;
  process.exitCode = 0;

  try {
    await runWorkflowTuiCli([], {
      createGraphClient,
      createTui,
      handleExit: () => {},
      loadWorkflow: async () => createWorkflowResult(workflow),
      waitForExit: async () => {},
    });

    expect(createGraphClient).toHaveBeenCalledTimes(1);
    expect(createTui).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(createdTuiOptions?.startup).toBeDefined();
    expect(surfaceModel).toMatchObject({
      kind: "startup",
      status: "failure",
    });
    expect(errorLines).toEqual([]);
    expect(hydrationError).toBeInstanceOf(Error);
    expect((hydrationError as Error).message).toBe(
      "Workflow TUI graph initialization failed: Sync request failed with 503 Service Unavailable.",
    );
    expect(Number(process.exitCode)).toBe(1);
  } finally {
    console.error = originalConsoleError;
    process.exitCode = originalExitCode;
  }
});

test("createWorkflowTuiRuntimeBootstrap falls back to the first branch-board row when no branch is configured", async () => {
  const { branchIds, graph } = createWorkflowGraphFixture({ branchCount: 2 });
  const startup = resolveWorkflowTuiStartupContract(createWorkflow());

  const runtime = await createWorkflowTuiRuntimeBootstrap(startup, {
    createGraphClient: async () => ({
      graph,
    }),
  });

  expect(runtime.surfaceModel.kind).toBe("workflow");
  if (runtime.surfaceModel.kind !== "workflow") {
    throw new Error("Expected startup bootstrap to build a workflow surface model.");
  }
  expect(runtime.surfaceModel.selectedBranchId).toBe(branchIds[0]);
  expect(runtime.surfaceModel.branchBoard.rows).toHaveLength(2);
});

test("createWorkflowTuiRuntimeBootstrap rejects configured branches that are missing from the synced workflow scope", async () => {
  const { graph, projectIds } = createWorkflowGraphFixture();
  const startup = resolveWorkflowTuiStartupContract(createWorkflow(), {
    branchId: "branch:missing",
    projectId: projectIds[0],
  });

  await expect(
    createWorkflowTuiRuntimeBootstrap(startup, {
      createGraphClient: async () => ({
        graph,
      }),
    }),
  ).rejects.toThrow(
    'Workflow TUI startup could not resolve configured branch "branch:missing" in the synced workflow scope.',
  );
});

test("createWorkflowTuiRuntimeBootstrap rejects configured branches outside the resolved project", async () => {
  const { branchIds, graph, projectIds } = createWorkflowGraphFixture({ projectCount: 2 });
  const startup = resolveWorkflowTuiStartupContract(createWorkflow(), {
    branchId: branchIds[1],
    projectId: projectIds[0],
  });

  await expect(
    createWorkflowTuiRuntimeBootstrap(startup, {
      createGraphClient: async () => ({
        graph,
      }),
    }),
  ).rejects.toThrow(
    `Workflow TUI startup resolved configured branch "${branchIds[1]}", but it is not visible in project "${projectIds[0]}".`,
  );
});

test("createWorkflowTuiRuntimeBootstrap requires an explicit project when more than one project is visible", async () => {
  const { graph } = createWorkflowGraphFixture({ projectCount: 2 });
  const startup = resolveWorkflowTuiStartupContract(createWorkflow());

  await expect(
    createWorkflowTuiRuntimeBootstrap(startup, {
      createGraphClient: async () => ({
        graph,
      }),
    }),
  ).rejects.toThrow(
    "Workflow TUI startup could not infer an initial project because the synced workflow scope contains 2 visible WorkflowProject records. Pass --project or set io.ts tui.initialScope.project.",
  );
});
