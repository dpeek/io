import { describe, expect, it } from "bun:test";

import { serializedQueryVersion, type QueryResultPage } from "@io/graph-client";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  QueryContainerRuntimeValue,
  QueryContainerSpec,
  QuerySurfaceRendererCompatibility,
} from "../lib/query-container.js";
import {
  QueryRendererRegistryError,
  builtInQueryRendererRegistry,
  createCardGridRendererBinding,
  createListRendererBinding,
  createTableRendererBinding,
  createQueryRendererRegistry,
} from "./query-renderers.js";
import { QueryRouteMountView } from "./query-route-mount.js";

const baseSpec = {
  containerId: "query-demo",
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
  renderer: {
    ...createListRendererBinding({
      descriptionField: "summary",
      metaFields: [{ fieldId: "status", label: "Status" }],
      titleField: "title",
    }),
  },
} as const satisfies QueryContainerSpec;

const demoSurface = {
  compatibleRendererIds: ["core:list", "core:table", "core:card-grid"],
  itemEntityIds: "optional",
  queryKind: "collection",
  resultKind: "collection",
  sourceKinds: ["inline"],
  surfaceId: "views:query-demo",
} as const satisfies QuerySurfaceRendererCompatibility;

function createResultPage(): QueryResultPage {
  return {
    kind: "collection",
    freshness: {
      completeness: "complete",
      freshness: "current",
    },
    items: [
      {
        key: "row:1",
        entityId: "entity:1",
        payload: {
          title: "Workflow shell",
          summary: "Primary browser route preview",
          status: "active",
        },
      },
      {
        key: "row:2",
        entityId: "entity:2",
        payload: {
          title: "Query cards",
          summary: "Reusable query route mount",
          status: "ready",
        },
      },
    ],
  };
}

function createValue(
  overrides: Partial<QueryContainerRuntimeValue> = {},
): QueryContainerRuntimeValue {
  const result = createResultPage();
  return {
    cacheKey: "cache:query-demo",
    instanceKey: "instance:query-demo",
    pageKey: "page:first",
    request: baseSpec.query.request,
    snapshot: { result },
    state: {
      kind: "ready",
      result,
    },
    ...overrides,
  };
}

describe("query renderer registry", () => {
  it("rejects duplicate stable renderer ids", () => {
    expect(() =>
      createQueryRendererRegistry([
        builtInQueryRendererRegistry["core:list"]!,
        builtInQueryRendererRegistry["core:list"]!,
      ]),
    ).toThrow(QueryRendererRegistryError);
  });
});

describe("query route mount", () => {
  it("renders the first shared query render paths through stable renderer ids", () => {
    const renderers = ["core:list", "core:table", "core:card-grid"] as const;
    const html = renderToStaticMarkup(
      <div>
        {renderers.map((rendererId) => (
          <QueryRouteMountView
            description="Shared query container route preview."
            initialValue={createValue()}
            key={rendererId}
            spec={{
              ...baseSpec,
              containerId: `query-demo:${rendererId}`,
              renderer:
                rendererId === "core:list"
                  ? baseSpec.renderer
                  : rendererId === "core:table"
                    ? createTableRendererBinding([
                        { fieldId: "title", label: "Title" },
                        { fieldId: "status", label: "Status" },
                      ])
                    : createCardGridRendererBinding({
                        badgeField: "status",
                        descriptionField: "summary",
                        fields: [{ fieldId: "status", label: "Status" }],
                        titleField: "title",
                      }),
            }}
            surface={demoSurface}
            title={rendererId}
          />
        ))}
      </div>,
    );

    expect(html).toContain('data-query-renderer="core:list"');
    expect(html).toContain('data-query-renderer="core:table"');
    expect(html).toContain('data-query-renderer="core:card-grid"');
    expect(html).toContain("Workflow shell");
    expect(html).toContain("Query cards");
  });

  it("fails clearly when a route binds an incompatible renderer", () => {
    const html = renderToStaticMarkup(
      <QueryRouteMountView
        description="Shared query container route preview."
        initialValue={createValue()}
        spec={{
          ...baseSpec,
          renderer: {
            rendererId: "core:table",
          },
        }}
        surface={{
          ...demoSurface,
          compatibleRendererIds: ["core:list"],
        }}
        title="Invalid renderer"
      />,
    );

    expect(html).toContain('data-query-container-state="invalid"');
    expect(html).toContain("renderer-not-compatible");
    expect(html).toContain("is not compatible with query surface &quot;views:query-demo&quot;.");
  });
});
