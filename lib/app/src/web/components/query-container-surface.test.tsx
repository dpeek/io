import { describe, expect, it } from "bun:test";

import { serializedQueryVersion } from "@io/graph-client";
import { renderToStaticMarkup } from "react-dom/server";

import type { QueryContainerRuntimeValue, QueryContainerSpec } from "../lib/query-container.js";
import { QueryContainerSurfaceView } from "./query-container-surface.js";
import { createListRendererBinding } from "./query-renderers.js";

const baseSpec = {
  containerId: "query-surface",
  pagination: {
    mode: "paged",
    pageSize: 2,
  },
  query: {
    kind: "inline",
    request: {
      version: serializedQueryVersion,
      query: {
        kind: "collection",
        indexId: "views:query-demo",
      },
    },
  },
  renderer: createListRendererBinding({
    descriptionField: "summary",
    titleField: "title",
  }),
} as const satisfies QueryContainerSpec;

function createValue(kind: "ready" | "stale" | "refreshing" | "error"): QueryContainerRuntimeValue {
  const result = {
    kind: "collection" as const,
    freshness: {
      completeness: "complete" as const,
      freshness: kind === "stale" ? ("stale" as const) : ("current" as const),
    },
    items: [
      {
        key: "row:1",
        entityId: "entity:1",
        payload: {
          summary: "Shared renderer state",
          title: "Workflow shell",
        },
      },
    ],
    ...(kind === "stale" || kind === "refreshing" ? { nextCursor: "cursor:2" } : {}),
  };

  return {
    cacheKey: "cache:query-surface",
    instanceKey: "instance:query-surface",
    pageKey: "page:first",
    request: baseSpec.query.request,
    snapshot: kind === "error" ? { error: { message: "boom", code: "failed" } } : { result },
    state:
      kind === "error"
        ? { kind: "error", error: { message: "boom", code: "failed" } }
        : kind === "stale"
          ? { kind: "stale", nextCursor: "cursor:2", result }
          : kind === "refreshing"
            ? { kind: "refreshing", nextCursor: "cursor:2", result }
            : { kind: "ready", result },
  };
}

describe("query container surface", () => {
  it("renders shared stale and refreshing chrome around renderer output", () => {
    const staleHtml = renderToStaticMarkup(
      <QueryContainerSurfaceView
        spec={baseSpec}
        title="Query surface"
        value={createValue("stale")}
      />,
    );
    const refreshingHtml = renderToStaticMarkup(
      <QueryContainerSurfaceView
        spec={baseSpec}
        title="Query surface"
        value={createValue("refreshing")}
      />,
    );

    expect(staleHtml).toContain("Results are stale. Refresh to reload the first page.");
    expect(staleHtml).toContain("Next page");
    expect(staleHtml).toContain('data-query-renderer="core:list"');
    expect(refreshingHtml).toContain("Refreshing from the current query container cache.");
    expect(refreshingHtml).toContain("disabled");
  });

  it("renders shared error chrome instead of invoking the renderer", () => {
    const html = renderToStaticMarkup(
      <QueryContainerSurfaceView
        spec={baseSpec}
        title="Query surface"
        value={createValue("error")}
      />,
    );

    expect(html).toContain('data-query-container-state="error"');
    expect(html).toContain("boom");
    expect(html).not.toContain('data-query-renderer="core:list"');
  });
});
