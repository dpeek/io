import { describe, expect, it } from "bun:test";

import { createInstalledQueryEditorCatalog } from "../components/query-editor.js";
import {
  builtInQueryRendererRegistry,
  createQueryRendererCapabilityMap,
} from "../components/query-renderers.js";
import { createQueryEditorDraft } from "./query-editor.js";
import {
  createSavedQueryMemoryStore,
  createSavedQuerySourceResolver,
  resolveSavedViewRecord,
  saveSavedQueryDraft,
  saveSavedViewDraft,
} from "./saved-query.js";
import { getInstalledModuleQuerySurfaceRendererCompatibility } from "./query-surface-registry.js";

describe("saved query store", () => {
  it("allocates new ids after deletions without reusing existing saved-query ids", () => {
    const catalog = createInstalledQueryEditorCatalog();
    const draft = createQueryEditorDraft(catalog);
    const store = createSavedQueryMemoryStore();

    const first = saveSavedQueryDraft({
      catalog,
      draft,
      name: "First query",
      store,
    });
    const second = saveSavedQueryDraft({
      catalog,
      draft,
      name: "Second query",
      store,
    });

    store.deleteSavedQuery(first.id);

    const third = saveSavedQueryDraft({
      catalog,
      draft,
      name: "Third query",
      store,
    });

    expect(second.id).toBe("saved-query:2");
    expect(third.id).toBe("saved-query:3");
    expect(store.listSavedQueries()).toHaveLength(2);
    expect(
      store
        .listSavedQueries()
        .map((query) => query.id)
        .sort(),
    ).toEqual(["saved-query:2", "saved-query:3"]);
  });

  it("cascades saved-view deletion when a saved query is removed", () => {
    const catalog = createInstalledQueryEditorCatalog();
    const draft = createQueryEditorDraft(catalog);
    const store = createSavedQueryMemoryStore();
    const rendererCapabilities = createQueryRendererCapabilityMap(builtInQueryRendererRegistry);

    const saved = saveSavedViewDraft({
      catalog,
      draft,
      queryName: "Branch board",
      rendererCapabilities,
      spec: {
        containerId: "saved-view-preview",
        pagination: {
          mode: "paged",
          pageSize: 25,
        },
        refresh: {
          mode: "manual",
        },
        renderer: {
          rendererId: "core:list",
        },
      },
      store,
      surface: getInstalledModuleQuerySurfaceRendererCompatibility("workflow:project-branch-board"),
      viewName: "Branch board view",
    });

    store.deleteSavedQuery(saved.query.id);

    expect(store.getSavedQuery(saved.query.id)).toBeUndefined();
    expect(store.getSavedView(saved.view.id)).toBeUndefined();
  });
});

describe("saved query resolution", () => {
  it("resolves saved views into request and normalized planner records", async () => {
    const catalog = createInstalledQueryEditorCatalog();
    const store = createSavedQueryMemoryStore();
    const rendererCapabilities = createQueryRendererCapabilityMap(builtInQueryRendererRegistry);
    const draft = {
      ...createQueryEditorDraft(catalog),
      filters: [
        {
          fieldId: "state",
          id: "filter:state",
          operator: "eq" as const,
          value: { kind: "param" as const, name: "state" },
        },
      ],
      parameters: [
        {
          defaultValue: "active",
          id: "param:state",
          label: "State",
          name: "state",
          required: false,
          type: "enum" as const,
        },
      ],
    };

    const saved = saveSavedViewDraft({
      catalog,
      draft,
      queryName: "Owner board",
      rendererCapabilities,
      spec: {
        containerId: "saved-view-preview",
        pagination: {
          mode: "paged",
          pageSize: 25,
        },
        refresh: {
          mode: "manual",
        },
        renderer: {
          rendererId: "core:list",
        },
      },
      store,
      surface: getInstalledModuleQuerySurfaceRendererCompatibility("workflow:project-branch-board"),
      viewName: "Owner board view",
    });

    const resolved = await resolveSavedViewRecord({
      catalog,
      executionContext: {
        policyFilterVersion: "policy:7",
        principalId: "principal:test",
      },
      params: { state: "ready" },
      query: saved.query,
      resolveSurfaceCompatibility: getInstalledModuleQuerySurfaceRendererCompatibility,
      view: saved.view,
    });
    const sourceResolver = createSavedQuerySourceResolver(store, { catalog });
    const resolvedSource = await sourceResolver(
      {
        kind: "saved",
        params: { state: "blocked" },
        queryId: saved.query.id,
      },
      {},
    );

    expect(resolved.request.params?.state).toBe("ready");
    expect(resolved.normalizedRequest.metadata.identityHash).toEqual(expect.any(String));
    expect(resolved.normalizedRequest.params[0]).toMatchObject({
      name: "state",
      value: "ready",
    });
    expect("request" in resolvedSource ? resolvedSource.request.params?.state : undefined).toBe(
      "blocked",
    );
  });
});
