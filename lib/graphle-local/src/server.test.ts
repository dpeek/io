import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openGraphleSqlite } from "@dpeek/graphle-sqlite";
import { describe, expect, it } from "bun:test";

import { createLocalAuthController, graphleAdminCookieName, parseCookieHeader } from "./auth.js";
import { prepareLocalProject } from "./project.js";
import { createGraphleLocalServer } from "./server.js";
import { openLocalSiteAuthority } from "./site-authority.js";

async function withServer<T>(
  run: (input: {
    readonly server: ReturnType<typeof createGraphleLocalServer>;
    readonly initToken: string;
  }) => Promise<T>,
): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), "graphle-local-server-"));
  const project = await prepareLocalProject({
    cwd,
    generateAuthSecret: () => "secret",
    generateProjectId: () => "project-1",
  });
  const sqlite = await openGraphleSqlite({ path: project.databasePath });
  const auth = createLocalAuthController({
    authSecret: project.authSecret,
    projectId: project.projectId,
    initToken: "init-token",
    now: () => new Date("2026-04-15T00:00:00.000Z"),
  });
  const server = createGraphleLocalServer({
    project,
    sqlite,
    auth,
    now: () => new Date("2026-04-15T00:00:00.000Z"),
  });

  try {
    return await run({
      server,
      initToken: auth.initToken,
    });
  } finally {
    sqlite.close();
    await rm(cwd, { force: true, recursive: true });
  }
}

async function withGraphServer<T>(
  run: (input: {
    readonly server: ReturnType<typeof createGraphleLocalServer>;
    readonly initToken: string;
  }) => Promise<T>,
): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), "graphle-local-server-graph-"));
  const project = await prepareLocalProject({
    cwd,
    generateAuthSecret: () => "secret",
    generateProjectId: () => "project-1",
  });
  const sqlite = await openGraphleSqlite({ path: project.databasePath });
  const siteAuthority = await openLocalSiteAuthority({
    sqlite,
    now: () => new Date("2026-04-15T00:00:00.000Z"),
  });
  const auth = createLocalAuthController({
    authSecret: project.authSecret,
    projectId: project.projectId,
    initToken: "init-token",
    now: () => new Date("2026-04-15T00:00:00.000Z"),
  });
  const server = createGraphleLocalServer({
    project,
    sqlite,
    auth,
    siteAuthority,
    now: () => new Date("2026-04-15T00:00:00.000Z"),
  });

  try {
    return await run({
      server,
      initToken: auth.initToken,
    });
  } finally {
    sqlite.close();
    await rm(cwd, { force: true, recursive: true });
  }
}

async function redeemAdminCookie(
  server: ReturnType<typeof createGraphleLocalServer>,
  initToken: string,
): Promise<string> {
  const init = await server.fetch(new Request(`http://127.0.0.1:4318/api/init?token=${initToken}`));
  const signedCookie = parseCookieHeader(init.headers.get("set-cookie")).get(
    graphleAdminCookieName,
  );
  if (!signedCookie) throw new Error("Expected local admin cookie.");
  return `${graphleAdminCookieName}=${signedCookie}`;
}

describe("local server routes", () => {
  it("returns health and unauthenticated session JSON", async () => {
    await withServer(async ({ server }) => {
      const health = await server.fetch(new Request("http://127.0.0.1:4318/api/health"));
      const session = await server.fetch(new Request("http://127.0.0.1:4318/api/session"));

      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({
        ok: true,
        service: {
          name: "graphle-local",
          status: "ok",
          startedAt: "2026-04-15T00:00:00.000Z",
        },
        project: {
          id: "project-1",
        },
        database: {
          opened: true,
          metaTableReady: true,
          schemaVersion: 2,
        },
        graph: {
          status: "unavailable",
        },
      });
      expect(await session.json()).toEqual({
        authenticated: false,
        session: null,
      });
    });
  });

  it("redeems /api/init, sets a cookie, and reports authenticated sessions", async () => {
    await withServer(async ({ server, initToken }) => {
      const init = await server.fetch(
        new Request(`http://127.0.0.1:4318/api/init?token=${initToken}`),
      );
      const cookie = init.headers.get("set-cookie");

      expect(init.status).toBe(302);
      expect(init.headers.get("location")).toBe("/");
      expect(cookie).toContain(`${graphleAdminCookieName}=`);

      const signedCookie = parseCookieHeader(cookie).get(graphleAdminCookieName);
      const session = await server.fetch(
        new Request("http://127.0.0.1:4318/api/session", {
          headers: {
            cookie: `${graphleAdminCookieName}=${signedCookie}`,
          },
        }),
      );

      expect(await session.json()).toEqual({
        authenticated: true,
        session: {
          projectId: "project-1",
          subject: "local-admin",
        },
      });
    });
  });

  it("rejects consumed init tokens without a valid cookie", async () => {
    await withServer(async ({ server, initToken }) => {
      await server.fetch(new Request(`http://127.0.0.1:4318/api/init?token=${initToken}`));
      const second = await server.fetch(
        new Request(`http://127.0.0.1:4318/api/init?token=${initToken}`),
      );

      expect(second.status).toBe(401);
      expect(await second.json()).toEqual({
        error: "The local admin init token is invalid or has already been used.",
        code: "auth.init_token_invalid",
      });
    });
  });

  it("returns a useful 404 host document for missing routes with visible auth state", async () => {
    await withServer(async ({ server, initToken }) => {
      const cookie = await redeemAdminCookie(server, initToken);
      const response = await server.fetch(
        new Request("http://127.0.0.1:4318/posts/example", {
          headers: {
            cookie,
          },
        }),
      );
      const html = await response.text();

      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(html).toContain("Page not found");
      expect(html).toContain("Admin session active");
      expect(html).toContain("Inline authoring available");
    });
  });

  it("returns JSON 404s for unknown api routes", async () => {
    await withServer(async ({ server }) => {
      const response = await server.fetch(new Request("http://127.0.0.1:4318/api/missing"));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: 'API route "/api/missing" was not found.',
        code: "not-found",
      });
    });
  });

  it("reports graph startup health and renders seeded home content", async () => {
    await withGraphServer(async ({ server }) => {
      const health = await server.fetch(new Request("http://127.0.0.1:4318/api/health"));
      const page = await server.fetch(new Request("http://127.0.0.1:4318/"));
      const html = await page.text();

      expect(await health.json()).toMatchObject({
        graph: {
          status: "ok",
          startupDiagnostics: {
            recovery: "none",
          },
          records: {
            pages: 1,
            posts: 1,
          },
        },
      });
      expect(html).toContain("<h1>Home</h1>");
      expect(html).toContain("Welcome to your new Graphle site.");
      expect(html).not.toContain("Personal site placeholder");
    });
  });

  it("exposes site route, list, create, update, and draft visibility APIs", async () => {
    await withGraphServer(async ({ server, initToken }) => {
      const unauthenticatedPages = await server.fetch(
        new Request("http://127.0.0.1:4318/api/site/pages"),
      );
      const cookie = await redeemAdminCookie(server, initToken);
      const createdPage = await server.fetch(
        new Request("http://127.0.0.1:4318/api/site/pages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
          },
          body: JSON.stringify({
            title: "Work",
            path: "/work",
            body: "# Work\n\nDraft page.",
            status: "draft",
          }),
        }),
      );
      const createdPagePayload = (await createdPage.json()) as {
        readonly page: { readonly id: string };
      };
      const unauthenticatedDraft = await server.fetch(
        new Request("http://127.0.0.1:4318/api/site/route?path=%2Fwork"),
      );
      const authenticatedDraft = await server.fetch(
        new Request("http://127.0.0.1:4318/api/site/route?path=%2Fwork", {
          headers: { cookie },
        }),
      );
      const publishedPage = await server.fetch(
        new Request(
          `http://127.0.0.1:4318/api/site/pages/${encodeURIComponent(createdPagePayload.page.id)}`,
          {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              cookie,
            },
            body: JSON.stringify({
              title: "Work",
              path: "/work",
              body: "# Work\n\nPublished page.",
              status: "published",
            }),
          },
        ),
      );
      const routeAfterPublish = await server.fetch(
        new Request("http://127.0.0.1:4318/api/site/route?path=%2Fwork"),
      );
      const createdPost = await server.fetch(
        new Request("http://127.0.0.1:4318/api/site/posts", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
          },
          body: JSON.stringify({
            title: "Launch notes",
            slug: "launch-notes",
            body: "# Launch notes",
            excerpt: "What changed in the launch.",
            status: "published",
          }),
        }),
      );
      const postRoute = await server.fetch(new Request("http://127.0.0.1:4318/posts/launch-notes"));

      expect(unauthenticatedPages.status).toBe(401);
      expect(createdPage.status).toBe(200);
      expect(await unauthenticatedDraft.json()).toMatchObject({
        kind: "not-found",
      });
      expect(await authenticatedDraft.json()).toMatchObject({
        kind: "page",
        page: {
          title: "Work",
          status: "draft",
        },
      });
      expect(publishedPage.status).toBe(200);
      expect(await routeAfterPublish.json()).toMatchObject({
        kind: "page",
        page: {
          title: "Work",
          status: "published",
        },
      });
      expect(createdPost.status).toBe(200);
      expect(postRoute.status).toBe(200);
      expect(await postRoute.text()).toContain("Launch notes");
    });
  });

  it("serves package-owned browser assets and keeps the graph-backed host fallback", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphle-local-server-assets-"));
    const assetRoot = join(cwd, "client");
    await mkdir(join(assetRoot, "assets"), { recursive: true });
    await mkdir(join(assetRoot, ".vite"), { recursive: true });
    await writeFile(join(assetRoot, "assets", "main.js"), "console.log('site shell');");
    await writeFile(join(assetRoot, "assets", "main.css"), "body { margin: 0; }");
    await writeFile(
      join(assetRoot, ".vite", "manifest.json"),
      JSON.stringify({
        "index.html": {
          file: "assets/main.js",
          css: ["assets/main.css"],
          isEntry: true,
          src: "src/main.tsx",
        },
      }),
    );

    const project = await prepareLocalProject({
      cwd,
      generateAuthSecret: () => "secret",
      generateProjectId: () => "project-1",
    });
    const sqlite = await openGraphleSqlite({ path: project.databasePath });
    const siteAuthority = await openLocalSiteAuthority({
      sqlite,
      now: () => new Date("2026-04-15T00:00:00.000Z"),
    });
    const auth = createLocalAuthController({
      authSecret: project.authSecret,
      projectId: project.projectId,
      initToken: "init-token",
      now: () => new Date("2026-04-15T00:00:00.000Z"),
    });
    const server = createGraphleLocalServer({
      project,
      sqlite,
      auth,
      siteAuthority,
      siteWebAssetsPath: assetRoot,
      now: () => new Date("2026-04-15T00:00:00.000Z"),
    });

    try {
      const asset = await server.fetch(new Request("http://127.0.0.1:4318/assets/main.js"));
      const missing = await server.fetch(new Request("http://127.0.0.1:4318/assets/missing.js"));
      const page = await server.fetch(new Request("http://127.0.0.1:4318/"));
      const html = await page.text();

      expect(asset.status).toBe(200);
      expect(asset.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
      expect(await asset.text()).toBe("console.log('site shell');");
      expect(missing.status).toBe(404);
      expect(html).toContain('<div id="root">');
      expect(html).toContain('<link rel="stylesheet" href="/assets/main.css">');
      expect(html).toContain('<script type="module" src="/assets/main.js"></script>');
      expect(html).toContain("<h1>Home</h1>");
    } finally {
      sqlite.close();
      await rm(cwd, { force: true, recursive: true });
    }
  });
});
