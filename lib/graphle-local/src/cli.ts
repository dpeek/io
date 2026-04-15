import { openGraphleSqlite, type GraphleSqliteHandle } from "@dpeek/graphle-sqlite";

import { createLocalAuthController } from "./auth.js";
import { openBrowser as openBrowserUrl } from "./browser.js";
import { prepareLocalProject, type GraphleLocalProject } from "./project.js";
import { createGraphleLocalServer } from "./server.js";

export const defaultGraphleDevHost = "127.0.0.1";
export const defaultGraphleDevPort = 4318;

export interface GraphleDevCliOptions {
  readonly help: boolean;
  readonly host?: string;
  readonly port?: number;
  readonly open: boolean;
}

export interface GraphleServeOptions {
  readonly hostname: string;
  readonly port: number;
  fetch(request: Request): Promise<Response> | Response;
}

export interface GraphleServeHandle {
  readonly port: number;
  stop(): void;
}

export type GraphleServe = (options: GraphleServeOptions) => GraphleServeHandle;

export interface RunGraphleDevDependencies {
  readonly cwd?: string;
  readonly now?: () => Date;
  readonly openBrowser?: (url: string) => void | Promise<void>;
  readonly serve?: GraphleServe;
  readonly stdout?: Pick<typeof console, "log" | "error">;
}

export interface GraphleDevRuntime {
  readonly url: string;
  readonly initUrl: string;
  readonly project: GraphleLocalProject;
  readonly sqlite: GraphleSqliteHandle;
  close(): void;
}

function printHelp(stdout: Pick<typeof console, "log"> = console): void {
  stdout.log(`Usage:
  graphle dev [--host <host>] [--port <port>] [--no-open]

Defaults:
  host: ${defaultGraphleDevHost}
  port: ${defaultGraphleDevPort}
`);
}

function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return parsed;
}

export function parseGraphleDevCliArgs(args: string[]): GraphleDevCliOptions {
  const options: { help: boolean; host?: string; port?: number; open: boolean } = {
    help: false,
    open: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value) {
      continue;
    }
    if (value === "--help" || value === "-h") {
      options.help = true;
      continue;
    }
    if (value === "--no-open") {
      options.open = false;
      continue;
    }
    if (value === "--host") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for --host");
      }
      options.host = next;
      index += 1;
      continue;
    }
    if (value === "--port") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for --port");
      }
      options.port = parsePort(next);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${value}`);
  }

  return options;
}

function formatHostForUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

export function formatGraphleDevUrl(host: string, port: number): string {
  return `http://${formatHostForUrl(host)}:${port}`;
}

export function createGraphleInitUrl(baseUrl: string, token: string): string {
  const url = new URL("/api/init", baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

function formatKeyStatus(keys: readonly string[]): string {
  return keys.length > 0 ? keys.join(", ") : "none";
}

function serveWithBun(options: GraphleServeOptions): GraphleServeHandle {
  const server = Bun.serve(options);
  if (typeof server.port !== "number") {
    void server.stop();
    throw new Error("Bun did not report a TCP port for the local dev server.");
  }
  return {
    port: server.port,
    stop() {
      void server.stop();
    },
  };
}

export async function runGraphleDev(
  args: string[],
  dependencies: RunGraphleDevDependencies = {},
): Promise<GraphleDevRuntime | undefined> {
  const options = parseGraphleDevCliArgs(args);
  const stdout = dependencies.stdout ?? console;
  if (options.help) {
    printHelp(stdout);
    return undefined;
  }

  const project = await prepareLocalProject({
    cwd: dependencies.cwd ?? process.cwd(),
  });
  const sqlite = await openGraphleSqlite({ path: project.databasePath });
  const auth = createLocalAuthController({
    authSecret: project.authSecret,
    projectId: project.projectId,
    now: dependencies.now,
  });
  const server = createGraphleLocalServer({
    project,
    sqlite,
    auth,
    now: dependencies.now,
  });

  const host = options.host ?? defaultGraphleDevHost;
  const port = options.port ?? defaultGraphleDevPort;
  const serve = dependencies.serve ?? serveWithBun;
  let handle: GraphleServeHandle;
  try {
    handle = serve({
      hostname: host,
      port,
      fetch: server.fetch,
    });
  } catch (error) {
    sqlite.close();
    throw new Error(
      `Unable to start graphle dev on ${host}:${port}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const url = formatGraphleDevUrl(host, handle.port);
  const initUrl = createGraphleInitUrl(url, auth.initToken);
  stdout.log(`graphle dev listening on ${url}`);
  stdout.log(`project: ${project.cwd}`);
  stdout.log(
    `env: ${project.env.path} (created: ${formatKeyStatus(project.env.createdKeys)}, reused: ${formatKeyStatus(project.env.reusedKeys)})`,
  );
  stdout.log(`sqlite: ${project.databasePath}`);

  if (options.open) {
    await (dependencies.openBrowser ?? openBrowserUrl)(initUrl);
  } else {
    stdout.log(`open: ${initUrl}`);
  }

  return {
    url,
    initUrl,
    project,
    sqlite,
    close() {
      handle.stop();
      sqlite.close();
    },
  };
}
