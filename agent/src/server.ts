import { createLogger } from "@io/lib";
import { resolve } from "node:path";

import { AgentService } from "./service.js";
import { loadWorkflowFile } from "./workflow.js";

function printHelp() {
  console.log(`Usage:
  surf agent start [workflowPath] [--once]
  surf agent validate [workflowPath]
  `);
}

export async function runAgentCli(args: string[]) {
  const [command = "start", ...rest] = args;
  switch (command) {
    case "start": {
      const once = rest.includes("--once");
      const workflowPath = rest.find((value) => !value.startsWith("--"));
      const service = new AgentService({ once, workflowPath });
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
    case "help":
      printHelp();
      return;
    default:
      throw new Error(`Unknown agent command: ${command}`);
  }
}
