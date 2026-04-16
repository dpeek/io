import { describe, expect, it } from "bun:test";

import { loadGraphleSiteStatus, type GraphleSiteStatusFetcher } from "./status.js";

describe("loadGraphleSiteStatus", () => {
  it("loads health and session from existing local API routes", async () => {
    const paths: string[] = [];
    const fetcher: GraphleSiteStatusFetcher = async (input) => {
      const path = String(input);
      paths.push(path);

      if (path === "/api/health") {
        return Response.json({
          ok: true,
          service: { name: "graphle-local", status: "ok" },
          project: { id: "project-1" },
          graph: { status: "ok", records: { pages: 1, posts: 1 } },
        });
      }

      if (path === "/api/session") {
        return Response.json({
          authenticated: true,
          session: { projectId: "project-1", subject: "local-admin" },
        });
      }

      if (path === "/api/site/route?path=%2F") {
        return Response.json({
          kind: "page",
          path: "/",
          page: {
            id: "page-1",
            title: "Home",
            path: "/",
            body: "# Home",
            status: "published",
            updatedAt: "2026-04-15T00:00:00.000Z",
          },
        });
      }

      if (path === "/api/site/pages") {
        return Response.json({
          pages: [
            {
              id: "page-1",
              title: "Home",
              path: "/",
              body: "# Home",
              status: "published",
              updatedAt: "2026-04-15T00:00:00.000Z",
            },
          ],
        });
      }

      if (path === "/api/site/posts") {
        return Response.json({
          posts: [
            {
              id: "post-1",
              title: "Example post",
              slug: "example-post",
              body: "# Example",
              excerpt: "A short example post.",
              publishedAt: "2026-04-15T00:00:00.000Z",
              status: "published",
              updatedAt: "2026-04-15T00:00:00.000Z",
            },
          ],
        });
      }

      return new Response("not found", { status: 404 });
    };

    const snapshot = await loadGraphleSiteStatus({
      fetcher,
      now: () => new Date("2026-04-15T00:00:00.000Z"),
    });

    expect(paths.sort()).toEqual([
      "/api/health",
      "/api/session",
      "/api/site/pages",
      "/api/site/posts",
      "/api/site/route?path=%2F",
    ]);
    expect(snapshot.loadedAt).toBe("2026-04-15T00:00:00.000Z");
    expect(snapshot.session.authenticated).toBe(true);
    expect(snapshot.health.graph?.records?.pages).toBe(1);
    expect(snapshot.route.kind).toBe("page");
    expect(snapshot.pages).toHaveLength(1);
    expect(snapshot.posts).toHaveLength(1);
  });
});
