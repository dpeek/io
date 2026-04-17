import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createGraphleSiteHttpGraphClient } from "@dpeek/graphle-site-web";
import { siteVisibilityIdFor } from "@dpeek/graphle-module-site";
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

function createAdminCookieFetch(
  server: ReturnType<typeof createGraphleLocalServer>,
  cookie: string,
) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    headers.set("cookie", cookie);
    return await server.fetch(new Request(request, { headers }));
  };
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
        new Request("http://127.0.0.1:4318/missing", {
          headers: {
            cookie,
          },
        }),
      );
      const html = await response.text();

      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(html).toContain("Page not found");
      expect(html).not.toContain("Admin session active");
      expect(html).not.toContain("Inline authoring available");
      expect(html).not.toContain("Graphle local site");
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
            items: 6,
            tags: 1,
          },
        },
      });
      expect(html).toContain("<h1>Home</h1>");
      expect(html).toContain("Welcome to your new Graphle site.");
      expect(html).not.toContain("Personal site placeholder");
    });
  });

  it("requires local admin auth for graph transport endpoints", async () => {
    await withGraphServer(async ({ server, initToken }) => {
      const unauthenticatedSync = await server.fetch(new Request("http://127.0.0.1:4318/api/sync"));
      const unauthenticatedTx = await server.fetch(
        new Request("http://127.0.0.1:4318/api/tx", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ id: "tx:unauthenticated", ops: [] }),
        }),
      );
      const cookie = await redeemAdminCookie(server, initToken);
      const wrongSyncMethod = await server.fetch(
        new Request("http://127.0.0.1:4318/api/sync", {
          method: "POST",
          headers: { cookie },
        }),
      );
      const wrongTxMethod = await server.fetch(
        new Request("http://127.0.0.1:4318/api/tx", {
          headers: { cookie },
        }),
      );

      expect(unauthenticatedSync.status).toBe(401);
      expect(await unauthenticatedSync.json()).toEqual({
        error: "Authentication required.",
        code: "auth.required",
      });
      expect(unauthenticatedTx.status).toBe(401);
      expect(await unauthenticatedTx.json()).toEqual({
        error: "Authentication required.",
        code: "auth.required",
      });
      expect(wrongSyncMethod.status).toBe(405);
      expect(wrongSyncMethod.headers.get("allow")).toBe("GET");
      expect(wrongTxMethod.status).toBe(405);
      expect(wrongTxMethod.headers.get("allow")).toBe("POST");
    });
  });

  it("returns 503 graph transport responses when the local authority is unavailable", async () => {
    await withServer(async ({ server, initToken }) => {
      const cookie = await redeemAdminCookie(server, initToken);
      const sync = await server.fetch(
        new Request("http://127.0.0.1:4318/api/sync", {
          headers: { cookie },
        }),
      );
      const tx = await server.fetch(
        new Request("http://127.0.0.1:4318/api/tx", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
          },
          body: JSON.stringify({ id: "tx:unavailable", ops: [] }),
        }),
      );

      expect(sync.status).toBe(503);
      expect(await sync.json()).toEqual({
        error: "The local site authority is unavailable.",
        code: "graph.authority_unavailable",
      });
      expect(tx.status).toBe(503);
      expect(await tx.json()).toEqual({
        error: "The local site authority is unavailable.",
        code: "graph.authority_unavailable",
      });
    });
  });

  it("serves authenticated total and incremental graph sync payloads", async () => {
    await withGraphServer(async ({ server, initToken }) => {
      const cookie = await redeemAdminCookie(server, initToken);
      const total = await server.fetch(
        new Request("http://127.0.0.1:4318/api/sync", {
          headers: { cookie },
        }),
      );
      const totalPayload = (await total.json()) as {
        readonly mode: "total";
        readonly cursor: string;
        readonly snapshot: { readonly edges: readonly { readonly o: string }[] };
      };
      const incremental = await server.fetch(
        new Request(
          `http://127.0.0.1:4318/api/sync?after=${encodeURIComponent(totalPayload.cursor)}`,
          {
            headers: { cookie },
          },
        ),
      );

      expect(total.status).toBe(200);
      expect(total.headers.get("cache-control")).toBe("no-store");
      expect(totalPayload.mode).toBe("total");
      expect(totalPayload.snapshot.edges.some((edge) => edge.o === "Home")).toBe(true);
      expect(incremental.status).toBe(200);
      expect(await incremental.json()).toMatchObject({
        mode: "incremental",
        after: totalPayload.cursor,
        transactions: [],
      });
    });
  });

  it("returns useful graph transaction parse and validation errors", async () => {
    await withGraphServer(async ({ server, initToken }) => {
      const cookie = await redeemAdminCookie(server, initToken);
      const malformed = await server.fetch(
        new Request("http://127.0.0.1:4318/api/tx", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
          },
          body: "{",
        }),
      );
      const validation = await server.fetch(
        new Request("http://127.0.0.1:4318/api/tx", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
          },
          body: JSON.stringify({ id: "tx:empty", ops: [] }),
        }),
      );

      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toEqual({
        error: "Request body must be valid JSON.",
        code: "graph.body_invalid",
      });
      expect(validation.status).toBe(400);
      expect(await validation.json()).toMatchObject({
        error: "Invalid graph transaction.",
        code: "graph.validation_failed",
        issues: [
          {
            code: "sync.tx.ops.empty",
            message: 'Field "ops" must contain at least one operation.',
          },
        ],
      });
    });
  });

  it("syncs, writes, and persists site graph records through createHttpGraphClient", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphle-local-server-graph-transport-"));
    const project = await prepareLocalProject({
      cwd,
      generateAuthSecret: () => "secret",
      generateProjectId: () => "project-1",
    });
    const firstSqlite = await openGraphleSqlite({ path: project.databasePath });
    const firstAuthority = await openLocalSiteAuthority({
      sqlite: firstSqlite,
      now: () => new Date("2026-04-15T00:00:00.000Z"),
    });
    const auth = createLocalAuthController({
      authSecret: project.authSecret,
      projectId: project.projectId,
      initToken: "init-token",
      now: () => new Date("2026-04-15T00:00:00.000Z"),
    });
    const firstServer = createGraphleLocalServer({
      project,
      sqlite: firstSqlite,
      auth,
      siteAuthority: firstAuthority,
      now: () => new Date("2026-04-15T00:00:00.000Z"),
    });

    let itemId = "";
    try {
      const cookie = await redeemAdminCookie(firstServer, auth.initToken);
      const fetcher = createAdminCookieFetch(firstServer, cookie);
      const client = await createGraphleSiteHttpGraphClient({
        url: "http://127.0.0.1:4318/",
        fetch: fetcher,
        createTxId: () => "tx:site-web-client:1",
      });

      expect(client.graph.item.list().some((item) => item.title === "Home")).toBe(true);
      itemId = client.graph.item.create({
        title: "Graph transport",
        path: "/graph-transport",
        body: "# Graph transport\n\nWritten through /api/tx.",
        visibility: siteVisibilityIdFor("public"),
        tags: [],
        pinned: false,
      });
      expect(client.sync.getPendingTransactions()).toHaveLength(1);
      await client.sync.flush();

      const followupClient = await createGraphleSiteHttpGraphClient({
        url: "http://127.0.0.1:4318/",
        fetch: fetcher,
        createTxId: () => "tx:site-web-client:2",
      });
      expect(followupClient.graph.item.get(itemId)).toMatchObject({
        title: "Graph transport",
        path: "/graph-transport",
        visibility: siteVisibilityIdFor("public"),
      });
    } finally {
      firstSqlite.close();
    }

    const secondSqlite = await openGraphleSqlite({ path: project.databasePath });
    const secondAuthority = await openLocalSiteAuthority({
      sqlite: secondSqlite,
      now: () => new Date("2026-04-15T00:00:00.000Z"),
    });
    const secondServer = createGraphleLocalServer({
      project,
      sqlite: secondSqlite,
      auth,
      siteAuthority: secondAuthority,
      now: () => new Date("2026-04-15T00:00:00.000Z"),
    });

    try {
      const route = await secondServer.fetch(
        new Request("http://127.0.0.1:4318/api/site/route?path=%2Fgraph-transport"),
      );

      expect(itemId).not.toBe("");
      expect(await route.json()).toMatchObject({
        route: {
          kind: "item",
          item: {
            id: itemId,
            title: "Graph transport",
          },
        },
      });
    } finally {
      secondSqlite.close();
      await rm(cwd, { force: true, recursive: true });
    }
  });

  it("exposes site route, list, create, update, URL-only, and visibility APIs", async () => {
    await withGraphServer(async ({ server, initToken }) => {
      const unauthenticatedItems = await server.fetch(
        new Request("http://127.0.0.1:4318/api/site/items"),
      );
      const cookie = await redeemAdminCookie(server, initToken);
      const unauthenticatedWrite = await server.fetch(
        new Request("http://127.0.0.1:4318/api/site/items", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            title: "No auth",
            body: "No auth.",
          }),
        }),
      );
      const invalidPublicItem = await server.fetch(
        new Request("http://127.0.0.1:4318/api/site/items", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
          },
          body: JSON.stringify({
            title: "Empty public item",
            visibility: "public",
          }),
        }),
      );
      const createdItem = await server.fetch(
        new Request("http://127.0.0.1:4318/api/site/items", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
          },
          body: JSON.stringify({
            title: "Work",
            path: "/work",
            body: "# Work\n\nPrivate item.",
            visibility: "private",
            tags: ["work"],
          }),
        }),
      );
      const createdItemPayload = (await createdItem.json()) as {
        readonly item: { readonly id: string };
      };
      const unauthenticatedPrivate = await server.fetch(
        new Request("http://127.0.0.1:4318/api/site/route?path=%2Fwork"),
      );
      const authenticatedPrivate = await server.fetch(
        new Request("http://127.0.0.1:4318/api/site/route?path=%2Fwork", {
          headers: { cookie },
        }),
      );
      const publishedItem = await server.fetch(
        new Request(
          `http://127.0.0.1:4318/api/site/items/${encodeURIComponent(createdItemPayload.item.id)}`,
          {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              cookie,
            },
            body: JSON.stringify({
              title: "Work",
              path: "/work",
              body: "# Work\n\nPublic item.",
              visibility: "public",
              pinned: true,
              sortOrder: 2,
            }),
          },
        ),
      );
      const routeAfterPublish = await server.fetch(
        new Request("http://127.0.0.1:4318/api/site/route?path=%2Fwork"),
      );
      const createdLink = await server.fetch(
        new Request("http://127.0.0.1:4318/api/site/items", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
          },
          body: JSON.stringify({
            title: "Public link",
            url: "https://example.com/public-link",
            excerpt: "A URL-only public link.",
            visibility: "public",
            tags: ["links"],
          }),
        }),
      );
      const blankItem = await server.fetch(
        new Request("http://127.0.0.1:4318/api/site/items", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
          },
          body: JSON.stringify({ intent: "blank" }),
        }),
      );
      const blankItemPayload = (await blankItem.json()) as {
        readonly item: { readonly id: string; readonly path: string };
      };
      const reordered = await server.fetch(
        new Request("http://127.0.0.1:4318/api/site/items/order", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            cookie,
          },
          body: JSON.stringify({
            items: [
              { id: blankItemPayload.item.id, sortOrder: 0 },
              { id: createdItemPayload.item.id, sortOrder: 1 },
            ],
          }),
        }),
      );
      const deleted = await server.fetch(
        new Request(
          `http://127.0.0.1:4318/api/site/items/${encodeURIComponent(blankItemPayload.item.id)}`,
          {
            method: "DELETE",
            headers: {
              cookie,
            },
          },
        ),
      );
      const listAfterDelete = await server.fetch(
        new Request("http://127.0.0.1:4318/api/site/items", {
          headers: { cookie },
        }),
      );
      const workPage = await server.fetch(new Request("http://127.0.0.1:4318/work"));
      const publicHomeRoute = await server.fetch(
        new Request("http://127.0.0.1:4318/api/site/route?path=%2F"),
      );

      expect(unauthenticatedItems.status).toBe(401);
      expect(unauthenticatedWrite.status).toBe(401);
      expect(invalidPublicItem.status).toBe(400);
      expect(await invalidPublicItem.json()).toMatchObject({
        code: "site.validation_failed",
      });
      expect(createdItem.status).toBe(200);
      expect(await unauthenticatedPrivate.json()).toMatchObject({
        route: {
          kind: "not-found",
        },
      });
      expect(await authenticatedPrivate.json()).toMatchObject({
        route: {
          kind: "item",
          item: {
            title: "Work",
            visibility: "private",
          },
        },
      });
      expect(publishedItem.status).toBe(200);
      expect(await routeAfterPublish.json()).toMatchObject({
        route: {
          kind: "item",
          item: {
            title: "Work",
            visibility: "public",
            pinned: true,
            tags: [
              {
                key: "work",
              },
            ],
          },
        },
      });
      expect(createdLink.status).toBe(200);
      expect(blankItem.status).toBe(200);
      expect(blankItemPayload.item.path).toBe("/untitled");
      expect(reordered.status).toBe(200);
      expect(await reordered.json()).toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({
            id: blankItemPayload.item.id,
            sortOrder: 0,
          }),
          expect.objectContaining({
            id: createdItemPayload.item.id,
            sortOrder: 1,
          }),
        ]),
      });
      expect(deleted.status).toBe(200);
      expect(await deleted.json()).toEqual({ ok: true });
      const itemsAfterDelete = (
        (await listAfterDelete.json()) as {
          readonly items: readonly { readonly id: string }[];
        }
      ).items;
      expect(itemsAfterDelete.some((item) => item.id === blankItemPayload.item.id)).toBe(false);
      expect(workPage.status).toBe(200);
      expect(await workPage.text()).toContain("Public item.");
      expect(await publicHomeRoute.json()).toMatchObject({
        route: {
          kind: "item",
          item: {
            title: "Home",
          },
        },
        items: expect.arrayContaining([
          expect.objectContaining({
            title: "Public link",
            url: "https://example.com/public-link",
          }),
        ]),
      });
    });
  });

  it("keeps item edits durable across local authority reopen", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphle-local-server-persist-"));
    const project = await prepareLocalProject({
      cwd,
      generateAuthSecret: () => "secret",
      generateProjectId: () => "project-1",
    });
    const firstSqlite = await openGraphleSqlite({ path: project.databasePath });
    const firstAuthority = await openLocalSiteAuthority({
      sqlite: firstSqlite,
      now: () => new Date("2026-04-15T00:00:00.000Z"),
    });
    const auth = createLocalAuthController({
      authSecret: project.authSecret,
      projectId: project.projectId,
      initToken: "init-token",
      now: () => new Date("2026-04-15T00:00:00.000Z"),
    });
    const firstServer = createGraphleLocalServer({
      project,
      sqlite: firstSqlite,
      auth,
      siteAuthority: firstAuthority,
      now: () => new Date("2026-04-15T00:00:00.000Z"),
    });

    try {
      const cookie = await redeemAdminCookie(firstServer, auth.initToken);
      const created = await firstServer.fetch(
        new Request("http://127.0.0.1:4318/api/site/items", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
          },
          body: JSON.stringify({
            title: "Durable item",
            path: "/durable",
            body: "Survives reopen.",
            visibility: "public",
          }),
        }),
      );
      expect(created.status).toBe(200);
    } finally {
      firstSqlite.close();
    }

    const secondSqlite = await openGraphleSqlite({ path: project.databasePath });
    const secondAuthority = await openLocalSiteAuthority({
      sqlite: secondSqlite,
      now: () => new Date("2026-04-15T00:00:00.000Z"),
    });
    const secondServer = createGraphleLocalServer({
      project,
      sqlite: secondSqlite,
      auth,
      siteAuthority: secondAuthority,
      now: () => new Date("2026-04-15T00:00:00.000Z"),
    });

    try {
      const route = await secondServer.fetch(
        new Request("http://127.0.0.1:4318/api/site/route?path=%2Fdurable"),
      );

      expect(await route.json()).toMatchObject({
        route: {
          kind: "item",
          item: {
            title: "Durable item",
          },
        },
      });
    } finally {
      secondSqlite.close();
      await rm(cwd, { force: true, recursive: true });
    }
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
