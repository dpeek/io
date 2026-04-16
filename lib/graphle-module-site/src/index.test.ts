import { describe, expect, it } from "bun:test";

import { createBootstrappedSnapshot } from "@dpeek/graphle-bootstrap";
import { createGraphClient } from "@dpeek/graphle-client";
import { createGraphIdMap, createGraphStore } from "@dpeek/graphle-kernel";
import { minimalCore } from "@dpeek/graphle-module-core";

import {
  parseSitePath,
  parseSitePublicRoute,
  parseSitePublicationStatus,
  parseSiteSlug,
  site,
  siteManifest,
  siteStatusForId,
  siteStatusIdFor,
} from "./index.js";
import siteIds from "./site.json";

const siteGraphDefinitions = { ...minimalCore, ...site } as const;

describe("site module", () => {
  it("keeps the site id map in sync with authored schema keys", () => {
    const reconciled = createGraphIdMap(site, siteIds, { pruneOrphans: true });

    expect(reconciled.added).toEqual([]);
    expect(reconciled.removed).toEqual([]);
    expect(reconciled.map).toEqual(siteIds);
  });

  it("defines page and post contracts over the minimal site graph", () => {
    const store = createGraphStore(
      createBootstrappedSnapshot(siteGraphDefinitions, {
        availableDefinitions: siteGraphDefinitions,
        coreSchema: minimalCore,
      }),
    );
    const graph = createGraphClient(store, site, siteGraphDefinitions);
    const updatedAt = new Date("2026-04-15T00:00:00.000Z");
    const publishedStatus = site.status.values.published.id;

    const pageId = graph.page.create({
      title: "Home",
      path: "/",
      body: "# Home",
      status: publishedStatus,
      updatedAt,
    });
    const postId = graph.post.create({
      title: "Example post",
      slug: "example-post",
      body: "# Example",
      excerpt: "A short example post.",
      publishedAt: updatedAt,
      status: publishedStatus,
      updatedAt,
    });

    expect(graph.page.get(pageId)).toMatchObject({
      title: "Home",
      path: "/",
      body: "# Home",
      status: publishedStatus,
      updatedAt,
    });
    expect(graph.post.get(postId)).toMatchObject({
      title: "Example post",
      slug: "example-post",
      excerpt: "A short example post.",
      status: publishedStatus,
    });
    expect(siteManifest.runtime.schemas?.[0]?.namespace).toBe(site);
  });

  it("validates absolute site paths", () => {
    expect(parseSitePath("/")).toBe("/");
    expect(parseSitePath("/work/example")).toBe("/work/example");
    expect(() => parseSitePath("posts/example")).toThrow("Invalid site path");
    expect(() => parseSitePath("/work/")).toThrow("Invalid site path");
  });

  it("normalizes route, slug, and status helpers for browser-safe site APIs", () => {
    expect(parseSiteSlug("Launch Notes")).toBe("launch-notes");
    expect(parseSitePublicationStatus("draft")).toBe("draft");
    expect(siteStatusForId(siteStatusIdFor("published"))).toBe("published");
    expect(parseSitePublicRoute("/posts/example-post")).toEqual({
      kind: "post",
      slug: "example-post",
    });
    expect(parseSitePublicRoute("/work")).toEqual({
      kind: "page",
      path: "/work",
    });
    expect(() => parseSiteSlug("bad/slug")).toThrow("Invalid site slug");
    expect(() => parseSitePublicationStatus("archived")).toThrow("Invalid site status");
  });
});
