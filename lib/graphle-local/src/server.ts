import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

import type { GraphleSqliteHandle } from "@dpeek/graphle-sqlite";
import { graphleSiteWebClientAssetsPath } from "@dpeek/graphle-site-web/assets";

import type { LocalAuthController, LocalAdminSession } from "./auth.js";
import type { GraphleLocalProject } from "./project.js";
import {
  createLocalSitePage,
  createLocalSitePost,
  listLocalSitePages,
  listLocalSitePosts,
  LocalSiteNotFoundError,
  LocalSiteValidationError,
  readLocalSiteAuthorityHealth,
  resolveLocalSiteRoute,
  updateLocalSitePage,
  updateLocalSitePost,
  type LocalSiteAuthority,
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
  if (route.kind === "page") {
    return `<article class="content" data-route-kind="page">
          <h1>${escapeHtml(route.page.title)}</h1>
          <div class="markdown">${renderMarkdownFallback(route.page.body)}</div>
        </article>`;
  }

  if (route.kind === "post") {
    const publishedAt = route.post.publishedAt
      ? `<time datetime="${escapeHtml(route.post.publishedAt)}">${escapeHtml(route.post.publishedAt.slice(0, 10))}</time>`
      : "";
    return `<article class="content" data-route-kind="post">
          <div class="post-meta">${publishedAt}</div>
          <h1>${escapeHtml(route.post.title)}</h1>
          <p class="excerpt">${escapeHtml(route.post.excerpt)}</p>
          <div class="markdown">${renderMarkdownFallback(route.post.body)}</div>
        </article>`;
  }

  return `<article class="content not-found" data-route-kind="not-found">
          <p class="eyebrow">404</p>
          <h1>Page not found</h1>
          <p>${escapeHtml(route.message)}</p>
        </article>`;
}

function routeTitle(route: LocalSiteRouteResult): string {
  if (route.kind === "page") return route.page.title;
  if (route.kind === "post") return route.post.title;
  return "Page not found";
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
  session: LocalAdminSession | null,
  project: GraphleLocalProject,
  assetTags: SiteWebClientAssetTags,
  route: LocalSiteRouteResult,
): string {
  const authenticated = session !== null;
  const statusLabel = authenticated ? "Admin session active" : "Visitor preview";
  const authoringLabel = authenticated ? "Inline authoring available" : "Inline authoring locked";
  const title = routeTitle(route);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)} - Graphle Local Site</title>
${renderClientAssetTags(assetTags)}
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.5;
        color: #1c2420;
        background: #f7f7f2;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
      }
      header,
      main {
        width: min(960px, calc(100% - 32px));
        margin: 0 auto;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        min-height: 76px;
        border-bottom: 1px solid #d7dbd2;
      }
      main {
        display: grid;
        gap: 28px;
        padding: 48px 0;
      }
      h1 {
        max-width: 720px;
        margin: 0;
        font-size: clamp(2.2rem, 8vw, 4.7rem);
        line-height: 1;
        letter-spacing: 0;
      }
      p {
        max-width: 620px;
        margin: 0;
        color: #526159;
        font-size: 1.05rem;
      }
      .content {
        display: grid;
        gap: 20px;
      }
      .markdown {
        display: grid;
        max-width: 720px;
        gap: 14px;
        color: #26342d;
      }
      .markdown > * {
        margin: 0;
      }
      .markdown h1,
      .markdown h2,
      .markdown h3 {
        line-height: 1.16;
        letter-spacing: 0;
      }
      .markdown a {
        color: #145b7e;
      }
      .excerpt {
        color: #49564f;
        font-size: 1.15rem;
      }
      .eyebrow,
      .post-meta {
        color: #7d4e2f;
        font-size: 0.76rem;
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
      }
      .brand {
        font-weight: 700;
      }
      .status {
        display: inline-flex;
        align-items: center;
        min-height: 32px;
        padding: 0 12px;
        border: 1px solid #bbc5ba;
        border-radius: 8px;
        background: #ffffff;
        color: #28352f;
        font-size: 0.92rem;
        white-space: nowrap;
      }
      .panel {
        display: grid;
        gap: 12px;
        padding-top: 24px;
        border-top: 1px solid #d7dbd2;
      }
      .state {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
        color: #28352f;
      }
      code {
        padding: 3px 6px;
        border-radius: 6px;
        background: #e8ece5;
        font: 0.95em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      @media (max-width: 640px) {
        header {
          align-items: flex-start;
          flex-direction: column;
          justify-content: center;
          padding: 16px 0;
        }
        main {
          padding: 40px 0;
        }
        .status {
          white-space: normal;
        }
      }
    </style>
  </head>
  <body>
    <div id="root">
      <header>
        <div class="brand">Graphle local site</div>
        <div class="status" data-authenticated="${String(authenticated)}">${statusLabel}</div>
      </header>
      <main>
        ${renderRouteFallback(route)}
        <section class="panel" aria-label="Local authoring state">
          <div class="state">
            <strong>${authoringLabel}</strong>
            <span>Project <code>${escapeHtml(project.projectId)}</code></span>
          </div>
        </section>
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

      if (url.pathname === "/api/site/route") {
        if (request.method !== "GET") {
          return methodNotAllowed("GET");
        }
        const session = auth.getSession(cookieHeader);
        return jsonResponse(
          resolveLocalSiteRoute(siteAuthority, url.searchParams.get("path") ?? "/", {
            includeDrafts: session !== null,
          }),
        );
      }

      if (url.pathname === "/api/site/pages") {
        const session = auth.getSession(cookieHeader);
        if (request.method === "GET") {
          if (!session) {
            return errorResponse("Authentication required.", "auth.required", 401);
          }
          return siteApiResponse(() => ({
            pages: listLocalSitePages(requireSiteAuthority(siteAuthority)),
          }));
        }
        if (request.method === "POST") {
          if (!session) {
            return errorResponse("Authentication required.", "auth.required", 401);
          }
          return siteApiResponse(async () => ({
            page: await createLocalSitePage(
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

      const pageId = readApiEntityId(url.pathname, "/api/site/pages");
      if (pageId !== undefined) {
        if (request.method !== "PATCH") {
          return methodNotAllowed("PATCH");
        }
        const session = auth.getSession(cookieHeader);
        if (!session) {
          return errorResponse("Authentication required.", "auth.required", 401);
        }
        return siteApiResponse(async () => ({
          page: await updateLocalSitePage(
            requireSiteAuthority(siteAuthority),
            pageId,
            await readJsonBody(request),
          ),
        }));
      }

      if (url.pathname === "/api/site/posts") {
        const session = auth.getSession(cookieHeader);
        if (request.method === "GET") {
          if (!session) {
            return errorResponse("Authentication required.", "auth.required", 401);
          }
          return siteApiResponse(() => ({
            posts: listLocalSitePosts(requireSiteAuthority(siteAuthority)),
          }));
        }
        if (request.method === "POST") {
          if (!session) {
            return errorResponse("Authentication required.", "auth.required", 401);
          }
          return siteApiResponse(async () => ({
            post: await createLocalSitePost(
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

      const postId = readApiEntityId(url.pathname, "/api/site/posts");
      if (postId !== undefined) {
        if (request.method !== "PATCH") {
          return methodNotAllowed("PATCH");
        }
        const session = auth.getSession(cookieHeader);
        if (!session) {
          return errorResponse("Authentication required.", "auth.required", 401);
        }
        return siteApiResponse(async () => ({
          post: await updateLocalSitePost(
            requireSiteAuthority(siteAuthority),
            postId,
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
      const route = resolveLocalSiteRoute(siteAuthority, url.pathname, {
        includeDrafts: session !== null,
      });
      return new Response(
        request.method === "HEAD"
          ? null
          : renderSiteHostPage(session, project, await loadAssetTags(), route),
        {
          status: route.kind === "not-found" ? 404 : 200,
          headers: {
            "cache-control": "no-store",
            "content-type": "text/html; charset=utf-8",
          },
        },
      );
    },
  };
}
