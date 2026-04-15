import type { GraphleSqliteHandle } from "@dpeek/graphle-sqlite";

import type { LocalAuthController, LocalAdminSession } from "./auth.js";
import type { GraphleLocalProject } from "./project.js";

export interface GraphleLocalServer {
  fetch(request: Request): Promise<Response> | Response;
}

export interface CreateGraphleLocalServerOptions {
  readonly project: GraphleLocalProject;
  readonly sqlite: GraphleSqliteHandle;
  readonly auth: LocalAuthController;
  readonly now?: () => Date;
}

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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderPlaceholderPage(
  session: LocalAdminSession | null,
  project: GraphleLocalProject,
): string {
  const authenticated = session !== null;
  const statusLabel = authenticated ? "Admin session active" : "Visitor preview";
  const authoringLabel = authenticated ? "Inline authoring available" : "Inline authoring locked";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Graphle Local Site</title>
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
        gap: 32px;
        padding: 56px 0;
      }
      h1 {
        max-width: 720px;
        margin: 0;
        font-size: clamp(2.4rem, 8vw, 5rem);
        line-height: 0.96;
        letter-spacing: 0;
      }
      p {
        max-width: 620px;
        margin: 0;
        color: #526159;
        font-size: 1.05rem;
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
    <header>
      <div class="brand">Graphle local site</div>
      <div class="status" data-authenticated="${String(authenticated)}">${statusLabel}</div>
    </header>
    <main>
      <section>
        <h1>Personal site placeholder</h1>
        <p>This page is served from ${escapeHtml(project.cwd)} while the site schema and editor surfaces are added in later phases.</p>
      </section>
      <section class="panel" aria-label="Local authoring state">
        <div class="state">
          <strong>${authoringLabel}</strong>
          <span>Project <code>${escapeHtml(project.projectId)}</code></span>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

export function createGraphleLocalServer({
  project,
  sqlite,
  auth,
  now = () => new Date(),
}: CreateGraphleLocalServerOptions): GraphleLocalServer {
  const startedAt = now().toISOString();

  return {
    fetch(request) {
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

      if (url.pathname.startsWith("/api/")) {
        return jsonResponse(
          {
            error: `API route "${url.pathname}" was not found.`,
            code: "not-found",
          },
          404,
        );
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        return methodNotAllowed("GET, HEAD");
      }

      const session = auth.getSession(cookieHeader);
      return new Response(
        request.method === "HEAD" ? null : renderPlaceholderPage(session, project),
        {
          status: 200,
          headers: {
            "cache-control": "no-store",
            "content-type": "text/html; charset=utf-8",
          },
        },
      );
    },
  };
}
