import { createLogger, handleExit } from "@io/app/lib";

import { AgentService } from "./service.js";
import { AgentTuiRetainedReader } from "./tui-runtime.js";
import { createAgentTui } from "./tui/index.js";
import type { AgentSessionEvent, AgentSessionPhase } from "./tui/index.js";
import { loadWorkflowFile } from "./workflow.js";
import { readIssueRuntimeState } from "./workspace.js";

function printHelp() {
  console.log(`Usage:
  io agent start [entrypointPath] [--once]
  io agent tui [entrypointPath] [--once]
  io agent tui attach <issue> [entrypointPath]
  io agent tui replay <issue> [entrypointPath] [--delay-ms <ms>]
  io agent tail <issue> [entrypointPath]
  io agent validate [entrypointPath]

Defaults:
  ./io.ts + ./io.md
  `);
}

type StartCommandOptions = {
  once: boolean;
  workflowPath?: string;
};

type RetainedTuiCommandOptions = {
  delayMs?: number;
  issueIdentifier: string;
  mode: "attach" | "replay";
  workflowPath?: string;
};

const TERMINAL_SESSION_PHASES = new Set<AgentSessionPhase>(["completed", "failed", "stopped"]);

export function isTerminalSessionPhase(phase: AgentSessionPhase) {
  return TERMINAL_SESSION_PHASES.has(phase);
}

export function isCompletedRetainedSessionEvent(event: AgentSessionEvent, sessionId: string) {
  return (
    event.type === "session" &&
    event.session.id === sessionId &&
    isTerminalSessionPhase(event.phase)
  );
}

function parseStartOptions(args: string[]): StartCommandOptions {
  const options: StartCommandOptions = { once: false };
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (!value) {
      continue;
    }
    if (value === "--once") {
      options.once = true;
      continue;
    }
    if (!value.startsWith("--") && !options.workflowPath) {
      options.workflowPath = value;
    }
  }
  return options;
}

function parseRetainedTuiOptions(
  args: string[],
  mode: RetainedTuiCommandOptions["mode"],
): RetainedTuiCommandOptions {
  const options: RetainedTuiCommandOptions = {
    delayMs: mode === "replay" ? 40 : undefined,
    issueIdentifier: "",
    mode,
  };

  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (!value) {
      continue;
    }
    if (value === "--delay-ms") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Usage: io agent tui replay <issue> [entrypointPath] [--delay-ms <ms>]");
      }
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`Invalid replay delay: ${next}`);
      }
      options.delayMs = parsed;
      index += 1;
      continue;
    }
    if (!value.startsWith("--") && !options.issueIdentifier) {
      options.issueIdentifier = value;
      continue;
    }
    if (!value.startsWith("--") && !options.workflowPath) {
      options.workflowPath = value;
    }
  }

  if (!options.issueIdentifier) {
    throw new Error(
      `Usage: io agent tui ${mode} <issue> [entrypointPath]${mode === "replay" ? " [--delay-ms <ms>]" : ""}`,
    );
  }
  return options;
}

async function runAgentService(options: StartCommandOptions, mode: "start" | "tui") {
  const tui = mode === "tui" ? createAgentTui() : undefined;
  const service = new AgentService({
    ...options,
    stdoutEvents: mode !== "tui",
  });
  if (tui) {
    service.observeSessionEvents(tui.observe);
  }

  let stopped = false;
  const stop = async () => {
    if (stopped) {
      return;
    }
    stopped = true;
    await tui?.stop();
    await service.stop();
  };

  handleExit(stop);

  try {
    await tui?.start();
    await service.start();
    if (!options.once) {
      await waitForever();
    }
  } finally {
    await stop();
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function waitForever() {
  return new Promise<void>(() => undefined);
}

async function runRetainedTui(options: RetainedTuiCommandOptions) {
  const result = await loadWorkflowFile(options.workflowPath, process.cwd());
  if (!result.ok) {
    for (const error of result.errors) {
      console.error(`${error.path}: ${error.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const issueState = await readIssueRuntimeState(
    result.value.workspace.root,
    options.issueIdentifier,
  );
  if (!issueState) {
    console.error(`No retained issue output for ${options.issueIdentifier}`);
    process.exitCode = 1;
    return;
  }

  const tui = createAgentTui();
  const reader = new AgentTuiRetainedReader({
    issueState,
    repoRoot: process.cwd(),
  });

  let active = true;
  let interval: ReturnType<typeof setInterval> | undefined;
  let reading = false;
  let resolveExited: (() => void) | undefined;
  const exited = new Promise<void>((resolve) => {
    resolveExited = resolve;
  });

  const stop = async () => {
    if (!active) {
      return;
    }
    active = false;
    if (interval) {
      clearInterval(interval);
      interval = undefined;
    }
    await tui.stop();
    resolveExited?.();
  };

  const observe = (event: AgentSessionEvent) => {
    tui.observe(event);
    if (
      options.mode === "attach" &&
      isCompletedRetainedSessionEvent(event, reader.workerSession.id)
    ) {
      void stop();
    }
  };

  handleExit(stop);
  await tui.start();

  const initialEvents = await reader.readInitialEvents(options.mode);
  if (options.mode === "replay") {
    for (const event of initialEvents) {
      if (!active) {
        return;
      }
      observe(event);
      if ((options.delayMs ?? 0) > 0) {
        await sleep(options.delayMs ?? 0);
      }
    }
    observe(reader.createReplayCompletedEvent());
    interval = setInterval(() => undefined, 60_000);
  } else {
    for (const event of initialEvents) {
      observe(event);
      if (!active) {
        break;
      }
    }
    if (active) {
      interval = setInterval(() => {
        if (!active || reading) {
          return;
        }
        reading = true;
        void reader
          .readNextEvents()
          .then((events) => {
            for (const event of events) {
              observe(event);
              if (!active) {
                break;
              }
            }
          })
          .catch((error) => {
            observe({
              code: "error",
              format: "line",
              sequence: Number.MAX_SAFE_INTEGER,
              session: reader.supervisorSession,
              text: error instanceof Error ? error.message : String(error),
              timestamp: new Date().toISOString(),
              type: "status",
            });
          })
          .finally(() => {
            reading = false;
          });
      }, 250);
    }
  }

  await (options.mode === "attach" ? exited : waitForever());
}

export async function runAgentCli(args: string[]) {
  const [command = "start", ...rest] = args;
  switch (command) {
    case "start": {
      const options = parseStartOptions(rest);
      await runAgentService(options, "start");
      return;
    }
    case "tui": {
      const [subcommand, ...subcommandArgs] = rest;
      if (subcommand === "attach" || subcommand === "replay") {
        const options = parseRetainedTuiOptions(subcommandArgs, subcommand);
        await runRetainedTui(options);
        return;
      }
      const options = parseStartOptions(rest);
      await runAgentService(options, "tui");
      return;
    }
    case "validate": {
      const result = await loadWorkflowFile(rest[0], process.cwd());
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
        configPath: result.value.entrypoint.configPath,
        entrypointKind: result.value.entrypoint.kind,
        promptPath: result.value.entrypoint.promptPath,
        projectSlug: result.value.tracker.projectSlug,
        workspaceRoot: result.value.workspace.root,
      });
      return;
    }
    case "tail": {
      const [issueIdentifier, workflowArg] = rest;
      if (!issueIdentifier || issueIdentifier.startsWith("--")) {
        throw new Error("Usage: io agent tail <issue> [entrypointPath]");
      }
      const result = await loadWorkflowFile(workflowArg, process.cwd());
      if (!result.ok) {
        for (const error of result.errors) {
          console.error(`${error.path}: ${error.message}`);
        }
        process.exitCode = 1;
        return;
      }
      const issueState = await readIssueRuntimeState(result.value.workspace.root, issueIdentifier);
      if (!issueState) {
        console.error(`No retained issue output for ${issueIdentifier}`);
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
