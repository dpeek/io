import { describe, expect, it } from "bun:test";

import { serializedQueryVersion } from "@io/graph-client";
import { renderToStaticMarkup } from "react-dom/server";

import {
  createQueryWorkbenchMemoryStore,
  encodeQueryWorkbenchParameterOverrides,
} from "../lib/query-workbench.js";
import { createQueryRouteSearch } from "../lib/query-route-state.js";
import { QueryWorkbench } from "./query-workbench.js";

const workflowBoardSurfaceVersion = "query-surface:workflow:project-branch-board:v1";
const workflowCatalogId = "workflow:query-surfaces";
const workflowCatalogVersion = "query-catalog:workflow:v1";

describe("query workbench component", () => {
  it("renders the authoring and results split around the shared editor", () => {
    const html = renderToStaticMarkup(<QueryWorkbench />);

    expect(html).toContain('data-query-workbench-results=""');
    expect(html).toContain("Results Panel");
    expect(html).toContain("Save query");
    expect(html).toContain("Save view");
    expect(html).toContain("Preview pending");
    expect(html).not.toContain('data-query-container-mount="draft-preview"');
  });

  it("renders a fail-closed state for invalid route drafts", () => {
    const html = renderToStaticMarkup(<QueryWorkbench search={{ draft: "not-a-valid-draft" }} />);

    expect(html).toContain("Preview unavailable");
    expect(html).toContain("Draft preview state is invalid or stale.");
  });

  it("renders a fail-closed state when a saved query no longer matches the current catalog", () => {
    const store = createQueryWorkbenchMemoryStore();
    store.saveQuery({
      catalogId: workflowCatalogId,
      catalogVersion: workflowCatalogVersion,
      id: "saved-query:stale-surface",
      name: "Stale board",
      parameterDefinitions: [],
      request: {
        query: {
          indexId: "workflow:missing-surface",
          kind: "collection",
          window: {
            limit: 25,
          },
        },
        version: serializedQueryVersion,
      },
      surfaceId: "workflow:missing-surface",
      surfaceVersion: "query-surface:workflow:missing-surface:v1",
    });

    const html = renderToStaticMarkup(
      <QueryWorkbench search={{ queryId: "saved-query:stale-surface" }} store={store} />,
    );

    expect(html).toContain("Preview unavailable");
    expect(html).toContain(
      "Saved query &quot;saved-query:stale-surface&quot; references removed query surface &quot;workflow:missing-surface&quot;.",
    );
  });

  it("renders a fail-closed state when a saved view binding no longer matches the current saved query", () => {
    const store = createQueryWorkbenchMemoryStore();
    store.saveQuery({
      catalogId: workflowCatalogId,
      catalogVersion: workflowCatalogVersion,
      id: "saved-query:owner-board",
      name: "Owner board",
      parameterDefinitions: [],
      request: {
        query: {
          indexId: "workflow:project-branch-board",
          kind: "collection",
          window: {
            limit: 25,
          },
        },
        version: serializedQueryVersion,
      },
      surfaceId: "workflow:project-branch-board",
      surfaceVersion: workflowBoardSurfaceVersion,
    });
    store.saveView({
      catalogId: workflowCatalogId,
      catalogVersion: workflowCatalogVersion,
      id: "saved-view:owner-board",
      name: "Owner board view",
      queryId: "saved-query:owner-board",
      spec: {
        containerId: "saved-view-preview",
        pagination: {
          mode: "paged",
          pageSize: 25,
        },
        query: {
          kind: "saved-query",
          queryId: "saved-query:other",
        },
        refresh: {
          mode: "manual",
        },
        renderer: {
          rendererId: "default:list",
        },
      },
      surfaceId: "workflow:project-branch-board",
      surfaceVersion: workflowBoardSurfaceVersion,
    });

    const html = renderToStaticMarkup(
      <QueryWorkbench search={{ viewId: "saved-view:owner-board" }} store={store} />,
    );

    expect(html).toContain("Preview unavailable");
    expect(html).toContain(
      "Saved view &quot;saved-view:owner-board&quot; references saved query &quot;saved-query:other&quot; in its container binding but is stored against &quot;saved-query:owner-board&quot;.",
    );
  });

  it("reopens saved queries from route state with parameter overrides in the preview", () => {
    const store = createQueryWorkbenchMemoryStore();
    store.saveQuery({
      catalogId: workflowCatalogId,
      catalogVersion: workflowCatalogVersion,
      id: "saved-query:owner-board",
      name: "Owner board",
      parameterDefinitions: [
        {
          label: "State",
          name: "state",
          required: false,
          type: "enum",
        },
      ],
      request: {
        params: {
          state: "active",
        },
        query: {
          filter: {
            fieldId: "state",
            op: "eq",
            value: {
              kind: "param",
              name: "state",
            },
          },
          indexId: "workflow:project-branch-board",
          kind: "collection",
          window: {
            limit: 25,
          },
        },
        version: serializedQueryVersion,
      },
      surfaceId: "workflow:project-branch-board",
      surfaceVersion: workflowBoardSurfaceVersion,
    });

    const html = renderToStaticMarkup(
      <QueryWorkbench
        search={{
          params: encodeQueryWorkbenchParameterOverrides({
            state: "ready",
          }),
          queryId: "saved-query:owner-board",
        }}
        store={store}
      />,
    );

    expect(html).toContain("Open query: Owner board");
    expect(html).toContain('value="Owner board"');
    expect(html).toContain("query-param-state");
    expect(html).toContain('data-query-container-mount="saved-query:saved-query:owner-board"');
    expect(html).toContain('data-query-container-state="loading"');
    expect(html).toContain("Update query");
  });

  it("reopens saved views from route state and keeps saved-state actions visible", () => {
    const store = createQueryWorkbenchMemoryStore();
    store.saveQuery({
      catalogId: workflowCatalogId,
      catalogVersion: workflowCatalogVersion,
      id: "saved-query:owner-board",
      name: "Owner board",
      parameterDefinitions: [],
      request: {
        query: {
          indexId: "workflow:project-branch-board",
          kind: "collection",
          window: {
            limit: 1,
          },
        },
        version: serializedQueryVersion,
      },
      surfaceId: "workflow:project-branch-board",
      surfaceVersion: workflowBoardSurfaceVersion,
    });
    store.saveView({
      catalogId: workflowCatalogId,
      catalogVersion: workflowCatalogVersion,
      id: "saved-view:owner-board",
      name: "Owner board view",
      queryId: "saved-query:owner-board",
      spec: {
        containerId: "saved-view-preview",
        pagination: {
          mode: "paged",
          pageSize: 1,
        },
        query: {
          kind: "saved-query",
          queryId: "saved-query:owner-board",
        },
        refresh: {
          mode: "manual",
        },
        renderer: {
          rendererId: "default:card-grid",
        },
      },
      surfaceId: "workflow:project-branch-board",
      surfaceVersion: workflowBoardSurfaceVersion,
    });

    const html = renderToStaticMarkup(
      <QueryWorkbench search={{ viewId: "saved-view:owner-board" }} store={store} />,
    );

    expect(html).toContain("Open view: Owner board view");
    expect(html).toContain('value="Owner board view"');
    expect(html).toContain('data-query-container-mount="saved-view-preview"');
    expect(html).toContain('data-query-container-state="loading"');
    expect(html).toContain("Update view");
  });

  it("hydrates saved-view preview controls from explicit query route state", () => {
    const store = createQueryWorkbenchMemoryStore();
    store.saveQuery({
      catalogId: workflowCatalogId,
      catalogVersion: workflowCatalogVersion,
      id: "saved-query:owner-board",
      name: "Owner board",
      parameterDefinitions: [],
      request: {
        query: {
          indexId: "workflow:project-branch-board",
          kind: "collection",
          window: {
            limit: 1,
          },
        },
        version: serializedQueryVersion,
      },
      surfaceId: "workflow:project-branch-board",
      surfaceVersion: workflowBoardSurfaceVersion,
    });
    store.saveView({
      catalogId: workflowCatalogId,
      catalogVersion: workflowCatalogVersion,
      id: "saved-view:owner-board",
      name: "Owner board view",
      queryId: "saved-query:owner-board",
      spec: {
        containerId: "saved-view-preview",
        pagination: {
          mode: "paged",
          pageSize: 1,
        },
        query: {
          kind: "saved-query",
          queryId: "saved-query:owner-board",
        },
        refresh: {
          mode: "manual",
        },
        renderer: {
          rendererId: "default:card-grid",
        },
      },
      surfaceId: "workflow:project-branch-board",
      surfaceVersion: workflowBoardSurfaceVersion,
    });

    const html = renderToStaticMarkup(
      <QueryWorkbench
        search={createQueryRouteSearch({
          pageSize: 3,
          rendererId: "default:table",
          viewId: "saved-view:owner-board",
        })}
        store={store}
      />,
    );

    expect(html).toContain('value="3"');
    expect(html).toContain(
      '<option data-slot="native-select-option" value="default:table" selected="">',
    );
  });
});
