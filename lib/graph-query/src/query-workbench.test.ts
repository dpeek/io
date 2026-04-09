import { describe, expect, it } from "bun:test";

import { coreBuiltInQuerySurfaceIds, coreQuerySurfaceCatalog } from "@io/graph-module-core";
import { workflowQuerySurfaceCatalog } from "@io/graph-module-workflow";
import { serializedQueryVersion, type SerializedQueryRequest } from "@io/graph-client";

import {
  builtInQueryRendererRegistry,
  createQueryRendererCapabilityMap,
} from "./react-dom/query-renderers.js";
import { createInlineQueryContainer, createSavedQueryContainer } from "./query-container.js";
import { createQueryEditorCatalog, createQueryEditorDraft } from "./query-editor.js";
import {
  createInstalledQuerySurfaceRegistry,
  createQueryEditorCatalogFromRegistry,
  createQuerySurfaceRendererCompatibility,
  getInstalledQuerySurface,
} from "./query-surface-registry.js";
import {
  QueryWorkbenchSaveError,
  createQueryWorkbenchBrowserStore,
  createQueryWorkbenchInitialDraft,
  createQueryWorkbenchMemoryStore,
  createQueryWorkbenchPreviewRuntime,
  createQueryWorkbenchSourceResolver,
  decodeQueryWorkbenchParameterOverrides,
  decodeQueryWorkbenchDraft,
  encodeQueryWorkbenchDraft,
  encodeQueryWorkbenchParameterOverrides,
  hydrateQueryWorkbenchDraft,
  resolveQueryWorkbenchRouteTarget,
  resolveQueryWorkbenchState,
  saveQueryWorkbenchQuery,
  saveQueryWorkbenchView,
} from "./query-workbench.js";
const workflowBoardSurfaceVersion = "query-surface:workflow:project-branch-board:v1";
const workflowCatalogId = "workflow:query-surfaces";
const workflowCatalogVersion = "query-catalog:workflow:v1";
const installedQuerySurfaceRegistry = createInstalledQuerySurfaceRegistry([
  workflowQuerySurfaceCatalog,
  coreQuerySurfaceCatalog,
]);
const workflowBoardSurface = requireSurfaceCompatibility("workflow:project-branch-board");
const coreSavedQueryLibrarySurface = requireSurfaceCompatibility(
  coreBuiltInQuerySurfaceIds.savedQueryLibrary,
);

function readResolvedRequest(
  resolved: { readonly request: SerializedQueryRequest } | SerializedQueryRequest,
): SerializedQueryRequest {
  return "request" in resolved ? resolved.request : resolved;
}

function createInstalledQueryEditorCatalog() {
  return createQueryEditorCatalogFromRegistry(
    createInstalledQuerySurfaceRegistry([workflowQuerySurfaceCatalog, coreQuerySurfaceCatalog]),
  );
}

function validateQueryRouteSearch(search: Record<string, unknown>) {
  return {
    ...(readTrimmedString(search.queryId) ? { queryId: readTrimmedString(search.queryId) } : {}),
    ...(readTrimmedString(search.viewId) ? { viewId: readTrimmedString(search.viewId) } : {}),
    ...(readTrimmedString(search.draft) ? { draft: readTrimmedString(search.draft) } : {}),
    ...(readTrimmedString(search.params) ? { params: readTrimmedString(search.params) } : {}),
    ...(readPositiveInteger(search.pageSize) !== undefined
      ? { pageSize: readPositiveInteger(search.pageSize) }
      : {}),
    ...(readRendererId(search.rendererId) ? { rendererId: readRendererId(search.rendererId) } : {}),
  };
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readRendererId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return ["default:list", "default:table", "default:card-grid"].includes(normalized)
    ? normalized
    : undefined;
}

describe("query workbench route state", () => {
  it("round-trips draft preview requests and parameter definitions through route state", () => {
    const request = {
      query: {
        indexId: "workflow:project-branch-board",
        kind: "collection",
        window: { limit: 25 },
      },
      version: serializedQueryVersion,
    } as const;
    const parameterDefinitions = [
      {
        defaultValue: "workflow-project:io",
        label: "Project",
        name: "project",
        required: false,
        type: "string",
      },
    ] as const;

    const encoded = encodeQueryWorkbenchDraft({
      parameterDefinitions,
      request,
    });
    expect(validateQueryRouteSearch({ draft: encoded })).toEqual({ draft: encoded });
    expect(decodeQueryWorkbenchDraft(encoded)).toEqual({
      parameterDefinitions,
      request,
    });
  });

  it("round-trips draft preview requests without relying on Buffer", () => {
    const request = {
      query: {
        indexId: "workflow:project-branch-board",
        kind: "collection",
        window: { limit: 25 },
      },
      version: serializedQueryVersion,
    } as const;
    const globalBuffer = Object.getOwnPropertyDescriptor(globalThis, "Buffer");

    Reflect.defineProperty(globalThis, "Buffer", {
      configurable: true,
      enumerable: globalBuffer?.enumerable ?? false,
      value: undefined,
      writable: true,
    });

    try {
      const encoded = encodeQueryWorkbenchDraft(request);
      expect(decodeQueryWorkbenchDraft(encoded)).toEqual({ request });
    } finally {
      if (globalBuffer) {
        Reflect.defineProperty(globalThis, "Buffer", globalBuffer);
      } else {
        Reflect.deleteProperty(globalThis, "Buffer");
      }
    }
  });

  it("preserves invalid route state so previews fail closed instead of falling back", () => {
    const search = validateQueryRouteSearch({
      draft: "not-a-valid-draft",
      params: "not-valid-params",
      queryId: "saved-query:1",
    });

    expect(search).toEqual({
      draft: "not-a-valid-draft",
      params: "not-valid-params",
      queryId: "saved-query:1",
    });
    const catalog = createInstalledQueryEditorCatalog();
    expect(
      resolveQueryWorkbenchRouteTarget(search, createQueryWorkbenchMemoryStore(), catalog),
    ).toEqual({
      code: "invalid-params",
      kind: "invalid",
      message: "Route parameter overrides are invalid or stale.",
    });
  });

  it("fails closed when route state references stale saved entries", () => {
    const catalog = createInstalledQueryEditorCatalog();
    const store = createQueryWorkbenchMemoryStore();

    expect(
      resolveQueryWorkbenchRouteTarget({ queryId: "saved-query:missing" }, store, catalog),
    ).toEqual({
      code: "stale-query",
      kind: "invalid",
      message: 'Saved query "saved-query:missing" is no longer available.',
    });

    expect(
      resolveQueryWorkbenchRouteTarget({ viewId: "saved-view:missing" }, store, catalog),
    ).toEqual({
      code: "stale-view",
      kind: "invalid",
      message: 'Saved view "saved-view:missing" is no longer available.',
    });

    expect(
      resolveQueryWorkbenchRouteTarget({ draft: "not-a-valid-draft" }, store, catalog),
    ).toEqual({
      code: "invalid-draft",
      kind: "invalid",
      message: "Draft preview state is invalid or stale.",
    });
  });

  it("treats a blank route as an uncommitted draft instead of issuing a preview request", () => {
    const installedCatalog = createInstalledQueryEditorCatalog();
    const coreSurface = installedCatalog.surfaces.find(
      (surface) => surface.surfaceId === coreBuiltInQuerySurfaceIds.savedQueryLibrary,
    );
    const workflowSurface = installedCatalog.surfaces.find(
      (surface) => surface.surfaceId === "workflow:project-branch-board",
    );
    if (!coreSurface || !workflowSurface) {
      throw new Error("Expected installed workflow and core surfaces.");
    }
    const catalog = createQueryEditorCatalog([coreSurface, workflowSurface]);

    expect(
      resolveQueryWorkbenchRouteTarget({}, createQueryWorkbenchMemoryStore(), catalog),
    ).toEqual({
      kind: "blank",
    });
  });

  it("seeds the initial installed workbench draft with an empty workflow project filter", () => {
    const draft = createQueryWorkbenchInitialDraft(createInstalledQueryEditorCatalog());

    expect(draft.surfaceId).toBe("workflow:project-branch-board");
    expect(draft.filters).toEqual([]);
  });
});

describe("query workbench preview runtime", () => {
  it("executes inline draft previews through the shared runtime path", async () => {
    const executedRequests: SerializedQueryRequest[] = [];
    const parameterDefinitions = [
      {
        defaultValue: "workflow-project:io",
        label: "Project",
        name: "project",
        required: false,
        type: "string",
      },
    ] as const;
    const runtime = createQueryWorkbenchPreviewRuntime(createQueryWorkbenchMemoryStore(), {
      inlineParameterDefinitions: parameterDefinitions,
      executePage: async (request) => {
        executedRequests.push(request);
        return createRuntimeResultPage();
      },
    });
    const request = {
      params: {
        project: "workflow-project:io",
      },
      query: {
        filter: {
          fieldId: "projectId",
          op: "eq",
          value: {
            kind: "param",
            name: "project",
          },
        },
        indexId: "workflow:project-branch-board",
        kind: "collection",
        order: [{ direction: "desc", fieldId: "updated-at" }],
        window: {
          limit: 25,
        },
      },
      version: serializedQueryVersion,
    } as const;

    const value = await runtime.load(
      createInlineQueryContainer(request, {
        containerId: "draft-preview",
        pagination: {
          mode: "paged",
          pageSize: 1,
        },
        refresh: {
          mode: "manual",
        },
        renderer: {
          rendererId: "default:list",
        },
      }),
    );

    expect(executedRequests).toEqual([
      {
        ...request,
        query: {
          ...request.query,
          window: {
            limit: 1,
          },
        },
      },
    ]);
    expect(value.state).toMatchObject({
      kind: "ready",
    });
  });

  it("routes workflow and core saved-query previews through the same shared runtime", async () => {
    const catalog = createInstalledQueryEditorCatalog();
    const store = createQueryWorkbenchMemoryStore();
    const workflowQuery = saveQueryWorkbenchQuery({
      catalog,
      draft: {
        ...createQueryEditorDraft(catalog, "workflow:project-branch-board"),
        filters: [
          {
            fieldId: "state",
            id: "filter:state",
            operator: "eq",
            value: { kind: "param", name: "state" },
          },
        ],
        parameters: [
          {
            defaultValue: "active",
            id: "param:state",
            label: "State",
            name: "state",
            required: false,
            type: "enum",
          },
        ],
      },
      name: "Owner board",
      store,
    });
    const coreQuery = saveQueryWorkbenchQuery({
      catalog,
      draft: {
        ...createQueryEditorDraft(catalog, coreBuiltInQuerySurfaceIds.savedQueryLibrary),
        filters: [
          {
            fieldId: "surfaceModuleId",
            id: "filter:surface-module-id",
            operator: "eq",
            value: { kind: "param", name: "surface-module-id" },
          },
        ],
        parameters: [
          {
            defaultValue: "core",
            id: "param:surface-module-id",
            label: "Surface Module",
            name: "surface-module-id",
            required: false,
            type: "string",
          },
        ],
      },
      name: "Saved query library",
      store,
    });

    const executedRequests: SerializedQueryRequest[] = [];
    const runtime = createQueryWorkbenchPreviewRuntime(store, {
      catalog,
      executePage: async (request) => {
        executedRequests.push(request);
        return createRuntimeResultPage();
      },
    });

    await runtime.load(
      createSavedQueryContainer(
        {
          params: { state: "ready" },
          queryId: workflowQuery.id,
        },
        {
          containerId: `saved-query:${workflowQuery.id}`,
          pagination: {
            mode: "paged",
            pageSize: 25,
          },
          refresh: {
            mode: "manual",
          },
          renderer: {
            rendererId: "default:list",
          },
        },
      ),
    );
    await runtime.load(
      createSavedQueryContainer(
        {
          params: { "surface-module-id": "workflow" },
          queryId: coreQuery.id,
        },
        {
          containerId: `saved-query:${coreQuery.id}`,
          pagination: {
            mode: "paged",
            pageSize: 25,
          },
          refresh: {
            mode: "manual",
          },
          renderer: {
            rendererId: "default:table",
          },
        },
      ),
    );

    expect(executedRequests).toEqual([
      {
        params: {
          state: "ready",
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
      {
        params: {
          "surface-module-id": "workflow",
        },
        query: {
          filter: {
            fieldId: "surfaceModuleId",
            op: "eq",
            value: {
              kind: "param",
              name: "surface-module-id",
            },
          },
          indexId: coreBuiltInQuerySurfaceIds.savedQueryLibrary,
          kind: "collection",
          window: {
            limit: 25,
          },
        },
        version: serializedQueryVersion,
      },
    ]);
  });
});

describe("query workbench saves", () => {
  it("saves queries and views through the shared helpers", () => {
    const catalog = createInstalledQueryEditorCatalog();
    const draft = createQueryEditorDraft(catalog);
    const store = createQueryWorkbenchMemoryStore();
    const rendererCapabilities = createQueryRendererCapabilityMap(builtInQueryRendererRegistry);

    const query = saveQueryWorkbenchQuery({
      catalog,
      draft,
      name: "Branch board",
      store,
    });

    expect(query.id).toBe("saved-query:1");
    expect(store.listQueries()).toHaveLength(1);

    const saved = saveQueryWorkbenchView({
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
          rendererId: "default:list",
        },
      },
      store,
      surface: {
        ...workflowBoardSurface,
      },
      viewName: "Branch board view",
    });

    expect(saved.query.id).toBe("saved-query:2");
    expect(saved.query.name).toBe("Branch board");
    expect(saved.view.id).toBe("saved-view:1");
    expect(saved.view.name).toBe("Branch board view");
    expect(store.listViews()).toHaveLength(1);
  });

  it("updates the active saved query and view ids instead of creating duplicates", () => {
    const catalog = createInstalledQueryEditorCatalog();
    const draft = createQueryEditorDraft(catalog);
    const store = createQueryWorkbenchMemoryStore();
    const rendererCapabilities = createQueryRendererCapabilityMap(builtInQueryRendererRegistry);

    const savedQuery = saveQueryWorkbenchQuery({
      catalog,
      draft,
      name: "Branch board",
      store,
    });

    const savedView = saveQueryWorkbenchView({
      catalog,
      draft,
      queryId: savedQuery.id,
      queryName: "Branch board updated",
      rendererCapabilities,
      spec: {
        containerId: "saved-view-preview",
        pagination: {
          mode: "paged",
          pageSize: 10,
        },
        refresh: {
          mode: "manual",
        },
        renderer: {
          rendererId: "default:list",
        },
      },
      store,
      surface: {
        ...workflowBoardSurface,
      },
      viewName: "Branch board view",
    });

    const updated = saveQueryWorkbenchView({
      catalog,
      draft: {
        ...draft,
        pagination: {
          after: "",
          limit: 5,
        },
      },
      queryId: savedQuery.id,
      queryName: "Branch board final",
      rendererCapabilities,
      spec: {
        containerId: "saved-view-preview",
        pagination: {
          mode: "paged",
          pageSize: 5,
        },
        refresh: {
          mode: "manual",
        },
        renderer: {
          rendererId: "default:table",
        },
      },
      store,
      surface: {
        ...workflowBoardSurface,
      },
      viewId: savedView.view.id,
      viewName: "Branch board view final",
    });

    expect(updated.query.id).toBe(savedQuery.id);
    expect(updated.view.id).toBe(savedView.view.id);
    expect(store.listQueries()).toHaveLength(1);
    expect(store.listViews()).toHaveLength(1);
    expect(store.getQuery(savedQuery.id)?.name).toBe("Branch board final");
    expect(store.getView(savedView.view.id)?.name).toBe("Branch board view final");
    expect(store.getView(savedView.view.id)?.spec.renderer.rendererId).toBe("default:table");
  });

  it("rejects incompatible saved views", () => {
    const catalog = createInstalledQueryEditorCatalog();
    const draft = createQueryEditorDraft(catalog);
    const store = createQueryWorkbenchMemoryStore();

    expect(() =>
      saveQueryWorkbenchView({
        catalog,
        draft,
        queryName: "Invalid board",
        rendererCapabilities: createQueryRendererCapabilityMap(builtInQueryRendererRegistry),
        spec: {
          containerId: "saved-view-preview",
          pagination: {
            mode: "paged",
            pageSize: 25,
          },
          renderer: {
            rendererId: "default:table",
          },
        },
        store,
        surface: {
          compatibleRendererIds: ["default:list"],
          itemEntityIds: "required",
          queryKind: "collection",
          resultKind: "collection",
          sourceKinds: ["saved-query", "inline"],
          surfaceId: "workflow:project-branch-board",
          surfaceVersion: workflowBoardSurfaceVersion,
        },
        viewName: "Invalid board view",
      }),
    ).toThrow(QueryWorkbenchSaveError);
  });

  it("reopens saved queries and views end to end through route state and preview execution", async () => {
    const catalog = createInstalledQueryEditorCatalog();
    const draft = createQueryEditorDraft(catalog);
    const store = createQueryWorkbenchMemoryStore();
    const rendererCapabilities = createQueryRendererCapabilityMap(builtInQueryRendererRegistry);

    const savedQuery = saveQueryWorkbenchQuery({
      catalog,
      draft: {
        ...draft,
        filters: [
          {
            fieldId: "state",
            id: "filter:state",
            operator: "eq",
            value: { kind: "param", name: "state" },
          },
        ],
        parameters: [
          {
            defaultValue: "active",
            id: "param:state",
            label: "State",
            name: "state",
            required: false,
            type: "enum",
          },
        ],
      },
      name: "Owner board",
      store,
    });
    const savedView = saveQueryWorkbenchView({
      catalog,
      draft: {
        ...draft,
        filters: [
          {
            fieldId: "state",
            id: "filter:state",
            operator: "eq",
            value: { kind: "param", name: "state" },
          },
        ],
        parameters: [
          {
            defaultValue: "active",
            id: "param:state",
            label: "State",
            name: "state",
            required: false,
            type: "enum",
          },
        ],
      },
      queryName: "Owner board view query",
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
          rendererId: "default:list",
        },
      },
      store,
      surface: {
        ...workflowBoardSurface,
      },
      viewName: "Owner board view",
    });

    const savedQueryTarget = resolveQueryWorkbenchRouteTarget(
      { queryId: savedQuery.id },
      store,
      catalog,
    );
    const savedViewTarget = resolveQueryWorkbenchRouteTarget(
      { viewId: savedView.view.id },
      store,
      catalog,
    );
    const params = decodeQueryWorkbenchParameterOverrides(
      encodeQueryWorkbenchParameterOverrides({ state: "ready" }),
    );
    const resolver = createQueryWorkbenchSourceResolver(store);

    expect(savedQueryTarget).toMatchObject({
      kind: "saved-query",
      query: expect.objectContaining({ id: savedQuery.id }),
    });
    expect(savedViewTarget).toMatchObject({
      kind: "saved-view",
      view: expect.objectContaining({ id: savedView.view.id }),
    });

    const resolvedSavedQuery = await resolver(
      {
        kind: "saved-query",
        params,
        queryId: savedQuery.id,
      },
      {},
    );
    const resolvedSavedView = await resolver(savedView.view.spec.query, {});

    expect(readResolvedRequest(resolvedSavedQuery)).toEqual({
      params: {
        state: "ready",
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
    });
    expect(readResolvedRequest(resolvedSavedView)).toEqual({
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
    });
  });

  it("reopens core saved-query-library queries and views through the same shared helpers", async () => {
    const catalog = createInstalledQueryEditorCatalog();
    const draft = createQueryEditorDraft(catalog, coreBuiltInQuerySurfaceIds.savedQueryLibrary);
    const store = createQueryWorkbenchMemoryStore();
    const rendererCapabilities = createQueryRendererCapabilityMap(builtInQueryRendererRegistry);

    const savedQuery = saveQueryWorkbenchQuery({
      catalog,
      draft: {
        ...draft,
        filters: [
          {
            fieldId: "surfaceModuleId",
            id: "filter:surface-module-id",
            operator: "eq",
            value: { kind: "param", name: "surface-module-id" },
          },
        ],
        parameters: [
          {
            defaultValue: "core",
            id: "param:surface-module-id",
            label: "Surface Module",
            name: "surface-module-id",
            required: false,
            type: "string",
          },
        ],
      },
      name: "Saved query library",
      store,
    });
    const savedView = saveQueryWorkbenchView({
      catalog,
      draft: {
        ...draft,
        filters: [
          {
            fieldId: "surfaceModuleId",
            id: "filter:surface-module-id",
            operator: "eq",
            value: { kind: "param", name: "surface-module-id" },
          },
        ],
        parameters: [
          {
            defaultValue: "core",
            id: "param:surface-module-id",
            label: "Surface Module",
            name: "surface-module-id",
            required: false,
            type: "string",
          },
        ],
      },
      queryName: "Saved query library view query",
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
          rendererId: "default:table",
        },
      },
      store,
      surface: {
        ...coreSavedQueryLibrarySurface,
      },
      viewName: "Saved query library view",
    });

    const savedQueryTarget = resolveQueryWorkbenchRouteTarget(
      { queryId: savedQuery.id },
      store,
      catalog,
    );
    const savedViewTarget = resolveQueryWorkbenchRouteTarget(
      { viewId: savedView.view.id },
      store,
      catalog,
    );
    const params = decodeQueryWorkbenchParameterOverrides(
      encodeQueryWorkbenchParameterOverrides({ "surface-module-id": "workflow" }),
    );
    const resolver = createQueryWorkbenchSourceResolver(store);

    expect(savedQueryTarget).toMatchObject({
      kind: "saved-query",
      query: expect.objectContaining({ id: savedQuery.id }),
    });
    expect(savedViewTarget).toMatchObject({
      kind: "saved-view",
      view: expect.objectContaining({ id: savedView.view.id }),
    });

    const resolvedSavedQuery = await resolver(
      {
        kind: "saved-query",
        params,
        queryId: savedQuery.id,
      },
      {},
    );
    const resolvedSavedView = await resolver(savedView.view.spec.query, {});

    expect(readResolvedRequest(resolvedSavedQuery)).toEqual({
      params: {
        "surface-module-id": "workflow",
      },
      query: {
        filter: {
          fieldId: "surfaceModuleId",
          op: "eq",
          value: {
            kind: "param",
            name: "surface-module-id",
          },
        },
        indexId: coreBuiltInQuerySurfaceIds.savedQueryLibrary,
        kind: "collection",
        window: {
          limit: 25,
        },
      },
      version: serializedQueryVersion,
    });
    expect(readResolvedRequest(resolvedSavedView)).toEqual({
      params: {
        "surface-module-id": "core",
      },
      query: {
        filter: {
          fieldId: "surfaceModuleId",
          op: "eq",
          value: {
            kind: "param",
            name: "surface-module-id",
          },
        },
        indexId: coreBuiltInQuerySurfaceIds.savedQueryLibrary,
        kind: "collection",
        window: {
          limit: 25,
        },
      },
      version: serializedQueryVersion,
    });
  });
});

describe("query workbench draft hydration", () => {
  it("hydrates saved query requests back into the editor draft", () => {
    const catalog = createInstalledQueryEditorCatalog();
    const draft = hydrateQueryWorkbenchDraft({
      catalog,
      target: {
        kind: "saved-query",
        query: {
          id: "saved-query:owner-board",
          catalogId: workflowCatalogId,
          catalogVersion: workflowCatalogVersion,
          name: "Owner board",
          parameterDefinitions: [
            {
              defaultValue: "active",
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
              order: [{ direction: "desc", fieldId: "updated-at" }],
              window: {
                limit: 25,
              },
            },
            version: serializedQueryVersion,
          },
          surfaceId: "workflow:project-branch-board",
          surfaceVersion: workflowBoardSurfaceVersion,
          updatedAt: "2026-03-26T00:00:00.000Z",
        },
      },
    });

    expect(draft?.draft.surfaceId).toBe("workflow:project-branch-board");
    expect(draft?.draft.filters).toEqual([
      {
        fieldId: "state",
        id: "filter:1",
        operator: "eq",
        value: {
          kind: "param",
          name: "state",
        },
      },
    ]);
    expect(draft?.draft.sorts).toEqual([
      {
        direction: "desc",
        fieldId: "updated-at",
        id: "sort:1",
      },
    ]);
    expect(draft?.queryName).toBe("Owner board");
  });

  it("fails closed when saved query hydration becomes stale against the current catalog", () => {
    const catalog = createInstalledQueryEditorCatalog();
    const store = createQueryWorkbenchMemoryStore({
      queries: [
        {
          id: "saved-query:stale-surface",
          catalogId: workflowCatalogId,
          catalogVersion: workflowCatalogVersion,
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
          updatedAt: "2026-03-26T00:00:00.000Z",
        },
      ],
    });

    const resolved = resolveQueryWorkbenchState({
      catalog,
      target: resolveQueryWorkbenchRouteTarget(
        {
          queryId: "saved-query:stale-surface",
        },
        store,
        catalog,
      ),
    });

    expect(resolved.hydrated).toBeUndefined();
    expect(resolved.target).toEqual({
      code: "stale-query",
      kind: "invalid",
      message:
        'Saved query "saved-query:stale-surface" references removed query surface "workflow:missing-surface".',
    });
  });

  it("fails closed when saved query catalog versions drift from the installed registry", () => {
    const catalog = createInstalledQueryEditorCatalog();
    const store = createQueryWorkbenchMemoryStore({
      queries: [
        {
          id: "saved-query:stale-catalog",
          catalogId: workflowCatalogId,
          catalogVersion: "query-catalog:workflow:v0",
          name: "Catalog drift",
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
          updatedAt: "2026-03-26T00:00:00.000Z",
        },
      ],
    });

    const resolved = resolveQueryWorkbenchState({
      catalog,
      target: resolveQueryWorkbenchRouteTarget(
        {
          queryId: "saved-query:stale-catalog",
        },
        store,
        catalog,
      ),
    });

    expect(resolved.hydrated).toBeUndefined();
    expect(resolved.target).toEqual({
      code: "incompatible-query",
      kind: "invalid",
      message:
        'Saved query "saved-query:stale-catalog" references incompatible query catalog "workflow:query-surfaces@query-catalog:workflow:v0".',
    });
  });

  it("fails closed when saved view refs drift away from the saved query binding", () => {
    const catalog = createInstalledQueryEditorCatalog();
    const store = createQueryWorkbenchMemoryStore({
      queries: [
        {
          id: "saved-query:owner-board",
          catalogId: workflowCatalogId,
          catalogVersion: workflowCatalogVersion,
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
          updatedAt: "2026-03-26T00:00:00.000Z",
        },
      ],
      views: [
        {
          id: "saved-view:owner-board",
          catalogId: workflowCatalogId,
          catalogVersion: workflowCatalogVersion,
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
          updatedAt: "2026-03-26T00:00:00.000Z",
        },
      ],
    });

    const resolved = resolveQueryWorkbenchState({
      catalog,
      rendererCapabilities: createQueryRendererCapabilityMap(builtInQueryRendererRegistry),
      resolveSurfaceCompatibility: () => ({ ...workflowBoardSurface }),
      target: resolveQueryWorkbenchRouteTarget(
        {
          viewId: "saved-view:owner-board",
        },
        store,
        catalog,
      ),
    });

    expect(resolved.hydrated).toBeUndefined();
    expect(resolved.target).toEqual({
      code: "incompatible-view",
      kind: "invalid",
      message:
        'Saved view "saved-view:owner-board" references saved query "saved-query:other" in its container binding but is stored against "saved-query:owner-board".',
    });
  });

  it("fails closed when saved view renderer compatibility no longer matches the current runtime", () => {
    const catalog = createInstalledQueryEditorCatalog();
    const store = createQueryWorkbenchMemoryStore();
    const draft = createQueryEditorDraft(catalog);
    const rendererCapabilities = createQueryRendererCapabilityMap(builtInQueryRendererRegistry);

    const saved = saveQueryWorkbenchView({
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
          rendererId: "default:table",
        },
      },
      store,
      surface: {
        ...workflowBoardSurface,
      },
      viewName: "Branch board view",
    });

    const resolved = resolveQueryWorkbenchState({
      catalog,
      rendererCapabilities,
      resolveSurfaceCompatibility: () => ({
        ...workflowBoardSurface,
        compatibleRendererIds: ["default:list"],
      }),
      target: resolveQueryWorkbenchRouteTarget(
        {
          viewId: saved.view.id,
        },
        store,
        catalog,
      ),
    });

    expect(resolved.hydrated).toBeUndefined();
    expect(resolved.target).toEqual({
      code: "incompatible-view",
      kind: "invalid",
      message:
        'Saved view "saved-view:1" has incompatible container defaults: Query container renderer.rendererId is not compatible with query surface "workflow:project-branch-board".',
    });
  });

  it("fails closed when draft hydration becomes stale against the current catalog", () => {
    const catalog = createInstalledQueryEditorCatalog();
    const resolved = resolveQueryWorkbenchState({
      catalog,
      target: {
        kind: "draft",
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
      },
    });

    expect(resolved.hydrated).toBeUndefined();
    expect(resolved.target).toEqual({
      code: "invalid-draft",
      kind: "invalid",
      message: "Draft preview state is stale against the current query surfaces.",
    });
  });
});

describe("query workbench browser store", () => {
  it("persists saved queries and views across browser-store instances", () => {
    const storage = createMemoryStorage();
    const first = createQueryWorkbenchBrowserStore({ key: "test-store", storage });
    first.saveQuery({
      catalogId: workflowCatalogId,
      catalogVersion: workflowCatalogVersion,
      id: "saved-query:1",
      name: "Branch board",
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
    first.saveView({
      catalogId: workflowCatalogId,
      catalogVersion: workflowCatalogVersion,
      id: "saved-view:1",
      name: "Branch board view",
      queryId: "saved-query:1",
      spec: {
        containerId: "saved-view-preview",
        pagination: {
          mode: "paged",
          pageSize: 25,
        },
        query: {
          kind: "saved-query",
          queryId: "saved-query:1",
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

    const second = createQueryWorkbenchBrowserStore({ key: "test-store", storage });
    expect(second.listQueries()).toHaveLength(1);
    expect(second.listViews()).toHaveLength(1);
    expect(second.getQuery("saved-query:1")?.name).toBe("Branch board");
    expect(second.getView("saved-view:1")?.name).toBe("Branch board view");
  });
});

describe("query workbench saved-source resolution", () => {
  it("recovers fail-closed when a saved query disappears", async () => {
    const store = createQueryWorkbenchMemoryStore();
    const resolver = createQueryWorkbenchSourceResolver(store);

    await expect(
      resolver(
        {
          kind: "saved-query",
          queryId: "saved-query:missing",
        },
        {},
      ),
    ).rejects.toMatchObject({
      code: "saved-query-stale",
      message: 'Saved query "saved-query:missing" is no longer available.',
    });
  });
});

function createRuntimeResultPage() {
  return {
    freshness: {
      completeness: "complete" as const,
      freshness: "current" as const,
    },
    items: [
      {
        key: "row:1",
        payload: {
          title: "Runtime preview",
        },
      },
    ],
    kind: "collection" as const,
  };
}

function createMemoryStorage(): {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
} {
  const entries = new Map<string, string>();
  return {
    getItem(key) {
      return entries.get(key) ?? null;
    },
    removeItem(key) {
      entries.delete(key);
    },
    setItem(key, value) {
      entries.set(key, value);
    },
  };
}

function requireSurfaceCompatibility(surfaceId: string) {
  const installedSurface = getInstalledQuerySurface(installedQuerySurfaceRegistry, surfaceId);
  const surface = installedSurface
    ? createQuerySurfaceRendererCompatibility(installedSurface)
    : undefined;
  if (!surface) {
    throw new Error(`Expected installed surface compatibility for "${surfaceId}".`);
  }
  return surface;
}
