import { createLogger } from "@io/lib";
import { resolve } from "node:path";

import { AgentService } from "./service.js";
import { loadWorkflowFile } from "./workflow.js";
import { readIssueRuntimeState } from "./workspace.js";

function printHelp() {
  console.log(`Usage:
  io agent start [workflowPath] [--once] [--worker-id ID] [--worker-count N] [--worker-index N]
  io agent worker <workerId> [workflowPath] [--once] [--worker-count N] [--worker-index N]
  io agent tail <issue> [workflowPath]
  io agent validate [workflowPath]
  `);
}

type StartCommandOptions = {
  once: boolean;
  workerCount?: number;
  workerId?: string;
  workerIndex?: number;
  workflowPath?: string;
};

function parseStartOptions(args: string[], defaultWorkerId?: string): StartCommandOptions {
  const options: StartCommandOptions = { once: false, workerId: defaultWorkerId };
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (!value) {
      continue;
    }
    if (value === "--once") {
      options.once = true;
      continue;
    }
    if ((value === "--worker" || value === "--worker-id") && args[index + 1]) {
      options.workerId = args[++index];
      continue;
    }
    if (value === "--worker-count" && args[index + 1]) {
      options.workerCount = Number(args[++index]);
      continue;
    }
    if (value === "--worker-index" && args[index + 1]) {
      options.workerIndex = Number(args[++index]);
      continue;
    }
    if (!value.startsWith("--") && !options.workflowPath) {
      options.workflowPath = value;
    }
  }
  return options;
}

export async function runAgentCli(args: string[]) {
  const [command = "start", ...rest] = args;
  switch (command) {
    case "start": {
      const options = parseStartOptions(rest);
      const service = new AgentService(options);
      await service.start();
      return;
    }
    case "worker": {
      const [workerId, ...workerArgs] = rest;
      const options = parseStartOptions(
        workerId && !workerId.startsWith("--") ? workerArgs : rest,
        workerId && !workerId.startsWith("--") ? workerId : undefined,
      );
      const service = new AgentService(options);
      await service.start();
      return;
    }
    case "validate": {
      const workflowPath = resolve(process.cwd(), rest[0] ?? "WORKFLOW.md");
      const result = await loadWorkflowFile(workflowPath);
      if (!result.ok) {
        for (const error of result.errors) {
          console.error(`${error.path}: ${error.message}`);
        }
        process.exitCode = 1;
        return;
      }
      const log = createLogger({ pkg: "agent" });
      log.info("workflow.valid", {
        activeStates: result.value.tracker.activeStates,
        projectSlug: result.value.tracker.projectSlug,
        workspaceRoot: result.value.workspace.root,
      });
      return;
    }
    case "tail": {
      const [issueIdentifier, workflowArg] = rest;
      if (!issueIdentifier || issueIdentifier.startsWith("--")) {
        throw new Error("Usage: surf agent tail <issue> [workflowPath]");
      }
      const workflowPath = resolve(process.cwd(), workflowArg ?? "WORKFLOW.md");
      const result = await loadWorkflowFile(workflowPath);
      if (!result.ok) {
        for (const error of result.errors) {
          console.error(`${error.path}: ${error.message}`);
        }
        process.exitCode = 1;
        return;
      }
      const issueState = await readIssueRuntimeState(result.value.workspace.root, issueIdentifier);
      if (!issueState) {
        console.error(`No retained worker output for ${issueIdentifier}`);
        process.exitCode = 1;
        return;
      }
      const proc = Bun.spawn({
        cmd: ["tail", "-n", "200", "-f", issueState.outputPath],
        stderr: "inherit",
        stdin: "inherit",
        stdout: "inherit",
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
      return;
    }
    case "help":
      printHelp();
      return;
    default:
      throw new Error(`Unknown agent command: ${command}`);
  }
}
