"use client";

import type { CollectionSurfaceSpec } from "@io/graph-module";
import type {
  InstalledQuerySurfaceRegistry,
  QueryContainerPageExecutor,
  QueryContainerRuntimeController,
  QueryContainerRuntimeValue,
  QueryEditorCatalog,
} from "@io/graph-query";
import {
  QueryContainerSurface,
  QueryContainerSurfaceView,
  builtInQueryRendererRegistry,
  createQueryRendererCapabilityMap,
  type QueryRendererAffordanceSet,
  type QueryRendererRegistry,
  type QueryRendererViewProps,
} from "@io/graph-query/react-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@io/web/card";
import { useEffect, useMemo, useState } from "react";

import {
  createCollectionSurfaceRuntime,
  resolveCollectionSurfaceBinding,
  type CollectionSurfaceBindingIssue,
  type CollectionSurfaceBinding,
  type CollectionSurfaceRecordLookup,
} from "../collection-surface.js";

type CollectionSurfaceMountBaseProps = {
  readonly activeItemKey?: QueryRendererViewProps["activeItemKey"];
  readonly affordances?: QueryRendererAffordanceSet;
  readonly collection: CollectionSurfaceSpec;
  readonly initialValue?: QueryContainerRuntimeValue;
  readonly onActivateItem?: QueryRendererViewProps["onActivateItem"];
  readonly registry?: QueryRendererRegistry;
};

export type CollectionSurfaceMountViewProps = CollectionSurfaceMountBaseProps & {
  readonly binding?: CollectionSurfaceBinding;
  readonly issue?: CollectionSurfaceBindingIssue;
};

export type CollectionSurfaceMountProps = CollectionSurfaceMountBaseProps & {
  readonly catalog?: QueryEditorCatalog;
  readonly executePage?: QueryContainerPageExecutor;
  readonly lookup: CollectionSurfaceRecordLookup;
  readonly onValueChange?: (value: QueryContainerRuntimeValue | undefined) => void;
  readonly runtime?: QueryContainerRuntimeController;
  readonly surfaceRegistry?: InstalledQuerySurfaceRegistry;
};

type CollectionSurfaceMountState =
  | {
      readonly kind: "loading";
    }
  | {
      readonly binding: CollectionSurfaceBinding;
      readonly kind: "ready";
    }
  | {
      readonly issue: CollectionSurfaceBindingIssue;
      readonly kind: "unavailable";
    };

function CollectionSurfaceUnavailableCard({
  collection,
  issue,
}: {
  readonly collection: CollectionSurfaceSpec;
  readonly issue?: CollectionSurfaceBindingIssue;
}) {
  return (
    <div className="grid gap-3" data-collection-surface={collection.key}>
      <Card data-collection-surface-state={issue ? "unavailable" : "loading"}>
        <CardHeader>
          <CardTitle className="text-base">{collection.title}</CardTitle>
          {collection.description ? (
            <CardDescription>{collection.description}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <div>
            {issue
              ? issue.message
              : `Resolving authored collection surface "${collection.key}" through the installed query-surface registry.`}
          </div>
          {issue ? <div className="text-muted-foreground text-xs">{issue.code}</div> : null}
        </CardContent>
      </Card>
    </div>
  );
}

export function CollectionSurfaceMountView({
  activeItemKey,
  affordances,
  binding,
  collection,
  initialValue,
  issue,
  onActivateItem,
  registry = builtInQueryRendererRegistry,
}: CollectionSurfaceMountViewProps) {
  if (!binding || issue) {
    return <CollectionSurfaceUnavailableCard collection={collection} issue={issue} />;
  }

  return (
    <div className="grid gap-3" data-collection-surface={collection.key}>
      <QueryContainerSurfaceView
        activeItemKey={activeItemKey}
        affordances={affordances}
        description={collection.description}
        onActivateItem={onActivateItem}
        registry={registry}
        spec={binding.spec}
        surface={binding.surface}
        title={collection.title}
        validation={binding.validation}
        value={initialValue}
      />
    </div>
  );
}

export function CollectionSurfaceMount({
  activeItemKey,
  affordances,
  catalog,
  collection,
  executePage,
  initialValue,
  lookup,
  onActivateItem,
  onValueChange,
  registry = builtInQueryRendererRegistry,
  runtime,
  surfaceRegistry,
}: CollectionSurfaceMountProps) {
  const rendererCapabilities = useMemo(
    () => createQueryRendererCapabilityMap(registry),
    [registry],
  );
  const controller = useMemo(
    () =>
      runtime ??
      createCollectionSurfaceRuntime(lookup, {
        catalog,
        executePage,
      }),
    [catalog, executePage, lookup, runtime],
  );
  const [state, setState] = useState<CollectionSurfaceMountState>({
    kind: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });

    void resolveCollectionSurfaceBinding({
      ...(catalog ? { catalog } : {}),
      collection,
      lookup,
      rendererCapabilities,
      ...(surfaceRegistry ? { surfaceRegistry } : {}),
    }).then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setState({
          issue: result.issue,
          kind: "unavailable",
        });
        return;
      }
      setState({
        binding: result.binding,
        kind: "ready",
      });
    });

    return () => {
      cancelled = true;
    };
  }, [catalog, collection, lookup, rendererCapabilities, surfaceRegistry]);

  if (state.kind !== "ready") {
    return (
      <CollectionSurfaceUnavailableCard
        collection={collection}
        issue={state.kind === "unavailable" ? state.issue : undefined}
      />
    );
  }

  return (
    <div className="grid gap-3" data-collection-surface={collection.key}>
      <QueryContainerSurface
        activeItemKey={activeItemKey}
        affordances={affordances}
        description={collection.description}
        initialValue={initialValue}
        onActivateItem={onActivateItem}
        onValueChange={onValueChange}
        registry={registry}
        runtime={controller}
        spec={state.binding.spec}
        surface={state.binding.surface}
        title={collection.title}
        validation={state.binding.validation}
      />
    </div>
  );
}
