import { mkdtemp, rm } from "node:fs/promises";
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

  it("returns placeholder HTML for non-api routes with visible auth state", async () => {
    await withServer(async ({ server, initToken }) => {
      const init = await server.fetch(
        new Request(`http://127.0.0.1:4318/api/init?token=${initToken}`),
      );
      const signedCookie = parseCookieHeader(init.headers.get("set-cookie")).get(
        graphleAdminCookieName,
      );
      const response = await server.fetch(
        new Request("http://127.0.0.1:4318/posts/example", {
          headers: {
            cookie: `${graphleAdminCookieName}=${signedCookie}`,
          },
        }),
      );
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(html).toContain("Personal site placeholder");
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
    } finally {
      sqlite.close();
      await rm(cwd, { force: true, recursive: true });
    }
  });
});
