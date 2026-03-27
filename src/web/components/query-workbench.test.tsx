import { describe, expect, it } from "bun:test";

import { serializedQueryVersion } from "@io/graph-client";
import { renderToStaticMarkup } from "react-dom/server";

import {
  createQueryWorkbenchMemoryStore,
  encodeQueryWorkbenchParamOverrides,
} from "../lib/query-workbench.js";
import { QueryWorkbench } from "./query-workbench.js";

describe("query workbench component", () => {
  it("renders preview and save flows around the shared editor", () => {
    const html = renderToStaticMarkup(<QueryWorkbench />);

    expect(html).toContain('data-query-editor-section="footer"');
    expect(html).toContain("Preview draft");
    expect(html).toContain("Save query");
    expect(html).toContain("Save view");
    expect(html).toContain('data-query-route-mount="draft-preview"');
  });

  it("renders a fail-closed state for invalid route drafts", () => {
    const html = renderToStaticMarkup(<QueryWorkbench search={{ draft: "not-a-valid-draft" }} />);

    expect(html).toContain("Preview unavailable");
    expect(html).toContain("Draft preview state is invalid or stale.");
  });

  it("renders a fail-closed state when a saved query no longer matches the current catalog", () => {
    const store = createQueryWorkbenchMemoryStore();
    store.saveQuery({
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
    });

    const html = renderToStaticMarkup(
      <QueryWorkbench search={{ queryId: "saved-query:stale-surface" }} store={store} />,
    );

    expect(html).toContain("Preview unavailable");
    expect(html).toContain(
      "Saved query &quot;saved-query:stale-surface&quot; no longer matches the current query surfaces.",
    );
  });

  it("reopens saved queries from route state with parameter overrides in the preview", () => {
    const store = createQueryWorkbenchMemoryStore();
    store.saveQuery({
      id: "saved-query:owner-board",
      name: "Owner board",
      parameterDefinitions: [
        {
          label: "Owner",
          name: "owner",
          required: false,
          type: "entity-ref",
        },
      ],
      request: {
        params: {
          owner: "person:avery",
        },
        query: {
          filter: {
            fieldId: "ownerId",
            op: "eq",
            value: {
              kind: "param",
              name: "owner",
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
    });

    const html = renderToStaticMarkup(
      <QueryWorkbench
        search={{
          params: encodeQueryWorkbenchParamOverrides({
            owner: "person:sam",
          }),
          queryId: "saved-query:owner-board",
        }}
        store={store}
      />,
    );

    expect(html).toContain("Open query: Owner board");
    expect(html).toContain('value="Owner board"');
    expect(html).toContain("query-param-owner");
    expect(html).toContain('data-query-route-mount="saved-query:saved-query:owner-board"');
    expect(html).toContain('data-query-container-state="loading"');
    expect(html).toContain("Update query");
  });

  it("reopens saved views from route state and keeps saved-state actions visible", () => {
    const store = createQueryWorkbenchMemoryStore();
    store.saveQuery({
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
    });
    store.saveView({
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
          kind: "saved",
          queryId: "saved-query:owner-board",
        },
        refresh: {
          mode: "manual",
        },
        renderer: {
          rendererId: "core:card-grid",
        },
      },
      surfaceId: "workflow:project-branch-board",
    });

    const html = renderToStaticMarkup(
      <QueryWorkbench search={{ viewId: "saved-view:owner-board" }} store={store} />,
    );

    expect(html).toContain("Open view: Owner board view");
    expect(html).toContain('value="Owner board view"');
    expect(html).toContain('data-query-route-mount="saved-view-preview"');
    expect(html).toContain('data-query-container-state="loading"');
    expect(html).toContain("Update view");
  });
});
