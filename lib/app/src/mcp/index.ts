import { defaultHttpGraphUrl } from "@io/graph-client";

import { normalizeGraphMcpUrl, startGraphMcpServer, type GraphMcpStartOptions } from "./graph.js";

type McpCliCommand = { kind: "help" } | { kind: "graph"; options: GraphMcpStartOptions };

export const graphBearerTokenEnvVar = "IO_GRAPH_BEARER_TOKEN";

export type McpCliHandlers = {
  readonly graph: (options: GraphMcpStartOptions) => Promise<void>;
};

function printMcpHelp() {
  console.log(`Usage:
  io mcp graph [--url <url>] [--bearer-token <token>] [--allow-writes]

Defaults:
  --url ${defaultHttpGraphUrl}
  --bearer-token $${graphBearerTokenEnvVar}
  `);
}

function readOptionalGraphBearerToken(env: NodeJS.ProcessEnv): string | undefined {
  const token = env[graphBearerTokenEnvVar]?.trim();
  return token && token.length > 0 ? token : undefined;
}

function validateGraphWriteAuthCombination(allowWrites: boolean, bearerToken?: string): void {
  if (allowWrites && bearerToken) {
    throw new Error(
      "Bearer-share MCP sessions are read-only. Remove --allow-writes or unset the bearer token.",
    );
  }
}

function parseGraphCommand(args: string[], env: NodeJS.ProcessEnv = process.env): McpCliCommand {
  let allowWrites = false;
  let bearerToken = readOptionalGraphBearerToken(env);
  let url = defaultHttpGraphUrl;

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value) {
      continue;
    }

    if (value === "--help" || value === "-h") {
      return { kind: "help" };
    }

    if (value === "--allow-writes") {
      allowWrites = true;
      continue;
    }

    if (value === "--bearer-token") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(
          "Usage: io mcp graph [--url <url>] [--bearer-token <token>] [--allow-writes]",
        );
      }

      bearerToken = next;
      index += 1;
      continue;
    }

    if (value === "--url") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(
          "Usage: io mcp graph [--url <url>] [--bearer-token <token>] [--allow-writes]",
        );
      }

      url = normalizeGraphMcpUrl(next);
      index += 1;
      continue;
    }

    throw new Error(`Unknown graph MCP option: ${value}`);
  }

  validateGraphWriteAuthCombination(allowWrites, bearerToken);

  return {
    kind: "graph",
    options: { allowWrites, bearerToken, url },
  };
}

export function parseMcpCliArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): McpCliCommand {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    return { kind: "help" };
  }

  if (subcommand === "graph") {
    return parseGraphCommand(rest, env);
  }

  throw new Error(`Unknown mcp command: ${subcommand}`);
}

export async function runMcpCli(
  args: string[],
  handlers: McpCliHandlers = {
    async graph(options) {
      await startGraphMcpServer(options);
    },
  },
) {
  const command = parseMcpCliArgs(args);

  if (command.kind === "help") {
    printMcpHelp();
    return;
  }

  await handlers.graph(command.options);
}
