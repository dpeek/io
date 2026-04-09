"use client";

import { Button } from "@io/web/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@io/web/card";
import { Skeleton } from "@io/web/skeleton";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  createQueryContainerRuntime,
  type QueryContainerPageExecutor,
  type QueryContainerRuntimeController,
  type QueryContainerRuntimeLoadOptions,
  type QueryContainerRuntimeValue,
  type QueryContainerSourceResolver,
  type QueryContainerSpec,
  type QueryContainerValidationResult,
  type QuerySurfaceRendererCompatibility,
  validateQueryContainer,
} from "../query-container.js";
import { requestSerializedQuery } from "@io/graph-client";
import {
  builtInQueryRendererRegistry,
  createQueryRendererCapabilityMap,
  type QueryRendererAffordanceSet,
  type QueryRendererViewProps,
  type QueryRendererRegistry,
} from "./query-renderers.js";

type QueryContainerSurfaceBaseProps = {
  readonly activeItemKey?: QueryRendererViewProps["activeItemKey"];
  readonly affordances?: QueryRendererAffordanceSet;
  readonly description?: string;
  readonly onActivateItem?: QueryRendererViewProps["onActivateItem"];
  readonly registry?: QueryRendererRegistry;
  readonly spec: QueryContainerSpec;
  readonly surface?: QuerySurfaceRendererCompatibility;
  readonly title?: string;
  readonly validation?: QueryContainerValidationResult;
};

export type QueryContainerSurfaceViewProps = QueryContainerSurfaceBaseProps & {
  readonly onPaginate?: () => void | Promise<void>;
  readonly onRefresh?: () => void | Promise<void>;
  readonly value?: QueryContainerRuntimeValue;
};

export type QueryContainerSurfaceProps = QueryContainerSurfaceBaseProps & {
  readonly executePage?: QueryContainerPageExecutor;
  readonly initialValue?: QueryContainerRuntimeValue;
  readonly loadOptions?: QueryContainerRuntimeLoadOptions;
  readonly onValueChange?: (value: QueryContainerRuntimeValue | undefined) => void;
  readonly resolveSource?: QueryContainerSourceResolver;
  readonly runtime?: QueryContainerRuntimeController;
};

function renderValidationIssues(validation: QueryContainerValidationResult) {
  return (
    <ul className="grid gap-2 text-xs" data-query-container-validation="">
      {validation.issues.map((issue) => (
        <li key={`${issue.code}:${issue.path}`}>
          <span className="font-medium">{issue.code}</span>: {issue.message}
        </li>
      ))}
    </ul>
  );
}

function SurfaceFrame({
  actions,
  children,
  description,
  spec,
  title,
}: {
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly description?: string;
  readonly spec: QueryContainerSpec;
  readonly title?: string;
}) {
  return (
    <Card data-query-container={spec.containerId}>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">{title ?? spec.containerId}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          {actions}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  );
}

function LoadingSurface({
  description,
  spec,
  title,
}: {
  readonly description?: string;
  readonly spec: QueryContainerSpec;
  readonly title?: string;
}) {
  return (
    <SurfaceFrame description={description} spec={spec} title={title}>
      <>
        <div className="grid gap-3" data-query-container-state="loading">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </>
    </SurfaceFrame>
  );
}

function renderStateSummary(value: QueryContainerRuntimeValue) {
  const state = value.state;
  if (state.kind === "stale") {
    return "Results are stale. Refresh to reload the first page.";
  }
  if (state.kind === "refreshing") {
    return "Refreshing from the current query container cache.";
  }
  if (state.kind === "paginated") {
    return "More rows are available.";
  }
  return undefined;
}

export function QueryContainerSurfaceView({
  activeItemKey,
  affordances,
  description,
  onActivateItem,
  onPaginate,
  onRefresh,
  registry = builtInQueryRendererRegistry,
  spec,
  surface,
  title,
  validation,
  value,
}: QueryContainerSurfaceViewProps) {
  const resolvedValidation =
    validation ??
    validateQueryContainer(spec, {
      rendererCapabilities: createQueryRendererCapabilityMap(registry),
      surface,
    });

  if (!resolvedValidation.ok) {
    return (
      <SurfaceFrame description={description} spec={spec} title={title}>
        <>
          <div
            className="text-destructive text-sm font-medium"
            data-query-container-state="invalid"
          >
            Invalid query container binding
          </div>
          {renderValidationIssues(resolvedValidation)}
        </>
      </SurfaceFrame>
    );
  }

  if (!value || value.state.kind === "loading") {
    return <LoadingSurface description={description} spec={spec} title={title} />;
  }

  if (value.state.kind === "error") {
    return (
      <SurfaceFrame description={description} spec={spec} title={title}>
        <>
          <div className="text-destructive text-sm font-medium" data-query-container-state="error">
            {value.state.error.message}
          </div>
          {value.state.error.code ? (
            <div className="text-muted-foreground text-xs">{value.state.error.code}</div>
          ) : null}
        </>
      </SurfaceFrame>
    );
  }

  if (value.state.kind === "empty") {
    return (
      <SurfaceFrame description={description} spec={spec} title={title}>
        <>
          <div className="text-sm font-medium" data-query-container-state="empty">
            No rows matched this query.
          </div>
          <div className="text-muted-foreground text-xs">Renderer: {spec.renderer.rendererId}</div>
        </>
      </SurfaceFrame>
    );
  }

  const renderer = registry[spec.renderer.rendererId];
  if (!renderer) {
    return (
      <SurfaceFrame description={description} spec={spec} title={title}>
        <>
          <div className="text-destructive text-sm font-medium" data-query-container-state="error">
            Unknown renderer "{spec.renderer.rendererId}".
          </div>
        </>
      </SurfaceFrame>
    );
  }

  const Renderer = renderer.Component;
  const isRefreshing = value.state.kind === "refreshing";
  const isStale = value.state.kind === "stale";
  const hasNextPage =
    value.state.kind === "paginated" ||
    value.state.kind === "stale" ||
    value.state.kind === "refreshing";
  const paginationMode = spec.pagination?.mode ?? "paged";
  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button disabled={isRefreshing} onClick={onRefresh} type="button" variant="outline">
        Refresh
      </Button>
      {hasNextPage ? (
        <Button disabled={isRefreshing} onClick={onPaginate} type="button" variant="outline">
          Next page
        </Button>
      ) : null}
    </div>
  );

  return (
    <SurfaceFrame actions={actions} description={description} spec={spec} title={title}>
      <>
        <div className="text-muted-foreground flex flex-wrap gap-2 text-xs">
          <span>Renderer: {spec.renderer.rendererId}</span>
          <span>Query: {value.request.query.kind}</span>
          <span>State: {value.state.kind}</span>
          <span>Rows: {value.state.result.items.length}</span>
          {value.staleRecovery ? (
            <span>
              Recovery: {value.staleRecovery.mode} ({value.staleRecovery.message})
            </span>
          ) : null}
        </div>
        {renderStateSummary(value) ? (
          <div className="bg-muted/40 text-muted-foreground rounded-lg px-3 py-2 text-xs">
            {renderStateSummary(value)}
          </div>
        ) : null}
        <Renderer
          activeItemKey={activeItemKey}
          affordances={affordances}
          container={spec}
          isRefreshing={isRefreshing}
          isStale={isStale}
          onActivateItem={onActivateItem}
          pagination={{
            hasNextPage,
            mode: paginationMode,
            nextCursor: "nextCursor" in value.state ? value.state.nextCursor : undefined,
            pageSize: spec.pagination?.pageSize,
          }}
          result={value.state.result}
          state={value.state}
        />
      </>
    </SurfaceFrame>
  );
}

export function QueryContainerSurface({
  activeItemKey,
  affordances,
  description,
  executePage,
  initialValue,
  loadOptions,
  onActivateItem,
  onValueChange,
  registry = builtInQueryRendererRegistry,
  resolveSource,
  runtime,
  spec,
  surface,
  title,
  validation,
}: QueryContainerSurfaceProps) {
  const controller = useMemo(
    () =>
      runtime ??
      createQueryContainerRuntime({
        executePage:
          executePage ??
          ((request, options) => requestSerializedQuery(request, { signal: options.signal })),
        ...(resolveSource ? { resolveSource } : {}),
      }),
    [executePage, resolveSource, runtime],
  );
  const [value, setValue] = useState<QueryContainerRuntimeValue | undefined>(initialValue);
  const rendererCapabilities = useMemo(
    () => createQueryRendererCapabilityMap(registry),
    [registry],
  );
  const resolvedValidation = useMemo(
    () =>
      validation ??
      validateQueryContainer(spec, {
        rendererCapabilities,
        surface,
      }),
    [rendererCapabilities, spec, surface, validation],
  );

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue, spec]);

  useEffect(() => {
    onValueChange?.(value);
  }, [onValueChange, value]);

  useEffect(() => {
    if (!resolvedValidation.ok) {
      return;
    }

    let cancelled = false;
    void controller.load(spec, loadOptions).then((nextValue) => {
      if (!cancelled) {
        setValue(nextValue);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [controller, loadOptions, resolvedValidation, spec]);

  return (
    <QueryContainerSurfaceView
      activeItemKey={activeItemKey}
      affordances={affordances}
      description={description}
      onActivateItem={onActivateItem}
      onPaginate={() => {
        if (!resolvedValidation.ok) {
          return;
        }
        void controller.paginate(spec, loadOptions).then((nextValue) => {
          setValue(nextValue);
        });
      }}
      onRefresh={() => {
        if (!resolvedValidation.ok) {
          return;
        }
        void controller.refresh(spec, loadOptions).then((nextValue) => {
          setValue(nextValue);
        });
      }}
      registry={registry}
      spec={spec}
      surface={surface}
      title={title}
      validation={resolvedValidation}
      value={value}
    />
  );
}
