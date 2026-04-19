import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

import {
  deployCloudflarePublicSite as deployCloudflarePublicSiteDefault,
  sanitizeCloudflareDeployError,
  validateCloudflareDeployInput,
  type CloudflareDeployInput,
  type CloudflareDeployResult,
  type CloudflareDeploySanitizedError,
} from "@dpeek/graphle-deploy-cloudflare";
import {
  GraphValidationError,
  readHttpSyncRequest,
  type GraphValidationIssue,
} from "@dpeek/graphle-client";
import type { GraphWriteTransaction } from "@dpeek/graphle-kernel";
import type { GraphleSqliteHandle } from "@dpeek/graphle-sqlite";
import {
  createGraphlePublicSiteRuntimeFromBaseline,
  renderPublicSiteRoute,
  type RenderedPublicSiteRoute,
} from "@dpeek/graphle-site-web";
import { graphleSiteWebClientAssetsPath } from "@dpeek/graphle-site-web/assets";
import type { PublicSiteGraphBaseline } from "@dpeek/graphle-module-site";

import type { LocalAuthController } from "./auth.js";
import {
  buildLocalCloudflareDeployStatus,
  mergeLocalCloudflareDeployInput,
  persistLocalCloudflareDeployMetadata,
  readLocalCloudflareDeployCredentials,
  readLocalCloudflareDeployMetadata,
} from "./deploy.js";
import type { GraphleLocalProject } from "./project.js";
import { buildPublicSiteGraphBaseline } from "./public-site-projection.js";
import { readLocalSiteAuthorityHealth, type LocalSiteAuthority } from "./site-authority.js";

export interface GraphleLocalServer {
  fetch(request: Request): Promise<Response> | Response;
}

export interface CreateGraphleLocalServerOptions {
  readonly project: GraphleLocalProject;
  readonly sqlite: GraphleSqliteHandle;
  readonly auth: LocalAuthController;
  readonly siteAuthority?: LocalSiteAuthority;
  readonly siteWebAssetsPath?: string;
  readonly now?: () => Date;
  readonly deployCloudflarePublicSite?: typeof deployCloudflarePublicSiteDefault;
}

interface SiteWebClientAssetTags {
  readonly scripts: readonly string[];
  readonly styles: readonly string[];
}

type ViteManifestEntry = {
  readonly file?: string;
  readonly css?: readonly string[];
  readonly isEntry?: boolean;
  readonly src?: string;
};

function jsonResponse(
  payload: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function methodNotAllowed(method: string): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: {
      allow: method,
      "cache-control": "no-store",
    },
  });
}

function errorResponse(error: string, code: string, status: number): Response {
  return jsonResponse({ error, code }, status);
}

function authRequiredResponse(): Response {
  return errorResponse("Authentication required.", "auth.required", 401);
}

function redirect(location: string, setCookie?: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      "cache-control": "no-store",
      location,
      ...(setCookie ? { "set-cookie": setCookie } : {}),
    },
  });
}

function contentTypeForPath(pathname: string): string {
  const extension = extname(pathname).toLowerCase();
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".js" || extension === ".mjs") return "application/javascript; charset=utf-8";
  if (extension === ".json" || extension === ".webmanifest")
    return "application/json; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

function isStaticAssetPath(pathname: string): boolean {
  return (
    pathname.startsWith("/assets/") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.webmanifest"
  );
}

function resolveAssetPath(root: string, pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }

  if (decoded.includes("\0") || decoded.endsWith("/")) return undefined;

  const relativePath = decoded.startsWith("/") ? decoded.slice(1) : decoded;
  const rootPath = resolve(root);
  const candidate = resolve(rootPath, relativePath);
  if (candidate !== rootPath && !candidate.startsWith(`${rootPath}${sep}`)) return undefined;
  return candidate;
}

async function tryReadClientAsset(root: string, pathname: string): Promise<Uint8Array | undefined> {
  const assetPath = resolveAssetPath(root, pathname);
  if (!assetPath) return undefined;

  try {
    return await readFile(assetPath);
  } catch {
    return undefined;
  }
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function isViteManifestEntry(value: unknown): value is ViteManifestEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    (entry.file === undefined || typeof entry.file === "string") &&
    (entry.src === undefined || typeof entry.src === "string") &&
    (entry.isEntry === undefined || typeof entry.isEntry === "boolean") &&
    (entry.css === undefined ||
      (Array.isArray(entry.css) && entry.css.every((item) => typeof item === "string")))
  );
}

function pickViteEntry(entries: readonly ViteManifestEntry[]): ViteManifestEntry | undefined {
  return (
    entries.find((entry) => entry.isEntry && entry.src === "src/main.tsx") ??
    entries.find((entry) => entry.isEntry) ??
    entries[0]
  );
}

async function readClientAssetTags(root: string): Promise<SiteWebClientAssetTags> {
  const manifestPath = resolve(root, ".vite", "manifest.json");

  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    if (!manifest || typeof manifest !== "object") {
      return { scripts: [], styles: [] };
    }

    const entry = pickViteEntry(Object.values(manifest).filter(isViteManifestEntry));
    if (!entry?.file) {
      return { scripts: [], styles: [] };
    }

    return {
      scripts: [entry.file],
      styles: entry.css ?? [],
    };
  } catch {
    return { scripts: [], styles: [] };
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderClientAssetTags(assetTags: SiteWebClientAssetTags): string {
  const styleTags = assetTags.styles
    .map((href) => `    <link rel="stylesheet" href="/${escapeHtml(href)}">`)
    .join("\n");
  const scriptTags = assetTags.scripts
    .map((src) => `    <script type="module" src="/${escapeHtml(src)}"></script>`)
    .join("\n");

  return [styleTags, scriptTags].filter((value) => value.length > 0).join("\n");
}

function renderPublicBaselineScript(baseline: PublicSiteGraphBaseline): string {
  const payload = JSON.stringify(baseline)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");

  return `    <script id="graphle-public-site-baseline" type="application/json">${payload}</script>`;
}

function renderSiteHostPage(
  assetTags: SiteWebClientAssetTags,
  baseline: PublicSiteGraphBaseline,
  rendered: RenderedPublicSiteRoute,
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(rendered.title)}</title>
${renderClientAssetTags(assetTags)}
${renderPublicBaselineScript(baseline)}
  </head>
  <body>
    <div id="root">${rendered.html}</div>
  </body>
</html>`;
}

function graphAuthorityUnavailableResponse(): Response {
  return errorResponse(
    "The local site authority is unavailable.",
    "graph.authority_unavailable",
    503,
  );
}

function graphTransportInputResponse(error: string, code: string): Response {
  return errorResponse(error, code, 400);
}

function graphValidationResponse(issues: readonly GraphValidationIssue[]): Response {
  return jsonResponse(
    {
      error: "Invalid graph transaction.",
      code: "graph.validation_failed",
      issues: issues.map((issue) => ({
        path: [...issue.path],
        pathText: issue.path.join("."),
        code: issue.code,
        message: issue.message,
        source: issue.source,
        predicateKey: issue.predicateKey,
        nodeId: issue.nodeId,
      })),
    },
    400,
  );
}

function graphTransportErrorResponse(error: unknown): Response {
  if (error instanceof GraphValidationError) {
    return graphValidationResponse(error.result.issues);
  }

  return errorResponse("Graph transport request failed.", "graph.request_failed", 500);
}

function deployErrorStatus(error: CloudflareDeploySanitizedError): number {
  if (error.code === "settings.invalid") return 400;
  return error.retryable ? 503 : 502;
}

function deployErrorResponse(error: CloudflareDeploySanitizedError): Response {
  return jsonResponse(
    {
      error: error.message,
      code: error.code,
      ...(error.status ? { status: error.status } : {}),
      retryable: error.retryable,
    },
    deployErrorStatus(error),
  );
}

async function readDeployInputBody(request: Request): Promise<Partial<CloudflareDeployInput>> {
  const text = await request.text();
  if (text.trim().length === 0) return {};

  const payload = JSON.parse(text) as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Deploy request body must be a JSON object.");
  }

  const record = payload as Record<string, unknown>;
  return {
    ...(typeof record.accountId === "string" ? { accountId: record.accountId } : {}),
    ...(typeof record.apiToken === "string" ? { apiToken: record.apiToken } : {}),
    ...(typeof record.workerName === "string" ? { workerName: record.workerName } : {}),
  };
}

async function graphSyncResponse(
  request: Request,
  authority: LocalSiteAuthority | undefined,
): Promise<Response> {
  if (!authority) return graphAuthorityUnavailableResponse();

  let syncRequest: ReturnType<typeof readHttpSyncRequest>;
  try {
    syncRequest = readHttpSyncRequest(request);
  } catch (error) {
    return graphTransportInputResponse(
      error instanceof Error ? error.message : "Invalid graph sync request.",
      "graph.sync_request_invalid",
    );
  }

  if (syncRequest.scope?.kind === "module") {
    return graphTransportInputResponse(
      "The local graph transport only supports whole-graph sync.",
      "graph.sync_scope_unsupported",
    );
  }

  return jsonResponse(
    syncRequest.after
      ? authority.getIncrementalSyncResult(syncRequest.after)
      : authority.createTotalSyncPayload(),
  );
}

async function graphTransactionResponse(
  request: Request,
  authority: LocalSiteAuthority | undefined,
): Promise<Response> {
  if (!authority) return graphAuthorityUnavailableResponse();

  let transaction: GraphWriteTransaction;
  try {
    transaction = (await request.json()) as GraphWriteTransaction;
  } catch {
    return graphTransportInputResponse("Request body must be valid JSON.", "graph.body_invalid");
  }

  try {
    return jsonResponse(await authority.applyTransaction(transaction));
  } catch (error) {
    return graphTransportErrorResponse(error);
  }
}

export function createGraphleLocalServer({
  project,
  sqlite,
  auth,
  siteAuthority,
  siteWebAssetsPath = graphleSiteWebClientAssetsPath,
  now = () => new Date(),
  deployCloudflarePublicSite = deployCloudflarePublicSiteDefault,
}: CreateGraphleLocalServerOptions): GraphleLocalServer {
  const startedAt = now().toISOString();
  let assetTagsPromise: Promise<SiteWebClientAssetTags> | undefined;
  let deployInFlight: Promise<CloudflareDeployResult> | undefined;
  let lastDeployError: CloudflareDeploySanitizedError | undefined;

  function loadAssetTags(): Promise<SiteWebClientAssetTags> {
    assetTagsPromise ??= readClientAssetTags(siteWebAssetsPath);
    return assetTagsPromise;
  }

  return {
    async fetch(request) {
      const url = new URL(request.url);
      const cookieHeader = request.headers.get("cookie");

      if (url.pathname === "/api/health") {
        if (request.method !== "GET") {
          return methodNotAllowed("GET");
        }
        return jsonResponse({
          ok: true,
          service: {
            name: "graphle-local",
            status: "ok",
            startedAt,
          },
          project: {
            id: project.projectId,
          },
          database: sqlite.health(),
          graph: readLocalSiteAuthorityHealth(siteAuthority),
        });
      }

      if (url.pathname === "/api/session") {
        if (request.method !== "GET") {
          return methodNotAllowed("GET");
        }
        const session = auth.getSession(cookieHeader);
        return jsonResponse({
          authenticated: session !== null,
          session: session
            ? {
                projectId: session.projectId,
                subject: session.subject,
              }
            : null,
        });
      }

      if (url.pathname === "/api/init") {
        if (request.method !== "GET") {
          return methodNotAllowed("GET");
        }
        const result = auth.redeemInitToken(url.searchParams.get("token"), cookieHeader);
        if (!result.ok) {
          return jsonResponse(
            {
              error: result.message,
              code: result.code,
            },
            401,
          );
        }
        return redirect("/", result.setCookie);
      }

      if (url.pathname === "/api/sync") {
        if (request.method !== "GET") {
          return methodNotAllowed("GET");
        }
        if (!auth.getSession(cookieHeader)) {
          return authRequiredResponse();
        }
        return graphSyncResponse(request, siteAuthority);
      }

      if (url.pathname === "/api/tx") {
        if (request.method !== "POST") {
          return methodNotAllowed("POST");
        }
        if (!auth.getSession(cookieHeader)) {
          return authRequiredResponse();
        }
        return graphTransactionResponse(request, siteAuthority);
      }

      if (url.pathname === "/api/deploy/status") {
        if (request.method !== "GET") {
          return methodNotAllowed("GET");
        }
        if (!auth.getSession(cookieHeader)) {
          return authRequiredResponse();
        }

        const baseline = buildPublicSiteGraphBaseline({
          authority: siteAuthority,
          now,
        });
        return jsonResponse(
          buildLocalCloudflareDeployStatus({
            authority: siteAuthority,
            baseline,
            credentials: await readLocalCloudflareDeployCredentials(project),
            stateOverride: deployInFlight ? "deploying" : undefined,
            error: lastDeployError,
          }),
        );
      }

      if (url.pathname === "/api/deploy") {
        if (request.method !== "POST") {
          return methodNotAllowed("POST");
        }
        if (!auth.getSession(cookieHeader)) {
          return authRequiredResponse();
        }
        if (!siteAuthority) {
          return graphAuthorityUnavailableResponse();
        }
        if (deployInFlight) {
          return jsonResponse(
            {
              error: "A Cloudflare deploy is already running.",
              code: "deploy.concurrent",
            },
            409,
          );
        }

        let body: Partial<CloudflareDeployInput>;
        try {
          body = await readDeployInputBody(request);
        } catch {
          return graphTransportInputResponse(
            "Deploy request body must be valid JSON.",
            "deploy.body_invalid",
          );
        }

        const baseline = buildPublicSiteGraphBaseline({
          authority: siteAuthority,
          now,
        });
        const credentials = await readLocalCloudflareDeployCredentials(project);
        const existingMetadata = readLocalCloudflareDeployMetadata(siteAuthority);
        const input = mergeLocalCloudflareDeployInput({
          body,
          credentials,
          metadata: existingMetadata,
          projectId: project.projectId,
        });
        const validation = validateCloudflareDeployInput(input);
        if (!validation.ok) {
          return jsonResponse(
            {
              error: "Cloudflare deploy settings are invalid.",
              code: "deploy.settings_invalid",
              issues: validation.issues,
            },
            400,
          );
        }

        const deployTask = (async () => {
          const result = await deployCloudflarePublicSite({
            input,
            baseline,
            siteWebAssetsPath,
            now,
          });
          await persistLocalCloudflareDeployMetadata(siteAuthority, result.metadata);
          return result;
        })();
        deployInFlight = deployTask;

        try {
          const result = await deployTask;
          lastDeployError = undefined;
          return jsonResponse(result);
        } catch (error) {
          const sanitized = sanitizeCloudflareDeployError(error, [input.apiToken]);
          lastDeployError = sanitized;
          if (existingMetadata) {
            await persistLocalCloudflareDeployMetadata(siteAuthority, {
              ...existingMetadata,
              status: "error",
              errorSummary: sanitized.message,
            });
          }
          return deployErrorResponse(sanitized);
        } finally {
          if (deployInFlight === deployTask) deployInFlight = undefined;
        }
      }

      if (url.pathname.startsWith("/api/")) {
        return jsonResponse(
          {
            error: `API route "${url.pathname}" was not found.`,
            code: "not-found",
          },
          404,
        );
      }

      if (isStaticAssetPath(url.pathname)) {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return methodNotAllowed("GET, HEAD");
        }

        const asset = await tryReadClientAsset(siteWebAssetsPath, url.pathname);
        if (!asset) {
          return new Response("Asset Not Found", {
            status: 404,
            headers: {
              "cache-control": "no-store",
              "content-type": "text/plain; charset=utf-8",
            },
          });
        }

        return new Response(request.method === "HEAD" ? null : copyToArrayBuffer(asset), {
          status: 200,
          headers: {
            "cache-control": "public, max-age=31536000, immutable",
            "content-type": contentTypeForPath(url.pathname),
          },
        });
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        return methodNotAllowed("GET, HEAD");
      }

      const baseline = buildPublicSiteGraphBaseline({
        authority: siteAuthority,
        now,
      });
      const runtime = createGraphlePublicSiteRuntimeFromBaseline(baseline);
      const rendered = renderPublicSiteRoute({
        runtime,
        path: url.pathname,
        health: {
          graph: readLocalSiteAuthorityHealth(siteAuthority),
        },
        now,
      });
      return new Response(
        request.method === "HEAD"
          ? null
          : renderSiteHostPage(await loadAssetTags(), baseline, rendered),
        {
          status: rendered.status,
          headers: {
            "cache-control": "no-store",
            "content-type": "text/html; charset=utf-8",
          },
        },
      );
    },
  };
}
