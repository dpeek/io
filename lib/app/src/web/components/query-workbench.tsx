"use client";

import type { QueryLiteral } from "@io/graph-client";
import { Badge } from "@io/web/badge";
import { Button } from "@io/web/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@io/web/card";
import { Field, FieldContent, FieldGroup, FieldLabel } from "@io/web/field";
import { Input } from "@io/web/input";
import { useEffect, useMemo, useState } from "react";

import {
  mountInlineQueryRenderer,
  mountSavedQueryRenderer,
  createQueryContainerRuntime,
  type QueryContainerSpec,
  type QuerySurfaceRendererCompatibility,
} from "../lib/query-container.js";
import {
  getQueryEditorSurface,
  serializeQueryEditorDraft,
  validateQueryEditorDraft,
  type QueryEditorDraft,
} from "../lib/query-editor.js";
import {
  QueryWorkbenchSaveError,
  createQueryWorkbenchBrowserStore,
  createQueryWorkbenchInitialDraft,
  createQueryWorkbenchSourceResolver,
  decodeQueryWorkbenchParamOverrides,
  encodeQueryWorkbenchDraft,
  encodeQueryWorkbenchParamOverrides,
  executeQueryWorkbenchPreviewRequest,
  resolveQueryWorkbenchState,
  resolveQueryWorkbenchRouteTarget,
  saveQueryWorkbenchQuery,
  saveQueryWorkbenchView,
  type QueryWorkbenchStore,
  type QueryWorkbenchRouteSearch,
} from "../lib/query-workbench.js";
import { QueryEditor, createQueryEditorDemoCatalog } from "./query-editor.js";
import {
  builtInQueryRendererRegistry,
  createCardGridRendererBinding,
  createListRendererBinding,
  createQueryRendererCapabilityMap,
  createTableRendererBinding,
} from "./query-renderers.js";
import { QueryRouteMount } from "./query-route-mount.js";

const catalog = createQueryEditorDemoCatalog();
const rendererCapabilities = createQueryRendererCapabilityMap(builtInQueryRendererRegistry);
const rendererIds = ["core:list", "core:table", "core:card-grid"] as const;

type QueryWorkbenchProps = {
  readonly onSearchChange?: (search: QueryWorkbenchRouteSearch) => void | Promise<void>;
  readonly search?: QueryWorkbenchRouteSearch;
  readonly store?: QueryWorkbenchStore;
};

type PreviewControls = {
  readonly pageSize: number;
  readonly rendererId: (typeof rendererIds)[number];
};

const defaultPreviewControls: PreviewControls = {
  pageSize: 25,
  rendererId: "core:list",
};

function createPreviewRendererBinding(rendererId: PreviewControls["rendererId"]) {
  if (rendererId === "core:table") {
    return createTableRendererBinding([
      { fieldId: "title", label: "Title" },
      { fieldId: "status", label: "Status" },
      { fieldId: "ownerName", label: "Owner" },
    ]);
  }
  if (rendererId === "core:card-grid") {
    return createCardGridRendererBinding({
      badgeField: "status",
      fields: [
        { fieldId: "ownerName", label: "Owner" },
        { fieldId: "updatedAt", label: "Updated" },
      ],
      titleField: "title",
    });
  }
  return createListRendererBinding({
    metaFields: [{ fieldId: "status", label: "Status" }],
    titleField: "title",
  });
}

export function QueryWorkbench({
  onSearchChange,
  search = {},
  store: providedStore,
}: QueryWorkbenchProps) {
  const [store] = useState(() => providedStore ?? createQueryWorkbenchBrowserStore());
  const initialState = resolveQueryWorkbenchState({
    catalog,
    target: resolveQueryWorkbenchRouteTarget(search, store),
  });
  const [draft, setDraft] = useState<QueryEditorDraft>(() => {
    return initialState.hydrated?.draft ?? createQueryWorkbenchInitialDraft(catalog);
  });
  const [queryName, setQueryName] = useState(() => {
    return initialState.hydrated?.queryName ?? "Branch board query";
  });
  const [viewName, setViewName] = useState(() => {
    return initialState.hydrated?.viewName ?? "Branch board view";
  });
  const [previewControls, setPreviewControls] = useState(defaultPreviewControls);
  const [saveError, setSaveError] = useState<string | undefined>();

  const resolvedState = useMemo(
    () =>
      resolveQueryWorkbenchState({
        catalog,
        target: resolveQueryWorkbenchRouteTarget(search, store),
      }),
    [search, store],
  );
  const routeTarget = resolvedState.target;
  const hydratedState = resolvedState.hydrated;
  const validation = validateQueryEditorDraft(draft, catalog);
  const serialized = validation.ok ? serializeQueryEditorDraft(draft, catalog) : undefined;
  const activeSurface = getQueryEditorSurface(catalog, draft.surfaceId);
  const activeSurfaceId =
    routeTarget.kind === "saved-view"
      ? routeTarget.view.surfaceId
      : routeTarget.kind === "saved-query"
        ? routeTarget.query.surfaceId
        : (activeSurface?.surfaceId ?? draft.surfaceId);
  const surface = useMemo(() => createWorkbenchSurface(activeSurfaceId), [activeSurfaceId]);
  const routeParams = search.params ? decodeQueryWorkbenchParamOverrides(search.params) : undefined;
  const runtime = useMemo(
    () =>
      createQueryContainerRuntime({
        executePage: (request) => executeQueryWorkbenchPreviewRequest(request),
        resolveSource: createQueryWorkbenchSourceResolver(store),
      }),
    [store],
  );

  const previewSpec = useMemo(() => {
    if (routeTarget.kind === "invalid") {
      return undefined;
    }
    if (routeTarget.kind === "saved-view") {
      return routeParams
        ? {
            ...routeTarget.view.spec,
            query: {
              ...routeTarget.view.spec.query,
              params: routeParams,
            },
          }
        : routeTarget.view.spec;
    }
    const source =
      routeTarget.kind === "saved-query"
        ? {
            kind: "saved" as const,
            params: routeParams,
            queryId: routeTarget.query.id,
          }
        : {
            kind: "inline" as const,
            request: routeTarget.request,
          };
    const mountOptions = {
      containerId:
        routeTarget.kind === "saved-query"
          ? `saved-query:${routeTarget.query.id}`
          : "draft-preview",
      pagination: {
        mode: "paged" as const,
        pageSize: previewControls.pageSize,
      },
      refresh: {
        mode: "manual" as const,
      },
      renderer: createPreviewRendererBinding(previewControls.rendererId),
    };
    return (
      source.kind === "saved"
        ? mountSavedQueryRenderer(source, mountOptions)
        : mountInlineQueryRenderer(source.request, mountOptions)
    ) satisfies QueryContainerSpec;
  }, [previewControls.pageSize, previewControls.rendererId, routeParams, routeTarget]);

  const activeParameters =
    routeTarget.kind === "saved-query"
      ? routeTarget.query.parameterDefinitions
      : routeTarget.kind === "saved-view"
        ? routeTarget.query.parameterDefinitions
        : [];

  useEffect(() => {
    if (!hydratedState) {
      return;
    }
    if (
      routeTarget.kind === "draft" &&
      serialized &&
      JSON.stringify(serialized.request) === JSON.stringify(routeTarget.request)
    ) {
      return;
    }
    setDraft(hydratedState.draft);
    setQueryName(hydratedState.queryName ?? "Branch board query");
    setViewName(hydratedState.viewName ?? "Branch board view");
    setSaveError(undefined);
  }, [hydratedState, routeTarget, serialized]);

  const editingSavedQueryId =
    routeTarget.kind === "saved-query"
      ? routeTarget.query.id
      : routeTarget.kind === "saved-view"
        ? routeTarget.query.id
        : undefined;
  const editingSavedViewId = routeTarget.kind === "saved-view" ? routeTarget.view.id : undefined;

  return (
    <div className="grid gap-4">
      <QueryEditor
        catalog={catalog}
        description="Author inline queries, preview them through the shared query container, and persist saved queries or saved views through the current browser-backed proof store."
        draft={draft}
        footer={
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <Card className="border-border/70 border">
              <CardHeader>
                <CardTitle className="text-base">Preview Route State</CardTitle>
                <CardDescription>
                  Draft previews sync to route state, while saved queries and views can be reopened
                  by stable ids with optional parameter overrides.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="query-preview-name">Save query as</FieldLabel>
                    <FieldContent>
                      <Input
                        id="query-preview-name"
                        onChange={(event) => setQueryName(event.target.value)}
                        value={queryName}
                      />
                    </FieldContent>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="view-preview-name">Save view as</FieldLabel>
                    <FieldContent>
                      <Input
                        id="view-preview-name"
                        onChange={(event) => setViewName(event.target.value)}
                        value={viewName}
                      />
                    </FieldContent>
                  </Field>
                </FieldGroup>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      if (!serialized) {
                        return;
                      }
                      setSaveError(undefined);
                      void onSearchChange?.({
                        draft: encodeQueryWorkbenchDraft(serialized.request),
                      });
                    }}
                    type="button"
                    variant="outline"
                  >
                    Preview draft
                  </Button>
                  <Button
                    onClick={() => {
                      try {
                        const saved = saveQueryWorkbenchQuery({
                          catalog,
                          draft,
                          id: editingSavedQueryId,
                          name: queryName,
                          store,
                        });
                        setSaveError(undefined);
                        void onSearchChange?.({ queryId: saved.id });
                      } catch (error) {
                        setSaveError(readSaveError(error));
                      }
                    }}
                    type="button"
                    variant="outline"
                  >
                    {editingSavedQueryId ? "Update query" : "Save query"}
                  </Button>
                  <Button
                    onClick={() => {
                      try {
                        const saved = saveQueryWorkbenchView({
                          catalog,
                          draft,
                          queryId: editingSavedQueryId,
                          queryName,
                          rendererCapabilities,
                          spec: {
                            containerId: "saved-view-preview",
                            pagination: {
                              mode: "paged",
                              pageSize: previewControls.pageSize,
                            },
                            refresh: {
                              mode: "manual",
                            },
                            renderer: {
                              rendererId: previewControls.rendererId,
                            },
                          },
                          store,
                          surface,
                          viewId: editingSavedViewId,
                          viewName,
                        });
                        setSaveError(undefined);
                        void onSearchChange?.({ viewId: saved.view.id });
                      } catch (error) {
                        setSaveError(readSaveError(error));
                      }
                    }}
                    type="button"
                  >
                    {editingSavedViewId ? "Update view" : "Save view"}
                  </Button>
                </div>
                {saveError ? (
                  <div className="rounded-xl border border-amber-400/40 bg-amber-50/60 px-3 py-2 text-xs">
                    {saveError}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="border-border/70 border">
              <CardHeader>
                <CardTitle className="text-base">Preview Binding</CardTitle>
                <CardDescription>
                  Shared container chrome drives inline previews and saved-view reopens through one
                  runtime path.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="query-preview-renderer">Renderer</FieldLabel>
                    <FieldContent>
                      <select
                        className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                        id="query-preview-renderer"
                        onChange={(event) =>
                          setPreviewControls((current) => ({
                            ...current,
                            rendererId: event.target.value as PreviewControls["rendererId"],
                          }))
                        }
                        value={previewControls.rendererId}
                      >
                        {rendererIds.map((rendererId) => (
                          <option key={rendererId} value={rendererId}>
                            {rendererId}
                          </option>
                        ))}
                      </select>
                    </FieldContent>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="query-preview-page-size">Page size</FieldLabel>
                    <FieldContent>
                      <Input
                        id="query-preview-page-size"
                        min={1}
                        onChange={(event) =>
                          setPreviewControls((current) => ({
                            ...current,
                            pageSize: Math.max(1, Number(event.target.value) || 1),
                          }))
                        }
                        type="number"
                        value={String(previewControls.pageSize)}
                      />
                    </FieldContent>
                  </Field>
                </FieldGroup>
                {activeParameters.length > 0 ? (
                  <ParameterOverrideEditor
                    parameterNames={activeParameters.map((parameter) => parameter.name)}
                    search={search}
                    onSearchChange={onSearchChange}
                  />
                ) : (
                  <div className="text-muted-foreground text-xs">
                    Open a saved query or saved view with parameters to test route-state overrides.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        }
        onDraftChange={(nextDraft) => {
          setDraft(nextDraft);
          const nextValidation = validateQueryEditorDraft(nextDraft, catalog);
          if (!nextValidation.ok) {
            return;
          }
          const nextSerialized = serializeQueryEditorDraft(nextDraft, catalog);
          void onSearchChange?.({
            draft: encodeQueryWorkbenchDraft(nextSerialized.request),
          });
        }}
        title="Query Authoring"
      />

      <Card className="border-border/70 bg-card/95 border shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Saved State</CardTitle>
              <CardDescription>
                Query ids and view ids reopen through route state. Missing saved entries fail closed
                instead of silently falling back.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{store.listQueries().length} queries</Badge>
              <Badge variant="outline">{store.listViews().length} views</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          {store.listQueries().map((query) => (
            <Button
              key={query.id}
              onClick={() => void onSearchChange?.({ queryId: query.id })}
              type="button"
              variant="outline"
            >
              Open query: {query.name}
            </Button>
          ))}
          {store.listViews().map((view) => (
            <Button
              key={view.id}
              onClick={() => void onSearchChange?.({ viewId: view.id })}
              type="button"
              variant="outline"
            >
              Open view: {view.name}
            </Button>
          ))}
          {store.listQueries().length === 0 && store.listViews().length === 0 ? (
            <div className="text-muted-foreground text-sm">
              Save a query or view to populate the route-addressable catalog.
            </div>
          ) : null}
        </CardContent>
      </Card>

      {routeTarget.kind === "invalid" ? (
        <Card className="border-destructive/30 bg-card/95 border shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Preview unavailable</CardTitle>
            <CardDescription>{routeTarget.message}</CardDescription>
          </CardHeader>
        </Card>
      ) : previewSpec ? (
        <QueryRouteMount
          description="Shared query container preview path for inline drafts, saved queries, and saved views."
          executePage={(request) => executeQueryWorkbenchPreviewRequest(request)}
          resolveSource={createQueryWorkbenchSourceResolver(store)}
          runtime={runtime}
          spec={previewSpec}
          surface={surface}
          title="Query Preview"
        />
      ) : null}
    </div>
  );
}

function createWorkbenchSurface(surfaceId: string): QuerySurfaceRendererCompatibility {
  return {
    compatibleRendererIds: [...rendererIds],
    itemEntityIds: "optional",
    queryKind: "collection",
    resultKind: "collection",
    sourceKinds: ["saved", "inline"],
    surfaceId,
  };
}

function ParameterOverrideEditor({
  onSearchChange,
  parameterNames,
  search,
}: {
  readonly onSearchChange?: (search: QueryWorkbenchRouteSearch) => void | Promise<void>;
  readonly parameterNames: readonly string[];
  readonly search: QueryWorkbenchRouteSearch;
}) {
  const overrides = search.params ? (decodeQueryWorkbenchParamOverrides(search.params) ?? {}) : {};

  return (
    <div className="grid gap-3">
      {parameterNames.map((name) => (
        <Field key={name}>
          <FieldLabel htmlFor={`query-param-${name}`}>{name}</FieldLabel>
          <FieldContent>
            <Input
              id={`query-param-${name}`}
              onChange={(event) => {
                const nextOverrides = {
                  ...overrides,
                  [name]: event.target.value,
                };
                if (event.target.value.trim().length === 0) {
                  delete (nextOverrides as Record<string, QueryLiteral>)[name];
                }
                const nextParams =
                  Object.keys(nextOverrides).length > 0
                    ? encodeQueryWorkbenchParamOverrides(nextOverrides)
                    : undefined;
                void onSearchChange?.({
                  ...(search.queryId ? { queryId: search.queryId } : {}),
                  ...(search.viewId ? { viewId: search.viewId } : {}),
                  ...(search.draft ? { draft: search.draft } : {}),
                  ...(nextParams ? { params: nextParams } : {}),
                });
              }}
              value={typeof overrides[name] === "string" ? overrides[name] : ""}
            />
          </FieldContent>
        </Field>
      ))}
    </div>
  );
}

function readSaveError(error: unknown): string {
  if (error instanceof QueryWorkbenchSaveError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
