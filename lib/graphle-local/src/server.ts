import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

import {
  GraphValidationError,
  readHttpSyncRequest,
  type GraphValidationIssue,
} from "@dpeek/graphle-client";
import type { GraphWriteTransaction } from "@dpeek/graphle-kernel";
import type { GraphleSqliteHandle } from "@dpeek/graphle-sqlite";
import { graphleSiteWebClientAssetsPath } from "@dpeek/graphle-site-web/assets";

import type { LocalAuthController, LocalAdminSession } from "./auth.js";
import type { GraphleLocalProject } from "./project.js";
import {
  createLocalSiteItem,
  deleteLocalSiteItem,
  listLocalSiteItems,
  LocalSiteNotFoundError,
  LocalSiteValidationError,
  readLocalSiteAuthorityHealth,
  readLocalSiteRoutePayload,
  reorderLocalSiteItems,
  updateLocalSiteItem,
  type LocalSiteAuthority,
  type LocalSiteRoutePayload,
  type LocalSiteRouteResult,
  type LocalSiteValidationIssue,
} from "./site-authority.js";

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

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new LocalSiteValidationError([
      {
        path: "body",
        code: "site.body_invalid",
        message: "Request body must be valid JSON.",
      },
    ]);
  }
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

type BunMarkdownHost = typeof globalThis & {
  Bun?: {
    markdown?: {
      html?: (content: string, options?: Record<string, unknown>) => string;
    };
  };
};

function renderMarkdownFallback(content: string): string {
  const markdown = (globalThis as BunMarkdownHost).Bun?.markdown;
  if (typeof markdown?.html === "function") {
    return markdown.html(content, {
      autolinks: true,
      headings: { ids: true },
      tagFilter: true,
    });
  }

  return `<pre>${escapeHtml(content)}</pre>`;
}

function renderRouteFallback(route: LocalSiteRouteResult): string {
  if (route.kind === "item") {
    const outboundUrl = route.item.url
      ? `<a class="outbound" href="${escapeHtml(route.item.url)}" rel="noreferrer" target="_blank">${escapeHtml(route.item.url)}</a>`
      : "";
    const excerpt = route.item.excerpt
      ? `<p class="excerpt">${escapeHtml(route.item.excerpt)}</p>`
      : "";
    const tags = route.item.tags.length
      ? `<p class="tags">${route.item.tags.map((tag) => escapeHtml(tag.name)).join(", ")}</p>`
      : "";
    const body = route.item.body
      ? `<div class="markdown">${renderMarkdownFallback(route.item.body)}</div>`
      : "";

    return `<article class="content" data-route-kind="item">
          <h1>${escapeHtml(route.item.title)}</h1>
          ${excerpt}
          ${outboundUrl}
          ${body}
          ${tags}
        </article>`;
  }

  return `<article class="content not-found" data-route-kind="not-found">
          <h1>Page not found</h1>
          <p>${escapeHtml(route.message)}</p>
        </article>`;
}

function routeTitle(route: LocalSiteRouteResult): string {
  if (route.kind === "item") return route.item.title;
  return "Page not found";
}

function renderSidebarFallback(payload: LocalSiteRoutePayload): string {
  if (payload.items.length === 0) {
    return `<nav class="sidebar" aria-label="Site items"></nav>`;
  }

  return `<nav class="sidebar" aria-label="Site items">
          <ul>
            ${payload.items
              .map((item) => {
                const href = item.path ?? item.url ?? "#";
                const target = item.path ? "" : ` rel="noreferrer" target="_blank"`;
                return `<li><a href="${escapeHtml(href)}"${target}>${escapeHtml(item.title)}</a></li>`;
              })
              .join("")}
          </ul>
        </nav>`;
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

function renderSiteHostPage(
  _session: LocalAdminSession | null,
  _project: GraphleLocalProject,
  assetTags: SiteWebClientAssetTags,
  payload: LocalSiteRoutePayload,
): string {
  const route = payload.route;
  const title = routeTitle(route);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
${renderClientAssetTags(assetTags)}
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.5;
        color: #191b1f;
        background: #fbfcfd;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
      }
      .site-fallback-frame {
        display: flex;
        min-height: 100vh;
      }
      .site-fallback-frame .content > h1 {
        max-width: 720px;
        margin: 0;
        font-size: clamp(2.2rem, 8vw, 4.7rem);
        line-height: 1;
        letter-spacing: 0;
      }
      .site-fallback-frame p {
        max-width: 620px;
        margin: 0;
        color: #56606f;
        font-size: 1.05rem;
      }
      .site-fallback-frame .content {
        display: grid;
        width: min(100%, 52rem);
        min-height: 100vh;
        margin: 0 auto;
        padding: clamp(2rem, 6vw, 5rem) clamp(1.25rem, 4vw, 3.5rem);
        align-content: start;
        gap: 20px;
      }
      .site-fallback-frame .markdown {
        display: grid;
        max-width: 720px;
        gap: 14px;
        color: #252b33;
        font-size: 1.05rem;
        line-height: 1.75;
      }
      .site-fallback-frame .markdown > * {
        margin: 0;
      }
      .site-fallback-frame .markdown h1 {
        max-width: 720px;
        color: #191b1f;
        font-size: clamp(2.2rem, 8vw, 4.7rem);
        font-weight: 650;
        line-height: 1;
        letter-spacing: 0;
        overflow-wrap: anywhere;
      }
      .site-fallback-frame .markdown h2 {
        margin-top: 24px;
        color: #191b1f;
        font-size: clamp(1.35rem, 3vw, 2rem);
        font-weight: 650;
        line-height: 1.2;
        letter-spacing: 0;
      }
      .site-fallback-frame .markdown h3 {
        margin-top: 12px;
        color: #191b1f;
        font-size: 1.12rem;
        font-weight: 650;
        line-height: 1.16;
        letter-spacing: 0;
      }
      .site-fallback-frame .markdown ul,
      .site-fallback-frame .markdown ol {
        display: grid;
        gap: 7px;
        padding-left: 22px;
      }
      .site-fallback-frame .markdown a {
        color: #145b7e;
      }
      .site-fallback-frame .excerpt {
        color: #4f5a68;
        font-size: 1.15rem;
      }
      .site-fallback-frame .outbound {
        max-width: 100%;
        overflow-wrap: anywhere;
        color: #145b7e;
        font-weight: 600;
        text-decoration: none;
      }
      .site-fallback-frame .tags {
        margin: 0;
        color: #66707e;
        font-size: 0.9rem;
      }
      .site-fallback-frame .sidebar {
        flex: 0 0 15rem;
        border-right: 1px solid #e3e6ea;
        background: #ffffff;
        padding: 12px 8px;
      }
      .site-fallback-frame .sidebar ul {
        display: grid;
        gap: 2px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .site-fallback-frame .sidebar a {
        display: block;
        min-width: 0;
        overflow-wrap: anywhere;
        border-radius: 6px;
        color: #22262d;
        padding: 7px 8px;
        text-decoration: none;
      }
      .site-fallback-frame .sidebar a:hover {
        background: #f3f5f7;
      }
      @media (max-width: 760px) {
        .site-fallback-frame {
          flex-direction: column;
        }
        .site-fallback-frame .sidebar {
          flex-basis: auto;
          width: 100%;
          border-right: 0;
          border-bottom: 1px solid #e3e6ea;
        }
        .site-fallback-frame .content {
          min-height: 0;
        }
      }
    </style>
  </head>
  <body>
    <div id="root">
      <main class="site-fallback-frame">
        ${renderSidebarFallback(payload)}
        ${renderRouteFallback(route)}
      </main>
    </div>
  </body>
</html>`;
}

function readApiEntityId(pathname: string, collectionPath: string): string | undefined {
  const prefix = `${collectionPath}/`;
  if (!pathname.startsWith(prefix)) return undefined;
  const id = pathname.slice(prefix.length);
  if (id.length === 0 || id.includes("/")) return undefined;
  return decodeURIComponent(id);
}

function requireSiteAuthority(authority: LocalSiteAuthority | undefined): LocalSiteAuthority {
  if (authority) return authority;
  throw new Error("The local site authority is unavailable.");
}

function validationResponse(issues: readonly LocalSiteValidationIssue[]): Response {
  return jsonResponse(
    {
      error: "Invalid site input.",
      code: "site.validation_failed",
      issues,
    },
    400,
  );
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

function readGraphValidationIssues(
  error: unknown,
): readonly LocalSiteValidationIssue[] | undefined {
  if (!error || typeof error !== "object") return undefined;
  const result = (error as { readonly result?: unknown }).result;
  if (!result || typeof result !== "object") return undefined;
  const issues = (result as { readonly issues?: unknown }).issues;
  if (!Array.isArray(issues)) return undefined;

  return issues.flatMap((issue) => {
    if (!issue || typeof issue !== "object") return [];
    const candidate = issue as {
      readonly path?: unknown;
      readonly code?: unknown;
      readonly message?: unknown;
    };
    return [
      {
        path: Array.isArray(candidate.path) ? candidate.path.join(".") : "body",
        code: typeof candidate.code === "string" ? candidate.code : "site.graph_validation",
        message:
          typeof candidate.message === "string" ? candidate.message : "Graph validation failed.",
      },
    ];
  });
}

function siteApiErrorResponse(error: unknown): Response {
  if (error instanceof LocalSiteValidationError) {
    return validationResponse(error.issues);
  }
  if (error instanceof LocalSiteNotFoundError) {
    return errorResponse(error.message, error.code, 404);
  }

  const graphIssues = readGraphValidationIssues(error);
  if (graphIssues) {
    return validationResponse(graphIssues);
  }

  if (error instanceof Error && error.message === "The local site authority is unavailable.") {
    return errorResponse(error.message, "site.authority_unavailable", 503);
  }

  return errorResponse("Site request failed.", "site.request_failed", 500);
}

async function siteApiResponse(action: () => unknown): Promise<Response> {
  try {
    return jsonResponse(await action());
  } catch (error) {
    return siteApiErrorResponse(error);
  }
}

export function createGraphleLocalServer({
  project,
  sqlite,
  auth,
  siteAuthority,
  siteWebAssetsPath = graphleSiteWebClientAssetsPath,
  now = () => new Date(),
}: CreateGraphleLocalServerOptions): GraphleLocalServer {
  const startedAt = now().toISOString();
  let assetTagsPromise: Promise<SiteWebClientAssetTags> | undefined;

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

      if (url.pathname === "/api/site/route") {
        if (request.method !== "GET") {
          return methodNotAllowed("GET");
        }
        const session = auth.getSession(cookieHeader);
        return jsonResponse(
          readLocalSiteRoutePayload(siteAuthority, url.searchParams.get("path") ?? "/", {
            includePrivate: session !== null,
          }),
        );
      }

      if (url.pathname === "/api/site/items") {
        const session = auth.getSession(cookieHeader);
        if (request.method === "GET") {
          if (!session) {
            return authRequiredResponse();
          }
          return siteApiResponse(() => ({
            items: listLocalSiteItems(requireSiteAuthority(siteAuthority)),
          }));
        }
        if (request.method === "POST") {
          if (!session) {
            return authRequiredResponse();
          }
          return siteApiResponse(async () => ({
            item: await createLocalSiteItem(
              requireSiteAuthority(siteAuthority),
              await readJsonBody(request),
              {
                now,
              },
            ),
          }));
        }
        return methodNotAllowed("GET, POST");
      }

      if (url.pathname === "/api/site/items/order") {
        if (request.method !== "PATCH") {
          return methodNotAllowed("PATCH");
        }
        const session = auth.getSession(cookieHeader);
        if (!session) {
          return authRequiredResponse();
        }
        return siteApiResponse(async () => ({
          items: await reorderLocalSiteItems(
            requireSiteAuthority(siteAuthority),
            await readJsonBody(request),
            { now },
          ),
        }));
      }

      const itemId = readApiEntityId(url.pathname, "/api/site/items");
      if (itemId !== undefined) {
        const session = auth.getSession(cookieHeader);
        if (!session) {
          return authRequiredResponse();
        }
        if (request.method === "DELETE") {
          return siteApiResponse(async () => {
            await deleteLocalSiteItem(requireSiteAuthority(siteAuthority), itemId);
            return { ok: true };
          });
        }
        if (request.method !== "PATCH") {
          return methodNotAllowed("PATCH, DELETE");
        }
        return siteApiResponse(async () => ({
          item: await updateLocalSiteItem(
            requireSiteAuthority(siteAuthority),
            itemId,
            await readJsonBody(request),
            { now },
          ),
        }));
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

      const session = auth.getSession(cookieHeader);
      const payload = readLocalSiteRoutePayload(siteAuthority, url.pathname, {
        includePrivate: session !== null,
      });
      return new Response(
        request.method === "HEAD"
          ? null
          : renderSiteHostPage(session, project, await loadAssetTags(), payload),
        {
          status: payload.route.kind === "not-found" ? 404 : 200,
          headers: {
            "cache-control": "no-store",
            "content-type": "text/html; charset=utf-8",
          },
        },
      );
    },
  };
}
