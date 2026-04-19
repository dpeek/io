import { describe, expect, it } from "bun:test";
import { createSyncedGraphClient } from "@dpeek/graphle-client";
import { siteVisibilityIdFor } from "@dpeek/graphle-module-site";
import { renderToStaticMarkup } from "react-dom/server";

import {
  graphleSiteGraphBootstrapOptions,
  graphleSiteGraphDefinitions,
  graphleSiteGraphNamespace,
} from "./graph.js";
import { GraphleSiteShell } from "./site-app.js";
import { buildGraphleSiteOrderPayload, GraphleSitePreview } from "./site-feature.js";
import type { GraphleSiteStatusState } from "./site-feature.js";
import type { GraphleSiteDeployStatus } from "./status.js";
import { resolveGraphleSiteTheme } from "./theme.js";

function readyStatus({
  authenticated,
  deploy,
}: {
  readonly authenticated: boolean;
  readonly deploy?: GraphleSiteDeployStatus;
}): GraphleSiteStatusState {
  return {
    state: "ready",
    snapshot: {
      loadedAt: "2026-04-15T00:00:00.000Z",
      health: {
        service: { name: "graphle-local", status: "ok" },
        project: { id: "project-1" },
        database: { opened: true, schemaVersion: 2 },
        graph: { status: "ok", records: { items: 2, tags: 1 } },
      },
      session: {
        authenticated,
        session: authenticated ? { projectId: "project-1", subject: "local-admin" } : null,
      },
      ...(deploy ? { deploy } : {}),
      path: "/",
    },
  };
}

function createSiteRuntime() {
  return createSyncedGraphClient(graphleSiteGraphNamespace, {
    bootstrap: graphleSiteGraphBootstrapOptions,
    definitions: graphleSiteGraphDefinitions,
    pull() {
      throw new Error("The site-web render test does not pull remote graph state.");
    },
  });
}

describe("GraphleSiteShell", () => {
  it("mounts the item site feature inside the generic shell", () => {
    const runtime = createSiteRuntime();
    runtime.graph.item.create({
      title: "Home",
      path: "/",
      body: "# Home",
      visibility: siteVisibilityIdFor("public"),
      tags: [],
      createdAt: new Date("2026-04-15T00:00:00.000Z"),
      updatedAt: new Date("2026-04-15T00:00:00.000Z"),
    });
    runtime.graph.item.create({
      title: "Private bookmark",
      url: new URL("https://example.com/"),
      visibility: siteVisibilityIdFor("private"),
      tags: [],
      createdAt: new Date("2026-04-15T00:00:00.000Z"),
      updatedAt: new Date("2026-04-15T00:00:00.000Z"),
    });

    const html = renderToStaticMarkup(
      <GraphleSiteShell runtime={runtime} status={readyStatus({ authenticated: true })} />,
    );

    expect(html).toContain("Home");
    expect(html).toContain("Private bookmark");
    expect(html).toContain("graph-markdown");
    expect(html).not.toContain("Welcome home.");
    expect(html).not.toContain("graphle-site-");
    expect(html).not.toContain("Site preview");
    expect(html).not.toContain("Search items");
    expect(html).not.toContain("Edit item");
    expect(html).not.toContain("New item");
    expect(html).not.toContain("Reorder Home");
    expect(html).not.toContain("Visitor preview");
    expect(html).not.toContain("Admin active");
  });

  it("renders graph-backed route items through the authored view surface", () => {
    const runtime = createSiteRuntime();
    const tagId = runtime.graph.tag.create({
      color: "#2563eb",
      key: "graphle",
      name: "Graphle",
    });
    runtime.graph.item.create({
      title: "Home",
      path: "/",
      body: "Welcome **home**.",
      visibility: siteVisibilityIdFor("public"),
      tags: [tagId],
      createdAt: new Date("2023-11-01T00:00:00.000Z"),
      updatedAt: new Date("2023-11-02T00:00:00.000Z"),
    });

    const html = renderToStaticMarkup(
      <GraphleSitePreview
        path="/"
        runtime={runtime}
        status={readyStatus({ authenticated: true })}
      />,
    );

    expect(html).toContain("<h1");
    expect(html).toContain('data-entity-surface-title="title"');
    expect(html).toContain("Home");
    expect(html).toContain("November 01, 2023");
    expect(html).toContain('data-web-field-kind="entity-reference-list"');
    expect(html).toContain("data-web-reference-chip=");
    expect(html).toContain("Graphle");
    expect(html).toContain('data-web-field-kind="markdown"');
    expect(html).toContain("graph-markdown");
    expect(html).toContain("Welcome");
    expect(html).toContain("<strong");
    expect(html).toContain("home");
  });

  it("renders unauthenticated public routes through graph refs", () => {
    const runtime = createSiteRuntime();
    runtime.graph.item.create({
      title: "Home",
      path: "/",
      body: "Public **graph** content.",
      visibility: siteVisibilityIdFor("public"),
      tags: [],
      createdAt: new Date("2026-04-15T00:00:00.000Z"),
      updatedAt: new Date("2026-04-15T00:00:00.000Z"),
    });

    const html = renderToStaticMarkup(
      <GraphleSitePreview
        path="/"
        runtime={runtime}
        status={readyStatus({ authenticated: false })}
      />,
    );

    expect(html).toContain("graph-markdown");
    expect(html).toContain("Public");
    expect(html).toContain("<strong");
    expect(html).toContain("graph");
  });

  it("shows deploy controls only for authenticated sessions", () => {
    const runtime = createSiteRuntime();
    runtime.graph.item.create({
      title: "Home",
      path: "/",
      body: "Public content.",
      visibility: siteVisibilityIdFor("public"),
      tags: [],
      createdAt: new Date("2026-04-15T00:00:00.000Z"),
      updatedAt: new Date("2026-04-15T00:00:00.000Z"),
    });

    const authenticatedHtml = renderToStaticMarkup(
      <GraphleSitePreview
        path="/"
        runtime={runtime}
        status={readyStatus({
          authenticated: true,
          deploy: {
            state: "idle",
            credentials: {
              hasApiToken: false,
              missing: ["accountId", "apiToken"],
            },
            metadata: null,
            currentBaseline: {
              sourceCursor: "cursor:1",
              baselineHash: "sha256:1",
              generatedAt: "2026-04-18T00:00:00.000Z",
              matchesLastDeploy: false,
            },
          },
        })}
      />,
    );
    const visitorHtml = renderToStaticMarkup(
      <GraphleSitePreview
        path="/"
        runtime={runtime}
        status={readyStatus({ authenticated: false })}
      />,
    );

    expect(authenticatedHtml).toContain("Cloudflare");
    expect(authenticatedHtml).toContain("Cloudflare account ID");
    expect(authenticatedHtml).toContain("Cloudflare API token");
    expect(authenticatedHtml).toContain("Worker name");
    expect(authenticatedHtml).toContain("New baseline pending");
    expect(visitorHtml).not.toContain("Cloudflare");
    expect(visitorHtml).not.toContain("Deploy");
  });

  it("renders deploy success and error states", () => {
    const runtime = createSiteRuntime();
    runtime.graph.item.create({
      title: "Home",
      path: "/",
      body: "Public content.",
      visibility: siteVisibilityIdFor("public"),
      tags: [],
      createdAt: new Date("2026-04-15T00:00:00.000Z"),
      updatedAt: new Date("2026-04-15T00:00:00.000Z"),
    });

    const successHtml = renderToStaticMarkup(
      <GraphleSitePreview
        path="/"
        runtime={runtime}
        status={readyStatus({
          authenticated: true,
          deploy: {
            state: "ready",
            credentials: {
              accountId: "account-1",
              workerName: "graphle-project",
              hasApiToken: false,
              missing: ["apiToken"],
            },
            metadata: {
              accountId: "account-1",
              workerName: "graphle-project",
              workerUrl: "https://graphle-project.example.workers.dev/",
              sourceCursor: "cursor:1",
              baselineHash: "sha256:1",
              deployedAt: "2026-04-18T00:00:00.000Z",
              status: "ready",
            },
            currentBaseline: {
              sourceCursor: "cursor:1",
              baselineHash: "sha256:1",
              generatedAt: "2026-04-18T00:00:00.000Z",
              matchesLastDeploy: true,
            },
          },
        })}
      />,
    );
    const errorHtml = renderToStaticMarkup(
      <GraphleSitePreview
        path="/"
        runtime={runtime}
        status={readyStatus({
          authenticated: true,
          deploy: {
            state: "error",
            credentials: {
              accountId: "account-1",
              workerName: "graphle-project",
              hasApiToken: false,
              missing: ["apiToken"],
            },
            metadata: null,
            currentBaseline: {
              sourceCursor: "cursor:2",
              baselineHash: "sha256:2",
              generatedAt: "2026-04-18T00:00:00.000Z",
              matchesLastDeploy: false,
            },
            error: {
              code: "cloudflare.api_failed",
              message: "Cloudflare rejected the deploy request.",
              status: 403,
              retryable: false,
            },
          },
        })}
      />,
    );

    expect(successHtml).toContain("https://graphle-project.example.workers.dev/");
    expect(successHtml).toContain("Current baseline deployed");
    expect(errorHtml).toContain("Cloudflare rejected the deploy request.");
    expect(errorHtml).not.toContain("secret-token");
  });

  it("normalizes reorder payloads to consecutive sort order values", () => {
    expect(
      buildGraphleSiteOrderPayload([
        {
          id: "item-2",
          title: "Second",
          visibility: "public",
          tags: [],
          createdAt: "2026-04-15T00:00:00.000Z",
          updatedAt: "2026-04-15T00:00:00.000Z",
        },
        {
          id: "item-1",
          title: "First",
          visibility: "public",
          tags: [],
          createdAt: "2026-04-15T00:00:00.000Z",
          updatedAt: "2026-04-15T00:00:00.000Z",
        },
      ]),
    ).toEqual([
      { id: "item-2", sortOrder: 0 },
      { id: "item-1", sortOrder: 1 },
    ]);
  });

  it("resolves persisted theme preferences and system color scheme", () => {
    const darkMedia = () => ({ matches: true }) as MediaQueryList;

    expect(resolveGraphleSiteTheme("light", darkMedia)).toBe("light");
    expect(resolveGraphleSiteTheme("dark", darkMedia)).toBe("dark");
    expect(resolveGraphleSiteTheme("system", darkMedia)).toBe("dark");
  });
});
