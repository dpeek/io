import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { GraphleSiteShell } from "./site-app.js";

describe("GraphleSiteShell", () => {
  it("mounts the site feature inside the generic shell", () => {
    const html = renderToStaticMarkup(
      <GraphleSiteShell
        status={{
          state: "ready",
          snapshot: {
            loadedAt: "2026-04-15T00:00:00.000Z",
            health: {
              service: { name: "graphle-local", status: "ok" },
              project: { id: "project-1" },
              database: { opened: true, schemaVersion: 2 },
              graph: { status: "ok", records: { pages: 1, posts: 1 } },
            },
            session: {
              authenticated: true,
              session: { projectId: "project-1", subject: "local-admin" },
            },
            route: {
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
            },
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
          },
        }}
      />,
    );

    expect(html).toContain("Graphle site");
    expect(html).toContain("Site preview");
    expect(html).toContain("Home");
    expect(html).toContain("Edit page");
    expect(html).toContain("New post");
  });
});
