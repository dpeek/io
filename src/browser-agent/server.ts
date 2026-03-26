import type { ValidationResult, Workflow } from "../agent/types.js";
import { loadWorkflowFile } from "../agent/workflow.js";
import {
  browserAgentActiveSessionPath,
  browserAgentHealthPath,
  browserAgentLaunchPath,
  codexSessionLaunchFailureCodes,
  type BrowserAgentActiveSessionLookupRequest,
  type BrowserAgentActiveSessionLookupResult,
  type BrowserAgentHealthResponse,
  type CodexSessionLaunchFailure,
  type CodexSessionLaunchRequest,
  type CodexSessionLaunchResult,
} from "./transport.js";

export interface BrowserAgentCliOptions {
  readonly host?: string;
  readonly port?: number;
  readonly workflowPath?: string;
}

export interface BrowserAgentLaunchCoordinator {
  launchSession(request: CodexSessionLaunchRequest): Promise<CodexSessionLaunchResult>;
  lookupActiveSession(
    request: BrowserAgentActiveSessionLookupRequest,
  ): Promise<BrowserAgentActiveSessionLookupResult>;
}

export interface BrowserAgentRuntimeContext {
  readonly startedAt: string;
  readonly status: "ready" | "unavailable";
  readonly statusMessage: string;
  readonly workflow?: Workflow;
}

export interface BrowserAgentServerDependencies {
  readonly coordinator?: BrowserAgentLaunchCoordinator;
  readonly loadWorkflow?: typeof loadWorkflowFile;
  readonly now?: () => Date;
  readonly serve?: typeof Bun.serve;
  readonly stdout?: Pick<typeof console, "log" | "error">;
}

export interface BrowserAgentServer {
  readonly context: BrowserAgentRuntimeContext;
  fetch(request: Request): Promise<Response> | Response;
}

function printHelp() {
  console.log(`Usage:
  io browser-agent [entrypointPath] [--host <host>] [--port <port>]

Defaults:
  entrypointPath: ./io.ts + ./io.md
  host: 127.0.0.1
  port: 4317
  `);
}

function errorResponse(message: string, status: number, code?: string): Response {
  return Response.json(code ? { error: message, code } : { error: message }, {
    status,
    headers: {
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: {
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}

function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return parsed;
}

export function parseBrowserAgentCliArgs(args: string[]): BrowserAgentCliOptions & {
  readonly help: boolean;
} {
  const options: { help: boolean; host?: string; port?: number; workflowPath?: string } = {
    help: false,
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
    if (value.startsWith("--")) {
      throw new Error(`Unknown option: ${value}`);
    }
    if (!options.workflowPath) {
      options.workflowPath = value;
      continue;
    }
    throw new Error("Usage: io browser-agent [entrypointPath] [--host <host>] [--port <port>]");
  }

  return options;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function parseLaunchSubject(value: unknown, label: string): CodexSessionLaunchRequest["subject"] {
  if (!isObjectRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const kind = requireString(value.kind, `${label}.kind`);
  if (kind === "branch") {
    return {
      kind,
      branchId: requireString(value.branchId, `${label}.branchId`),
    };
  }
  if (kind === "commit") {
    return {
      kind,
      branchId: requireString(value.branchId, `${label}.branchId`),
      commitId: requireString(value.commitId, `${label}.commitId`),
    };
  }
  throw new Error(`${label}.kind must be "branch" or "commit".`);
}

function parseActor(value: unknown, label: string): CodexSessionLaunchRequest["actor"] {
  if (!isObjectRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const surface = requireString(value.surface, `${label}.surface`);
  if (surface !== "browser" && surface !== "tui") {
    throw new Error(`${label}.surface must be "browser" or "tui".`);
  }
  return {
    principalId: requireString(value.principalId, `${label}.principalId`),
    sessionId: requireString(value.sessionId, `${label}.sessionId`),
    surface,
  };
}

function parseLaunchRequest(value: unknown): CodexSessionLaunchRequest {
  if (!isObjectRecord(value)) {
    throw new Error("Launch request must be a JSON object.");
  }
  const kind = requireString(value.kind, 'Launch request "kind"');
  if (kind !== "planning" && kind !== "execution" && kind !== "review") {
    throw new Error('Launch request "kind" must be "planning", "execution", or "review".');
  }
  const request: {
    actor: CodexSessionLaunchRequest["actor"];
    delegation?: CodexSessionLaunchRequest["delegation"];
    kind: CodexSessionLaunchRequest["kind"];
    preference?: CodexSessionLaunchRequest["preference"];
    projectId: string;
    selection?: CodexSessionLaunchRequest["selection"];
    subject: CodexSessionLaunchRequest["subject"];
  } = {
    actor: parseActor(value.actor, 'Launch request "actor"'),
    kind,
    projectId: requireString(value.projectId, 'Launch request "projectId"'),
    subject: parseLaunchSubject(value.subject, 'Launch request "subject"'),
  };

  if (value.preference !== undefined) {
    if (!isObjectRecord(value.preference)) {
      throw new Error('Launch request "preference" must be an object.');
    }
    const mode = requireString(value.preference.mode, 'Launch request "preference.mode"');
    if (mode !== "launch-new" && mode !== "attach-or-launch" && mode !== "attach-existing") {
      throw new Error(
        'Launch request "preference.mode" must be "launch-new", "attach-or-launch", or "attach-existing".',
      );
    }
    request.preference = { mode };
  }

  if (value.selection !== undefined) {
    if (!isObjectRecord(value.selection)) {
      throw new Error('Launch request "selection" must be an object.');
    }
    request.selection = {
      ...(typeof value.selection.projectId === "string"
        ? { projectId: value.selection.projectId }
        : {}),
      ...(typeof value.selection.branchId === "string"
        ? { branchId: value.selection.branchId }
        : {}),
      ...(typeof value.selection.commitId === "string"
        ? { commitId: value.selection.commitId }
        : {}),
    };
  }

  if (value.delegation !== undefined) {
    if (!isObjectRecord(value.delegation) || !isObjectRecord(value.delegation.lease)) {
      throw new Error('Launch request "delegation.lease" must be an object when provided.');
    }
    request.delegation = {
      lease: value.delegation.lease as unknown as NonNullable<
        CodexSessionLaunchRequest["delegation"]
      >["lease"],
    };
  }

  return request;
}

function parseActiveSessionLookupRequest(value: unknown): BrowserAgentActiveSessionLookupRequest {
  if (!isObjectRecord(value)) {
    throw new Error("Active-session lookup request must be a JSON object.");
  }
  const kind = requireString(value.kind, 'Active-session lookup request "kind"');
  if (kind !== "planning" && kind !== "execution" && kind !== "review") {
    throw new Error(
      'Active-session lookup request "kind" must be "planning", "execution", or "review".',
    );
  }

  return {
    actor: parseActor(value.actor, 'Active-session lookup request "actor"'),
    kind,
    projectId: requireString(value.projectId, 'Active-session lookup request "projectId"'),
    subject: parseLaunchSubject(value.subject, 'Active-session lookup request "subject"'),
  };
}

function createUnavailableLaunchFailure(message: string): CodexSessionLaunchFailure {
  return {
    code: "local-bridge-unavailable",
    message,
    ok: false,
    retryable: true,
    source: "browser-agent",
  };
}

function buildContext(
  workflowResult: ValidationResult<Workflow>,
  coordinator: BrowserAgentLaunchCoordinator | undefined,
  now: () => Date,
): BrowserAgentRuntimeContext {
  if (!workflowResult.ok) {
    return {
      startedAt: now().toISOString(),
      status: "unavailable",
      statusMessage: workflowResult.errors
        .map((error) => `${error.path}: ${error.message}`)
        .join("; "),
    };
  }
  if (!coordinator) {
    return {
      startedAt: now().toISOString(),
      status: "unavailable",
      statusMessage:
        "No shared workflow launch coordinator is configured for the local browser-agent runtime.",
      workflow: workflowResult.value,
    };
  }
  return {
    startedAt: now().toISOString(),
    status: "ready",
    statusMessage: "Browser-agent runtime ready for launch, attach, and active-session lookup.",
    workflow: workflowResult.value,
  };
}

function isLaunchFailure(value: unknown): value is CodexSessionLaunchFailure {
  return (
    isObjectRecord(value) &&
    value.ok === false &&
    typeof value.code === "string" &&
    codexSessionLaunchFailureCodes.includes(value.code as CodexSessionLaunchFailure["code"]) &&
    typeof value.message === "string"
  );
}

export function createBrowserAgentServer(
  workflowResult: ValidationResult<Workflow>,
  dependencies: BrowserAgentServerDependencies = {},
): BrowserAgentServer {
  const now = dependencies.now ?? (() => new Date());
  const coordinator = dependencies.coordinator;
  const context = buildContext(workflowResult, coordinator, now);

  return {
    context,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-headers": "content-type",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-origin": "*",
            "cache-control": "no-store",
          },
        });
      }

      if (url.pathname === browserAgentHealthPath) {
        if (request.method !== "GET") {
          return new Response("Method Not Allowed", {
            status: 405,
            headers: { allow: "GET" },
          });
        }
        return jsonResponse({
          ok: true,
          runtime: {
            activeSessionLookupPath: browserAgentActiveSessionPath,
            launchPath: browserAgentLaunchPath,
            startedAt: context.startedAt,
            status: context.status,
            statusMessage: context.statusMessage,
            version: 1,
          },
        } satisfies BrowserAgentHealthResponse);
      }

      if (url.pathname === browserAgentLaunchPath) {
        if (request.method !== "POST") {
          return new Response("Method Not Allowed", {
            status: 405,
            headers: { allow: "POST" },
          });
        }
        if (!coordinator || context.status !== "ready") {
          return jsonResponse(createUnavailableLaunchFailure(context.statusMessage));
        }
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return errorResponse("Request body must be valid JSON.", 400);
        }
        try {
          const result = await coordinator.launchSession(parseLaunchRequest(body));
          if (isLaunchFailure(result) && result.code === "local-bridge-unavailable") {
            return jsonResponse(result, 503);
          }
          return jsonResponse(result);
        } catch (error) {
          return jsonResponse(
            createUnavailableLaunchFailure(error instanceof Error ? error.message : String(error)),
            503,
          );
        }
      }

      if (url.pathname === browserAgentActiveSessionPath) {
        if (request.method !== "POST") {
          return new Response("Method Not Allowed", {
            status: 405,
            headers: { allow: "POST" },
          });
        }
        if (!coordinator || context.status !== "ready") {
          return jsonResponse(createUnavailableLaunchFailure(context.statusMessage), 503);
        }
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return errorResponse("Request body must be valid JSON.", 400);
        }
        try {
          return jsonResponse(
            await coordinator.lookupActiveSession(parseActiveSessionLookupRequest(body)),
          );
        } catch (error) {
          return jsonResponse(
            createUnavailableLaunchFailure(error instanceof Error ? error.message : String(error)),
            503,
          );
        }
      }

      return errorResponse(
        `Browser-agent route "${url.pathname}" was not found.`,
        404,
        "not-found",
      );
    },
  };
}

export async function runBrowserAgentCli(
  args: string[],
  dependencies: BrowserAgentServerDependencies = {},
) {
  const options = parseBrowserAgentCliArgs(args);
  if (options.help) {
    printHelp();
    return;
  }

  const loadWorkflow = dependencies.loadWorkflow ?? loadWorkflowFile;
  const workflowResult = await loadWorkflow(options.workflowPath, process.cwd());
  const server = createBrowserAgentServer(workflowResult, dependencies);
  const serve = dependencies.serve ?? Bun.serve;
  const stdout = dependencies.stdout ?? console;

  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4317;
  const handle = serve({
    hostname: host,
    port,
    fetch: server.fetch,
  });

  stdout.log(`browser-agent listening on http://${host}:${handle.port}`);
  if (server.context.status !== "ready") {
    stdout.error(`browser-agent unavailable: ${server.context.statusMessage}`);
  }
}
