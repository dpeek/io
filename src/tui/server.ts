import { handleExit } from "@io/core/lib";

import { loadWorkflowFile } from "../agent/workflow.js";
import { createWorkflowTuiBootstrapModel } from "./model.js";
import { createWorkflowTui } from "./tui.js";

export interface WorkflowTuiCliOptions {
  help: boolean;
  workflowPath?: string;
}

function printHelp() {
  console.log(`Usage:
  io tui [entrypointPath]

Defaults:
  ./io.ts + ./io.md
  `);
}

export function parseWorkflowTuiCliArgs(args: string[]): WorkflowTuiCliOptions {
  const options: WorkflowTuiCliOptions = { help: false };

  for (const value of args) {
    if (value === "--help" || value === "-h") {
      options.help = true;
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

export async function runWorkflowTuiCli(args: string[]) {
  const options = parseWorkflowTuiCliArgs(args);
  if (options.help) {
    printHelp();
    return;
  }

  const result = await loadWorkflowFile(options.workflowPath, process.cwd());
  if (!result.ok) {
    for (const error of result.errors) {
      console.error(`${error.path}: ${error.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const tui = createWorkflowTui({
    bootstrap: {
      entrypointPath: result.value.entrypoint.configPath,
      workspaceRoot: result.value.workspace.root,
    },
    surfaceModel: createWorkflowTuiBootstrapModel({
      entrypointPath: result.value.entrypoint.configPath,
      workspaceRoot: result.value.workspace.root,
    }),
  });

  let stopped = false;
  const stop = async () => {
    if (stopped) {
      return;
    }
    stopped = true;
    await tui.stop();
  };

  handleExit(stop);

  try {
    await tui.start();
    await waitForever();
  } finally {
    await stop();
  }
}
