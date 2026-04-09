"use client";

import {
  createInlineQueryContainer,
  createSavedQueryContainer,
  getQueryEditorSurface,
  serializeQueryEditorDraft,
  validateQueryEditorDraft,
  type QueryContainerPageExecutor,
  type QueryContainerSpec,
  type QueryEditorCatalog,
  type QueryEditorDraft,
  type QueryRendererCapability,
  type QuerySurfaceRendererCompatibility,
} from "@io/graph-query";
import type { QueryLiteral } from "@io/graph-client";
import {
  QueryContainerMount as QueryRouteMount,
  QueryEditor,
  builtInQueryRendererRegistry,
  createDefaultCardGridRendererBinding,
  createDefaultListRendererBinding,
  createDefaultTableRendererBinding,
  createQueryRendererCapabilityMap,
} from "@io/graph-query/react-dom";
import { Alert, AlertDescription, AlertTitle } from "@io/web/alert";
import { Badge } from "@io/web/badge";
import { Button } from "@io/web/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@io/web/card";
import { Empty, EmptyDescription } from "@io/web/empty";
import { Field, FieldContent, FieldGroup, FieldLabel } from "@io/web/field";
import { Input } from "@io/web/input";
import { NativeSelect, NativeSelectOption } from "@io/web/native-select";
import { useEffect, useMemo, useState } from "react";

import {
  QueryWorkbenchSaveError,
  createQueryWorkbenchBrowserStore,
  createQueryWorkbenchInitialDraft,
  createQueryWorkbenchMemoryStore,
  createQueryWorkbenchPreviewRuntime,
  decodeQueryWorkbenchParameterOverrides,
  encodeQueryWorkbenchDraft,
  encodeQueryWorkbenchParameterOverrides,
  resolveQueryWorkbenchState,
  resolveQueryWorkbenchRouteTarget,
  saveQueryWorkbenchQuery,
  saveQueryWorkbenchView,
  type QueryWorkbenchSavedQuery,
  type QueryWorkbenchSavedView,
  type QueryWorkbenchStore,
} from "../lib/query-workbench.js";
import {
  createQueryRouteSearch,
  isQueryRoutePreviewRendererId,
  queryRoutePreviewRendererIds,
  resolveQueryRoutePreviewState,
  type QueryRoutePreviewRendererId,
  type QueryRouteSearch,
} from "../lib/query-route-state.js";
import {
  getInstalledModuleQuerySurfaceRegistry,
  getInstalledModuleQuerySurface,
  installedModuleQueryEditorCatalog,
  getInstalledModuleQuerySurfaceRendererCompatibility,
} from "../lib/query-surface-registry.js";

const catalog = installedModuleQueryEditorCatalog;
const rendererCapabilities = createQueryRendererCapabilityMap(builtInQueryRendererRegistry);

export type QueryWorkbenchSavedState = {
  readonly message?: string;
  readonly status: "error" | "loading" | "ready";
};

export type QueryWorkbenchSaveQueryInput = {
  readonly catalog: QueryEditorCatalog;
  readonly draft: QueryEditorDraft;
  readonly id?: string;
  readonly name: string;
};

export type QueryWorkbenchSaveViewInput = {
  readonly catalog: QueryEditorCatalog;
  readonly draft: QueryEditorDraft;
  readonly queryId?: string;
  readonly queryName: string;
  readonly rendererCapabilities: Readonly<Record<string, QueryRendererCapability>>;
  readonly spec: Omit<QueryContainerSpec, "query">;
  readonly surface?: QuerySurfaceRendererCompatibility;
  readonly viewId?: string;
  readonly viewName: string;
};

type QueryWorkbenchProps = {
  readonly executePreviewPage?: QueryContainerPageExecutor;
  readonly onSearchChange?: (search: QueryRouteSearch) => void | Promise<void>;
  readonly onSaveQuery?: (input: QueryWorkbenchSaveQueryInput) => Promise<QueryWorkbenchSavedQuery>;
  readonly onSaveView?: (input: QueryWorkbenchSaveViewInput) => Promise<{
    readonly query: QueryWorkbenchSavedQuery;
    readonly view: QueryWorkbenchSavedView;
  }>;
  readonly savedQueries?: readonly QueryWorkbenchSavedQuery[];
  readonly savedState?: QueryWorkbenchSavedState;
  readonly savedViews?: readonly QueryWorkbenchSavedView[];
  readonly search?: QueryRouteSearch;
  readonly store?: QueryWorkbenchStore;
};

type PreviewControls = {
  readonly pageSize: number;
  readonly rendererId: QueryRoutePreviewRendererId;
};

function createPreviewRendererBinding(_rendererId: PreviewControls["rendererId"]) {
  return createDefaultListRendererBinding({
    metaFields: [{ fieldId: "state", label: "State" }],
    titleField: "title",
  });
}

function preferredSelectionField(
  fieldIds: readonly string[],
  preferred: readonly string[],
): string | undefined {
  for (const fieldId of preferred) {
    if (fieldIds.includes(fieldId)) {
      return fieldId;
    }
  }
  return fieldIds[0];
}

function createPreviewRendererBindingForSurface(
  rendererId: PreviewControls["rendererId"],
  surfaceId: string,
) {
  const surface = getInstalledModuleQuerySurface(
    getInstalledModuleQuerySurfaceRegistry(),
    surfaceId,
  );
  const fieldIds = surface?.selections?.map((selection) => selection.fieldId) ?? [
    "title",
    "state",
    "updatedAt",
  ];
  const titleField = preferredSelectionField(fieldIds, ["title", "name", "id"]);
  const badgeField = preferredSelectionField(fieldIds, ["state", "status", "kind"]);
  const remainingFields = fieldIds.filter(
    (fieldId) => fieldId !== titleField && fieldId !== badgeField,
  );

  if (rendererId === "default:table") {
    return createDefaultTableRendererBinding(
      [titleField, badgeField, ...remainingFields.slice(0, 2)]
        .filter((fieldId): fieldId is string => typeof fieldId === "string")
        .map((fieldId) => ({
          fieldId,
          label: fieldId,
        })),
    );
  }
  if (rendererId === "default:card-grid") {
    return createDefaultCardGridRendererBinding({
      ...(badgeField ? { badgeField } : {}),
      fields: remainingFields.slice(0, 2).map((fieldId) => ({
        fieldId,
        label: fieldId,
      })),
      ...(titleField ? { titleField } : {}),
    });
  }
  return createPreviewRendererBinding(rendererId);
}

function readPreviewModeLabel(
  routeTarget: ReturnType<typeof resolveQueryWorkbenchState>["target"],
): string {
  switch (routeTarget.kind) {
    case "blank":
      return "draft setup";
    case "draft":
      return "live draft";
    case "saved-query":
      return "saved query";
    case "saved-view":
      return "saved view";
    case "invalid":
      return "unavailable";
  }
}

function readPreviewSelectionLabel(
  routeTarget: ReturnType<typeof resolveQueryWorkbenchState>["target"],
): string {
  switch (routeTarget.kind) {
    case "blank":
      return "Fill the draft to start previewing results.";
    case "draft":
      return "Current editor draft";
    case "saved-query":
      return routeTarget.query.name;
    case "saved-view":
      return routeTarget.view.name;
    case "invalid":
      return routeTarget.message;
  }
}

export function QueryWorkbench({
  executePreviewPage,
  onSearchChange,
  onSaveQuery,
  onSaveView,
  savedQueries = [],
  savedState,
  savedViews = [],
  search = {},
  store: providedStore,
}: QueryWorkbenchProps) {
  const store = useMemo(
    () =>
      providedStore ??
      (savedState
        ? createQueryWorkbenchMemoryStore({
            queries: savedQueries,
            views: savedViews,
          })
        : createQueryWorkbenchBrowserStore()),
    [providedStore, savedQueries, savedState, savedViews],
  );
  const initialState = resolveQueryWorkbenchState({
    catalog,
    rendererCapabilities,
    resolveSurfaceCompatibility: getInstalledModuleQuerySurfaceRendererCompatibility,
    target: resolveQueryWorkbenchRouteTarget(search, store, catalog),
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
  const [savePending, setSavePending] = useState<"query" | "view" | undefined>();
  const [saveError, setSaveError] = useState<string | undefined>();

  const resolvedState = useMemo(
    () =>
      resolveQueryWorkbenchState({
        catalog,
        rendererCapabilities,
        resolveSurfaceCompatibility: getInstalledModuleQuerySurfaceRendererCompatibility,
        target: resolveQueryWorkbenchRouteTarget(search, store, catalog),
      }),
    [search, store],
  );
  const routeTarget = resolvedState.target;
  const hydratedState = resolvedState.hydrated;
  const validation = validateQueryEditorDraft(draft, catalog);
  const serialized = validation.ok ? serializeQueryEditorDraft(draft, catalog) : undefined;
  const previewControls = useMemo(
    () =>
      resolveQueryRoutePreviewState({
        fallback:
          routeTarget.kind === "saved-view"
            ? {
                pageSize: routeTarget.view.spec.pagination?.pageSize,
                ...(isQueryRoutePreviewRendererId(routeTarget.view.spec.renderer.rendererId)
                  ? { rendererId: routeTarget.view.spec.renderer.rendererId }
                  : {}),
              }
            : undefined,
        search,
      }),
    [routeTarget, search],
  );
  const activeSurface = getQueryEditorSurface(catalog, draft.surfaceId);
  const activeSurfaceId =
    routeTarget.kind === "saved-view"
      ? routeTarget.view.surfaceId
      : routeTarget.kind === "saved-query"
        ? routeTarget.query.surfaceId
        : (activeSurface?.surfaceId ?? draft.surfaceId);
  const surface = useMemo(
    () => getInstalledModuleQuerySurfaceRendererCompatibility(activeSurfaceId),
    [activeSurfaceId],
  );
  const routeParams = search.params
    ? decodeQueryWorkbenchParameterOverrides(search.params)
    : undefined;
  const previewRuntime = useMemo(
    () =>
      createQueryWorkbenchPreviewRuntime(store, {
        catalog,
        executePage: executePreviewPage,
        inlineParameterDefinitions:
          routeTarget.kind === "draft" ? routeTarget.parameterDefinitions : undefined,
      }),
    [executePreviewPage, routeTarget, store],
  );

  function buildRouteSearch(
    next: Omit<QueryRouteSearch, "pageSize" | "rendererId">,
    previewState: PreviewControls = previewControls,
  ): QueryRouteSearch {
    return createQueryRouteSearch({
      ...next,
      pageSize: previewState.pageSize,
      rendererId: previewState.rendererId,
    });
  }

  function buildSearchFromCurrentRoute(
    previewState: PreviewControls = previewControls,
  ): QueryRouteSearch {
    return buildRouteSearch(
      {
        draft: search.draft,
        params: search.params,
        queryId: search.queryId,
        viewId: search.viewId,
      },
      previewState,
    );
  }

  const previewSpec = useMemo(() => {
    if (routeTarget.kind === "blank" || routeTarget.kind === "invalid") {
      return undefined;
    }
    if (routeTarget.kind === "saved-view") {
      return {
        ...routeTarget.view.spec,
        pagination: {
          ...(routeTarget.view.spec.pagination ?? { mode: "paged" as const }),
          pageSize: previewControls.pageSize,
        },
        query: routeParams
          ? {
              ...routeTarget.view.spec.query,
              params: routeParams,
            }
          : routeTarget.view.spec.query,
        renderer: {
          ...routeTarget.view.spec.renderer,
          rendererId: previewControls.rendererId,
        },
      } satisfies QueryContainerSpec;
    }
    const source =
      routeTarget.kind === "saved-query"
        ? {
            kind: "saved-query" as const,
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
      renderer: createPreviewRendererBindingForSurface(previewControls.rendererId, activeSurfaceId),
    };
    return (
      source.kind === "saved-query"
        ? createSavedQueryContainer(source, mountOptions)
        : createInlineQueryContainer(source.request, mountOptions)
    ) satisfies QueryContainerSpec;
  }, [
    activeSurfaceId,
    previewControls.pageSize,
    previewControls.rendererId,
    routeParams,
    routeTarget,
  ]);

  const activeParameters =
    routeTarget.kind === "saved-query"
      ? routeTarget.query.parameterDefinitions
      : routeTarget.kind === "saved-view"
        ? routeTarget.query.parameterDefinitions
        : [];
  const previewModeLabel = readPreviewModeLabel(routeTarget);
  const previewSelectionLabel = readPreviewSelectionLabel(routeTarget);
  const previewDraftNotice = !validation.ok
    ? "Current editor draft is invalid. Results stay pinned to the last valid route state until the draft validates again."
    : undefined;

  useEffect(() => {
    if (!hydratedState) {
      return;
    }
    if (
      routeTarget.kind === "draft" &&
      serialized &&
      JSON.stringify({
        parameterDefinitions: serialized.parameterDefinitions,
        request: serialized.request,
      }) ===
        JSON.stringify({
          parameterDefinitions: routeTarget.parameterDefinitions,
          request: routeTarget.request,
        })
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
  const listedQueries = store.listQueries();
  const listedViews = store.listViews();
  const isSaving = savePending !== undefined;
  const savedLibraryMessage =
    savedState?.status === "loading"
      ? "Loading graph-backed saved queries and views from the synced graph runtime."
      : savedState?.status === "error"
        ? savedState.message
        : undefined;

  async function handleSaveQuery(): Promise<void> {
    try {
      setSavePending("query");
      const saved = await Promise.resolve(
        onSaveQuery
          ? onSaveQuery({
              catalog,
              draft,
              id: editingSavedQueryId,
              name: queryName,
            })
          : saveQueryWorkbenchQuery({
              catalog,
              draft,
              id: editingSavedQueryId,
              name: queryName,
              store,
            }),
      );
      setSaveError(undefined);
      await onSearchChange?.(
        buildRouteSearch({
          ...(search.params ? { params: search.params } : {}),
          queryId: saved.id,
        }),
      );
    } catch (error) {
      setSaveError(readSaveError(error));
    } finally {
      setSavePending(undefined);
    }
  }

  async function handleSaveView(): Promise<void> {
    try {
      setSavePending("view");
      const saved = await Promise.resolve(
        onSaveView
          ? onSaveView({
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
              surface,
              viewId: editingSavedViewId,
              viewName,
            })
          : saveQueryWorkbenchView({
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
            }),
      );
      setSaveError(undefined);
      await onSearchChange?.(
        buildRouteSearch({
          ...(search.params ? { params: search.params } : {}),
          viewId: saved.view.id,
        }),
      );
    } catch (error) {
      setSaveError(readSaveError(error));
    } finally {
      setSavePending(undefined);
    }
  }

  return (
    <div
      className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]"
      data-query-workbench=""
    >
      <div className="grid min-w-0 content-start gap-4" data-query-workbench-authoring="">
        <QueryEditor
          catalog={catalog}
          description="Author core and workflow queries from one installed catalog. Valid draft edits sync straight into route state while results run beside the editor through the shared query-container runtime and `/api/query` transport."
          draft={draft}
          onDraftChange={(nextDraft) => {
            setDraft(nextDraft);
            const nextValidation = validateQueryEditorDraft(nextDraft, catalog);
            if (!nextValidation.ok) {
              return;
            }
            const nextSerialized = serializeQueryEditorDraft(nextDraft, catalog);
            void onSearchChange?.(
              buildRouteSearch({
                draft: encodeQueryWorkbenchDraft({
                  parameterDefinitions: nextSerialized.parameterDefinitions,
                  request: nextSerialized.request,
                }),
              }),
            );
          }}
          title="Query Draft"
        />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
          <Card data-query-workbench-save="">
            <CardHeader>
              <CardTitle className="text-base">Save And Reopen</CardTitle>
              <CardDescription>
                Saved queries and saved views keep the current route-addressable selection explicit.
                Draft edits update the active preview automatically whenever the request remains
                valid.
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
                  disabled={isSaving || !validation.ok}
                  onClick={() => {
                    void handleSaveQuery();
                  }}
                  type="button"
                  variant="outline"
                >
                  {editingSavedQueryId ? "Update query" : "Save query"}
                </Button>
                <Button
                  disabled={isSaving || !validation.ok}
                  onClick={() => {
                    void handleSaveView();
                  }}
                  type="button"
                >
                  {editingSavedViewId ? "Update view" : "Save view"}
                </Button>
              </div>
              {saveError ? (
                <Alert variant="destructive">
                  <AlertTitle>Unable to save the current draft</AlertTitle>
                  <AlertDescription>{saveError}</AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card data-query-workbench-library="">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Saved Queries And Views</CardTitle>
                  <CardDescription>
                    Query ids and view ids reopen through route state. Missing saved entries stay
                    explicit instead of silently falling back.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{listedQueries.length} queries</Badge>
                  <Badge variant="outline">{listedViews.length} views</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 lg:grid-cols-2">
              {savedLibraryMessage ? (
                savedState?.status === "error" ? (
                  <Alert className="lg:col-span-2" variant="destructive">
                    <AlertTitle>Saved library unavailable</AlertTitle>
                    <AlertDescription>{savedLibraryMessage}</AlertDescription>
                  </Alert>
                ) : (
                  <div className="text-muted-foreground text-sm lg:col-span-2">
                    {savedLibraryMessage}
                  </div>
                )
              ) : null}
              {listedQueries.map((query) => (
                <Button
                  key={query.id}
                  onClick={() =>
                    void onSearchChange?.(
                      buildRouteSearch({
                        queryId: query.id,
                      }),
                    )
                  }
                  type="button"
                  variant="outline"
                >
                  Open query: {query.name}
                </Button>
              ))}
              {listedViews.map((view) => (
                <Button
                  key={view.id}
                  onClick={() =>
                    void onSearchChange?.(
                      buildRouteSearch({
                        viewId: view.id,
                      }),
                    )
                  }
                  type="button"
                  variant="outline"
                >
                  Open view: {view.name}
                </Button>
              ))}
              {listedQueries.length === 0 &&
              listedViews.length === 0 &&
              savedState?.status !== "loading" ? (
                <Empty className="border-border bg-muted/20 flex-none p-4 lg:col-span-2">
                  <EmptyDescription className="text-sm">
                    Save a query or view to populate the route-addressable catalog.
                  </EmptyDescription>
                </Empty>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid content-start gap-4 xl:sticky xl:top-4" data-query-workbench-results="">
        <Card data-query-workbench-preview-controls="">
          <CardHeader className="gap-3">
            <div className="space-y-1">
              <CardTitle className="text-base">Results Panel</CardTitle>
              <CardDescription>
                The active selection resolves through the shared query-container runtime and
                executes over the reusable `/api/query` transport.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{previewModeLabel}</Badge>
              <Badge variant="outline">{activeSurfaceId}</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div
              className="rounded-xl border border-dashed px-3 py-3 text-sm"
              data-query-workbench-preview-selection=""
            >
              <div className="text-muted-foreground text-xs font-medium tracking-[0.18em] uppercase">
                Active selection
              </div>
              <div className="mt-2 font-medium">{previewSelectionLabel}</div>
              {routeTarget.kind === "saved-query" ? (
                <div className="text-muted-foreground text-xs">{routeTarget.query.id}</div>
              ) : routeTarget.kind === "saved-view" ? (
                <div className="text-muted-foreground text-xs">{routeTarget.view.id}</div>
              ) : null}
            </div>
            {previewDraftNotice ? (
              <Alert data-query-workbench-preview-note="draft-invalid" variant="destructive">
                <AlertTitle>Preview pinned to the last valid route state</AlertTitle>
                <AlertDescription>{previewDraftNotice}</AlertDescription>
              </Alert>
            ) : null}
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="query-preview-renderer">Renderer</FieldLabel>
                <FieldContent>
                  <NativeSelect
                    className="w-full"
                    id="query-preview-renderer"
                    onChange={(event) =>
                      void onSearchChange?.(
                        buildSearchFromCurrentRoute({
                          ...previewControls,
                          rendererId: event.target.value as PreviewControls["rendererId"],
                        }),
                      )
                    }
                    value={previewControls.rendererId}
                  >
                    {queryRoutePreviewRendererIds.map((rendererId) => (
                      <NativeSelectOption key={rendererId} value={rendererId}>
                        {rendererId}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel htmlFor="query-preview-page-size">Page size</FieldLabel>
                <FieldContent>
                  <Input
                    id="query-preview-page-size"
                    min={1}
                    onChange={(event) =>
                      void onSearchChange?.(
                        buildSearchFromCurrentRoute({
                          ...previewControls,
                          pageSize: Math.max(1, Number(event.target.value) || 1),
                        }),
                      )
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
                previewControls={previewControls}
                search={search}
                onSearchChange={onSearchChange}
              />
            ) : (
              <Empty className="border-border bg-muted/20 flex-none p-4">
                <EmptyDescription className="text-sm">
                  The current selection does not define any route-level parameter overrides.
                </EmptyDescription>
              </Empty>
            )}
          </CardContent>
        </Card>

        {routeTarget.kind === "invalid" ? (
          <Card className="border-destructive/30 bg-card/95 border shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Preview unavailable</CardTitle>
              <CardDescription>{routeTarget.message}</CardDescription>
            </CardHeader>
          </Card>
        ) : routeTarget.kind === "blank" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preview pending</CardTitle>
              <CardDescription>
                Live results stay idle until the current draft validates and syncs into route state.
                The default blank route keeps the workflow board draft local so `/query` does not
                issue an implicit preview on first load.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : previewSpec ? (
          <QueryRouteMount
            description="Loading, empty, error, pagination, and stale-result states all render through the shared query-container shell."
            runtime={previewRuntime}
            spec={previewSpec}
            surface={surface}
            title="Live Results"
          />
        ) : null}
      </div>
    </div>
  );
}

function ParameterOverrideEditor({
  onSearchChange,
  parameterNames,
  previewControls,
  search,
}: {
  readonly onSearchChange?: (search: QueryRouteSearch) => void | Promise<void>;
  readonly parameterNames: readonly string[];
  readonly previewControls: PreviewControls;
  readonly search: QueryRouteSearch;
}) {
  const overrides = search.params
    ? (decodeQueryWorkbenchParameterOverrides(search.params) ?? {})
    : {};

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
                    ? encodeQueryWorkbenchParameterOverrides(nextOverrides)
                    : undefined;
                void onSearchChange?.(
                  createQueryRouteSearch({
                    ...(search.queryId ? { queryId: search.queryId } : {}),
                    ...(search.viewId ? { viewId: search.viewId } : {}),
                    ...(search.draft ? { draft: search.draft } : {}),
                    ...(nextParams ? { params: nextParams } : {}),
                    pageSize: previewControls.pageSize,
                    rendererId: previewControls.rendererId,
                  }),
                );
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
