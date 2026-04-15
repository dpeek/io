import { runGraphleDev } from "@dpeek/graphle-local";

export interface GraphleCliDependencies {
  readonly runDev?: typeof runGraphleDev;
  readonly stdout?: Pick<typeof console, "log">;
}

function printHelp(stdout: Pick<typeof console, "log"> = console): void {
  stdout.log(`Usage:
  graphle <command> [options]

Commands:
  dev    Start the local Graphle personal-site runtime
`);
}

export async function runGraphleCli(
  args: string[],
  dependencies: GraphleCliDependencies = {},
): Promise<void> {
  const [command, ...rest] = args;
  const stdout = dependencies.stdout ?? console;

  if (!command || command === "--help" || command === "-h") {
    printHelp(stdout);
    return;
  }

  if (command === "dev") {
    await (dependencies.runDev ?? runGraphleDev)(rest);
    return;
  }

  throw new Error(`Unknown graphle command: ${command}`);
}
