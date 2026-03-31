"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@io/web/card";
import { useEffect, useState, type ReactNode } from "react";

import type { QueryContainerPageExecutor } from "../lib/query-container.js";
import type { QueryRouteSearch } from "../lib/query-route-state.js";
import type { QueryWorkbenchSavedQuery, QueryWorkbenchSavedView } from "../lib/query-workbench.js";
import {
  createGraphBackedSavedQueryRepository,
  createSavedQueryDefinitionInputFromDraft,
  createSavedViewDefinitionInput,
  deriveSavedQueryRecord,
  deriveSavedViewRecord,
} from "../lib/saved-query.js";
import { GraphAccessGate, useWebAuthSession } from "./auth-shell.js";
import { useExplorerSyncSnapshot } from "./explorer/sync.js";
import { GraphRuntimeBootstrap, useGraphRuntime } from "./graph-runtime-bootstrap.js";
import {
  QueryWorkbench,
  type QueryWorkbenchSavedState,
  type QueryWorkbenchSaveQueryInput,
  type QueryWorkbenchSaveViewInput,
} from "./query-workbench.js";

type QueryPageProps = {
  readonly executePreviewPage?: QueryContainerPageExecutor;
  readonly onSearchChange?: (search: QueryRouteSearch) => void | Promise<void>;
  readonly search?: QueryRouteSearch;
};

export type QueryPageSurfaceProps = QueryPageProps & {
  readonly principalId: string;
};

type QueryPageSavedLibraryState = QueryWorkbenchSavedState & {
  readonly queries: readonly QueryWorkbenchSavedQuery[];
  readonly views: readonly QueryWorkbenchSavedView[];
};

function readErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

function compareSavedEntries(
  left: { readonly name: string; readonly updatedAt: string },
  right: { readonly name: string; readonly updatedAt: string },
): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name);
}

function upsertSavedEntry<
  T extends {
    readonly id: string;
    readonly name: string;
    readonly updatedAt: string;
  },
>(entries: readonly T[], next: T): readonly T[] {
  return [...entries.filter((entry) => entry.id !== next.id), next].sort(compareSavedEntries);
}

function QueryPageView({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pr-1" data-query-page="">
      <div className="space-y-2">
        <div className="text-xs font-medium tracking-[0.18em] text-sky-700 uppercase">
          Query Authoring
        </div>
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Query</h1>
          <p className="text-muted-foreground max-w-3xl text-sm leading-6">
            Author inline queries, reopen graph-backed saved queries or views through explicit route
            state, and inspect live results beside the editor through the shared query-container
            runtime.
          </p>
        </div>
      </div>

      {children}
    </div>
  );
}

function SavedSelectionLoadingCard() {
  return (
    <Card className="border-border/70 bg-card/95 border shadow-sm" data-query-page-loading="">
      <CardHeader>
        <CardTitle className="text-base">Loading saved selection</CardTitle>
        <CardDescription>
          Resolving the graph-backed saved query or view referenced by the current `/query` route
          state before the editor and results panel rehydrate.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-muted-foreground text-sm">
        The route waits for the synced graph runtime instead of silently falling back to a
        browser-only proof store.
      </CardContent>
    </Card>
  );
}

export function QueryPageSurface({
  executePreviewPage,
  onSearchChange,
  principalId,
  search = {},
}: QueryPageSurfaceProps) {
  const runtime = useGraphRuntime();
  const syncSnapshot = useExplorerSyncSnapshot(runtime.sync);
  const [savedLibrary, setSavedLibrary] = useState<QueryPageSavedLibraryState>(() => ({
    queries: [],
    status: "loading",
    views: [],
  }));

  useEffect(() => {
    let cancelled = false;
    const repository = createGraphBackedSavedQueryRepository(runtime.graph, principalId);

    void Promise.all([repository.listSavedQueries(), repository.listSavedViews()])
      .then(([queries, views]) => {
        if (cancelled) {
          return;
        }
        const queryById = new Map(queries.map((query) => [query.id, query]));
        setSavedLibrary({
          queries: queries.map((query) => deriveSavedQueryRecord(query)),
          status: "ready",
          views: views.flatMap((view) => {
            const query = queryById.get(view.queryId);
            return query ? [deriveSavedViewRecord({ query, view })] : [];
          }),
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setSavedLibrary((current) => ({
          ...current,
          message: readErrorMessage(
            error,
            "Unable to load graph-backed saved queries and views for this principal.",
          ),
          status: "error",
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [
    principalId,
    runtime.graph,
    syncSnapshot.pendingTransactions.length,
    syncSnapshot.state.cursor,
  ]);

  async function handleSaveQuery(input: QueryWorkbenchSaveQueryInput) {
    const repository = createGraphBackedSavedQueryRepository(runtime.graph, principalId);
    const saved = await repository.saveSavedQuery({
      ...(input.id ? { id: input.id } : {}),
      ...createSavedQueryDefinitionInputFromDraft({
        catalog: input.catalog,
        draft: input.draft,
        name: input.name,
        ownerId: principalId,
      }),
    });
    await runtime.sync.flush();
    const record = deriveSavedQueryRecord(saved);
    setSavedLibrary((current) => ({
      queries: upsertSavedEntry(current.queries, record),
      status: "ready",
      views: current.views,
    }));
    return record;
  }

  async function handleSaveView(input: QueryWorkbenchSaveViewInput) {
    if (!input.surface) {
      throw new Error(
        `Saved view "${input.viewName.trim() || "Untitled view"}" does not have a current renderer compatibility contract.`,
      );
    }

    const repository = createGraphBackedSavedQueryRepository(runtime.graph, principalId);
    const query = await repository.saveSavedQuery({
      ...(input.queryId ? { id: input.queryId } : {}),
      ...createSavedQueryDefinitionInputFromDraft({
        catalog: input.catalog,
        draft: input.draft,
        name: input.queryName,
        ownerId: principalId,
      }),
    });
    const savedView = await repository.saveSavedView({
      ...(input.viewId ? { id: input.viewId } : {}),
      ...createSavedViewDefinitionInput({
        name: input.viewName,
        ownerId: principalId,
        queryId: query.id,
        rendererCapabilities: input.rendererCapabilities,
        spec: input.spec,
        surface: input.surface,
      }),
    });
    await runtime.sync.flush();
    const queryRecord = deriveSavedQueryRecord(query);
    const viewRecord = deriveSavedViewRecord({
      query,
      view: savedView,
    });
    setSavedLibrary((current) => ({
      queries: upsertSavedEntry(current.queries, queryRecord),
      status: "ready",
      views: upsertSavedEntry(current.views, viewRecord),
    }));
    return {
      query: queryRecord,
      view: viewRecord,
    };
  }

  if (savedLibrary.status === "loading" && (search.queryId || search.viewId)) {
    return (
      <QueryPageView>
        <SavedSelectionLoadingCard />
      </QueryPageView>
    );
  }

  return (
    <QueryPageView>
      <QueryWorkbench
        executePreviewPage={executePreviewPage}
        onSaveQuery={handleSaveQuery}
        onSaveView={handleSaveView}
        onSearchChange={onSearchChange}
        savedQueries={savedLibrary.queries}
        savedState={{
          ...(savedLibrary.message ? { message: savedLibrary.message } : {}),
          status: savedLibrary.status,
        }}
        savedViews={savedLibrary.views}
        search={search}
      />
    </QueryPageView>
  );
}

function QueryPageRuntimeSurface(props: QueryPageProps) {
  const auth = useWebAuthSession();

  if (auth.status !== "ready") {
    return null;
  }

  return <QueryPageSurface {...props} principalId={auth.principalId} />;
}

export function QueryPage(props: QueryPageProps) {
  return (
    <GraphAccessGate
      description="Resolve an authenticated Better Auth session before booting `/query` against the synced graph runtime and the shared serialized-query transport."
      title="Sign in to open query authoring"
    >
      <GraphRuntimeBootstrap>
        <QueryPageRuntimeSurface {...props} />
      </GraphRuntimeBootstrap>
    </GraphAccessGate>
  );
}
