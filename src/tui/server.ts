import { handleExit } from "@io/core/lib";
import { createHttpGraphClient } from "@io/graph-client";

import { loadWorkflowFile } from "../agent/workflow.js";
import { coreGraphBootstrapOptions } from "../graph/modules/index.js";
import {
  createWorkflowProjectionIndex,
  WorkflowProjectionQueryError,
  type WorkflowProjectionGraphClient,
  type WorkflowProjectionIndex,
} from "../graph/modules/ops/workflow/query.js";
import { workflowProjectionSchema } from "../graph/modules/ops/workflow/schema.js";
import { createWorkflowTuiWorkflowModel, type WorkflowTuiWorkflowSurfaceModel } from "./model.js";
import { resolveWorkflowTuiStartupContract, type WorkflowTuiStartupContract } from "./startup.js";
import { createWorkflowTui, type WorkflowTui } from "./tui.js";

export interface WorkflowTuiCliOptions {
  branchId?: string;
  graphUrl?: string;
  help: boolean;
  projectId?: string;
  workflowPath?: string;
}

export interface WorkflowTuiRuntimeClient {
  readonly graph: WorkflowProjectionGraphClient;
}

export interface WorkflowTuiRuntimeBootstrap {
  readonly projectId: string;
  readonly projection: WorkflowProjectionIndex;
  readonly runtimeClient: WorkflowTuiRuntimeClient;
  readonly surfaceModel: WorkflowTuiWorkflowSurfaceModel;
}

export interface WorkflowTuiRuntimeBootstrapDependencies {
  readonly createGraphClient?: (
    namespace: typeof workflowProjectionSchema,
    options: {
      readonly requestedScope: WorkflowTuiStartupContract["graph"]["requestedScope"];
      readonly url: string;
    },
  ) => Promise<WorkflowTuiRuntimeClient>;
  readonly createProjectionIndex?: (
    graph: WorkflowProjectionGraphClient,
  ) => WorkflowProjectionIndex;
}

export interface WorkflowTuiCliDependencies extends WorkflowTuiRuntimeBootstrapDependencies {
  readonly createTui?: typeof createWorkflowTui;
  readonly handleExit?: typeof handleExit;
  readonly loadWorkflow?: typeof loadWorkflowFile;
  readonly waitForExit?: () => Promise<void>;
}

function printHelp() {
  console.log(`Usage:
  io tui [entrypointPath] [--graph-url <url>] [--project <projectId>] [--branch <branchId>]

Defaults:
  entrypointPath: ./io.ts + ./io.md
  graph source: workflow config tui.graph.url, else http://io.localhost:1355/
  sync scope: ops/workflow / scope:ops/workflow:review
  project: CLI --project, workflow config tui.initialScope.project, else infer one visible WorkflowProject
  branch: CLI --branch, workflow config tui.initialScope.branch, else first branch-board row
  `);
}

function readWorkflowTuiFlagValue(args: string[], index: number, flag: string) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

export function parseWorkflowTuiCliArgs(args: string[]): WorkflowTuiCliOptions {
  const options: WorkflowTuiCliOptions = { help: false };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (value === "--help" || value === "-h") {
      options.help = true;
      continue;
    }
    if (value === "--graph-url") {
      options.graphUrl = readWorkflowTuiFlagValue(args, index, value);
      index += 1;
      continue;
    }
    if (value === "--project") {
      options.projectId = readWorkflowTuiFlagValue(args, index, value);
      index += 1;
      continue;
    }
    if (value === "--branch") {
      options.branchId = readWorkflowTuiFlagValue(args, index, value);
      index += 1;
      continue;
    }
    if (value.startsWith("--")) {
      throw new Error(`Unknown option: ${value}`);
    }
    if (!options.workflowPath) {
      options.workflowPath = value;
      continue;
    }
    throw new Error("Usage: io tui [entrypointPath]");
  }

  return options;
}

function waitForever() {
  return new Promise<void>(() => undefined);
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function createWorkflowTuiStartupError(message: string, cause?: unknown) {
  if (cause === undefined) {
    return new Error(message);
  }

  const detail = toErrorMessage(cause);
  return new Error(`${message}: ${detail}`);
}

function resolveInitialProjectId(
  runtimeClient: WorkflowTuiRuntimeClient,
  startup: WorkflowTuiStartupContract,
) {
  if (startup.initialScope.project.kind === "configured") {
    return startup.initialScope.project.projectId;
  }

  const visibleProjects = runtimeClient.graph.workflowProject.list();
  if (visibleProjects.length === 1) {
    return visibleProjects[0]!.id;
  }

  if (visibleProjects.length === 0) {
    throw new Error(
      "Workflow TUI startup could not infer an initial project because the synced workflow scope contains no visible WorkflowProject records. Pass --project or set io.ts tui.initialScope.project.",
    );
  }

  throw new Error(
    `Workflow TUI startup could not infer an initial project because the synced workflow scope contains ${visibleProjects.length} visible WorkflowProject records. Pass --project or set io.ts tui.initialScope.project.`,
  );
}

function readInitialProjectBranchBoard(
  projection: WorkflowProjectionIndex,
  projectId: string,
  startup: WorkflowTuiStartupContract,
) {
  try {
    return projection.readProjectBranchScope({
      projectId,
      filter: {
        showUnmanagedRepositoryBranches: true,
      },
    });
  } catch (error) {
    if (
      error instanceof WorkflowProjectionQueryError &&
      error.code === "project-not-found" &&
      startup.initialScope.project.kind === "configured"
    ) {
      throw new Error(
        `Workflow TUI startup could not resolve configured project "${startup.initialScope.project.projectId}" in the synced workflow scope.`,
      );
    }

    throw createWorkflowTuiStartupError(
      `Workflow TUI startup could not read the initial branch board for project "${projectId}"`,
      error,
    );
  }
}

function readCommitQueues(
  projection: WorkflowProjectionIndex,
  branchIds: readonly string[],
  projectId: string,
) {
  return branchIds.map((branchId) => {
    try {
      return projection.readCommitQueueScope({ branchId });
    } catch (error) {
      throw createWorkflowTuiStartupError(
        `Workflow TUI startup could not read the initial commit queue for branch "${branchId}" in project "${projectId}"`,
        error,
      );
    }
  });
}

function resolveSelectedBranchId(
  projection: WorkflowProjectionIndex,
  startup: WorkflowTuiStartupContract,
  projectId: string,
  visibleBranchIds: ReadonlySet<string>,
) {
  if (startup.initialScope.branch.kind !== "configured") {
    return undefined;
  }

  const branchId = startup.initialScope.branch.branchId;
  if (visibleBranchIds.has(branchId)) {
    return branchId;
  }

  try {
    projection.readCommitQueueScope({ branchId });
  } catch (error) {
    if (error instanceof WorkflowProjectionQueryError && error.code === "branch-not-found") {
      throw new Error(
        `Workflow TUI startup could not resolve configured branch "${branchId}" in the synced workflow scope.`,
      );
    }

    throw createWorkflowTuiStartupError(
      `Workflow TUI startup could not resolve configured branch "${branchId}"`,
      error,
    );
  }

  throw new Error(
    `Workflow TUI startup resolved configured branch "${branchId}", but it is not visible in project "${projectId}".`,
  );
}

export async function createWorkflowTuiRuntimeBootstrap(
  startup: WorkflowTuiStartupContract,
  dependencies: WorkflowTuiRuntimeBootstrapDependencies = {},
): Promise<WorkflowTuiRuntimeBootstrap> {
  const createGraphClient =
    dependencies.createGraphClient ??
    (async (namespace, options) =>
      createHttpGraphClient(namespace, {
        bootstrap: coreGraphBootstrapOptions,
        ...options,
      }));
  const createProjection = dependencies.createProjectionIndex ?? createWorkflowProjectionIndex;

  let runtimeClient: WorkflowTuiRuntimeClient;
  try {
    runtimeClient = await createGraphClient(workflowProjectionSchema, {
      requestedScope: startup.graph.requestedScope,
      url: startup.graph.url,
    });
  } catch (error) {
    throw createWorkflowTuiStartupError("Workflow TUI graph initialization failed", error);
  }

  const projection = createProjection(runtimeClient.graph);
  const projectId = resolveInitialProjectId(runtimeClient, startup);
  const branchBoard = readInitialProjectBranchBoard(projection, projectId, startup);
  const branchIds = branchBoard.rows.map((row) => row.workflowBranch.id);
  const selectedBranchId = resolveSelectedBranchId(
    projection,
    startup,
    projectId,
    new Set(branchIds),
  );
  const commitQueues = readCommitQueues(projection, branchIds, projectId);

  return {
    projectId,
    projection,
    runtimeClient,
    surfaceModel: createWorkflowTuiWorkflowModel({
      branchBoard,
      commitQueues,
      ...(selectedBranchId ? { selectedBranchId } : {}),
    }),
  };
}

export async function runWorkflowTuiCli(
  args: string[],
  dependencies: WorkflowTuiCliDependencies = {},
) {
  let tui: WorkflowTui | undefined;
  let stopped = false;
  const stop = async () => {
    if (stopped || !tui) {
      return;
    }
    stopped = true;
    await tui.stop();
  };

  try {
    const options = parseWorkflowTuiCliArgs(args);
    if (options.help) {
      printHelp();
      return;
    }

    const result = await (dependencies.loadWorkflow ?? loadWorkflowFile)(
      options.workflowPath,
      process.cwd(),
    );
    if (!result.ok) {
      for (const error of result.errors) {
        console.error(`${error.path}: ${error.message}`);
      }
      process.exitCode = 1;
      return;
    }

    const startup = resolveWorkflowTuiStartupContract(result.value, {
      branchId: options.branchId,
      graphUrl: options.graphUrl,
      projectId: options.projectId,
    });
    tui = (dependencies.createTui ?? createWorkflowTui)({
      startup: {
        contract: startup,
        entrypointPath: startup.entrypointPath,
        hydrate: async () => {
          try {
            const runtime = await createWorkflowTuiRuntimeBootstrap(startup, dependencies);
            return runtime.surfaceModel;
          } catch (error) {
            process.exitCode = 1;
            throw error;
          }
        },
        workspaceRoot: startup.workspaceRoot,
      },
    });

    (dependencies.handleExit ?? handleExit)(stop);
    await tui.start();
    await (dependencies.waitForExit ?? waitForever)();
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  } finally {
    await stop();
  }
}
