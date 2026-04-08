"use client";

import type { RecordSurfaceSpec } from "@io/graph-module";
import type {
  InstalledQuerySurfaceRegistry,
  QueryContainerPageExecutor,
  QueryEditorCatalog,
} from "@io/graph-query";
import {
  builtInQueryRendererRegistry,
  type QueryRendererRegistry,
} from "@io/graph-query/react-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@io/web/card";
import { useEffect, useState, type ReactNode } from "react";

import type { CollectionSurfaceRecordLookup } from "../collection-surface.js";
import {
  resolveRecordSurfaceBinding,
  type RecordSurfaceBinding,
  type RecordSurfaceBindingIssue,
  type RecordSurfaceFieldBinding,
  type RecordSurfaceLookup,
  type RecordSurfaceSectionBinding,
} from "../record-surface.js";
import { CollectionSurfaceMount } from "./collection-surface-mount.js";

type RecordSurfaceChromeProps = {
  readonly badges?: ReactNode;
  readonly children?: ReactNode;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  readonly renderField?: (
    field: RecordSurfaceFieldBinding,
    section: RecordSurfaceSectionBinding,
  ) => ReactNode;
  readonly status?: ReactNode;
  readonly subtitle?: ReactNode;
  readonly summaryItems?: readonly ReactNode[];
  readonly title?: ReactNode;
  readonly titlePrefix?: ReactNode;
  readonly untitledLabel?: ReactNode;
};

export type RecordSurfaceRelatedMountOptions = {
  readonly catalog?: QueryEditorCatalog;
  readonly executePage?: QueryContainerPageExecutor;
  readonly lookup: CollectionSurfaceRecordLookup;
  readonly registry?: QueryRendererRegistry;
  readonly surfaceRegistry: InstalledQuerySurfaceRegistry;
};

export type RecordSurfaceLayoutProps = {
  readonly badges?: ReactNode;
  readonly children: ReactNode;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  readonly status?: ReactNode;
  readonly subtitle?: ReactNode;
  readonly summaryItems?: readonly ReactNode[];
  readonly title: ReactNode;
  readonly titlePrefix?: ReactNode;
};

export type RecordSurfaceSectionViewProps = {
  readonly chrome?: boolean;
  readonly description?: ReactNode;
  readonly emptyMessage?: ReactNode;
  readonly fields: readonly RecordSurfaceFieldBinding[];
  readonly renderField?: (
    field: RecordSurfaceFieldBinding,
    section: RecordSurfaceSectionBinding,
  ) => ReactNode;
  readonly section: RecordSurfaceSectionBinding;
};

type RecordSurfaceMountBaseProps = RecordSurfaceChromeProps & {
  readonly relatedMountOptions?: RecordSurfaceRelatedMountOptions;
  readonly surface: RecordSurfaceSpec;
};

export type RecordSurfaceMountViewProps = RecordSurfaceMountBaseProps & {
  readonly binding?: RecordSurfaceBinding;
  readonly issue?: RecordSurfaceBindingIssue;
};

export type RecordSurfaceMountProps = RecordSurfaceMountBaseProps & {
  readonly lookup: RecordSurfaceLookup;
};

type RecordSurfaceMountState =
  | {
      readonly kind: "loading";
    }
  | {
      readonly binding: RecordSurfaceBinding;
      readonly kind: "ready";
    }
  | {
      readonly issue: RecordSurfaceBindingIssue;
      readonly kind: "unavailable";
    };

function renderInlineValue(value: unknown, fallback?: ReactNode): ReactNode {
  if (value === undefined || value === null) {
    return fallback ?? "Untitled";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return fallback ?? "Untitled";
    }
    return value.map((item) => String(item)).join(", ");
  }
  if (typeof value === "string") {
    if (value.length === 0) {
      return fallback ?? "Untitled";
    }
    return value;
  }
  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function renderFieldValue(value: unknown): ReactNode {
  if (value === undefined || value === null) {
    return <span className="text-muted-foreground text-sm">Unset</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground text-sm">Empty</span>;
    }
    return (
      <ul className="flex flex-col gap-1.5 text-sm [&_li]:list-none">
        {value.map((item, index) => (
          <li className="text-foreground break-words" key={`${index}:${String(item)}`}>
            {renderFieldValue(item)}
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === "string") {
    if (value.length === 0) {
      return <span className="text-muted-foreground text-sm">Empty string</span>;
    }
    return <span className="text-foreground text-sm break-words">{value}</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-foreground text-sm">{value ? "True" : "False"}</span>;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return <span className="text-foreground text-sm">{String(value)}</span>;
  }
  if (typeof value === "object") {
    try {
      return (
        <code className="text-foreground block text-xs break-all whitespace-pre-wrap">
          {JSON.stringify(value, null, 2)}
        </code>
      );
    } catch {
      return <span className="text-foreground text-sm break-words">{String(value)}</span>;
    }
  }
  return <span className="text-foreground text-sm break-words">{String(value)}</span>;
}

function SurfaceCard({
  children,
  description,
  title,
}: {
  readonly children: ReactNode;
  readonly description?: ReactNode;
  readonly title: ReactNode;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col">
      <Card className="border-border/70 bg-card/95 flex h-full min-h-0 flex-col border shadow-sm">
        <CardHeader className="border-border/60 border-b">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <CardTitle>{title}</CardTitle>
              {description ? <CardDescription>{description}</CardDescription> : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3">{children}</CardContent>
      </Card>
    </section>
  );
}

function RecordSurfaceUnavailableCard({
  issue,
  surface,
}: {
  readonly issue?: RecordSurfaceBindingIssue;
  readonly surface: RecordSurfaceSpec;
}) {
  return (
    <div className="flex flex-col gap-3" data-record-surface={surface.key}>
      <Card
        className="border-border/70 bg-card/95 border shadow-sm"
        data-record-surface-state={issue ? "unavailable" : "loading"}
      >
        <CardHeader>
          <CardTitle className="text-base">{surface.key}</CardTitle>
          <CardDescription>
            {issue
              ? issue.message
              : `Resolving authored record surface "${surface.key}" through the shared record-surface runtime.`}
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

function DefaultRecordSurfaceFieldRow({ field }: { readonly field: RecordSurfaceFieldBinding }) {
  return (
    <div className="space-y-3 pb-4 last:pb-0" data-record-surface-field={field.path}>
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div
              className="text-foreground text-sm font-medium"
              data-record-surface-label={field.path}
            >
              {field.label}
            </div>
            {field.description ? (
              <div className="text-muted-foreground text-xs">{field.description}</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-3">{renderFieldValue(field.value)}</div>
    </div>
  );
}

function RelatedCollectionUnavailableCard({
  description,
  title,
}: {
  readonly description?: string;
  readonly title: string;
}) {
  return (
    <Card className="border-border/70 bg-card/95 border shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>
          {description ?? "Related collection panels are authored for this record surface."}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-muted-foreground text-sm">
        Related collection panels need a collection-surface lookup and installed query-surface
        registry.
      </CardContent>
    </Card>
  );
}

function RecordSurfaceRelatedCollections({
  binding,
  options,
}: {
  readonly binding: RecordSurfaceBinding;
  readonly options?: RecordSurfaceRelatedMountOptions;
}) {
  if (binding.related.length === 0) {
    return null;
  }

  const canMountCollections = options?.lookup && options.surfaceRegistry;

  return (
    <div className="flex flex-col gap-3" data-record-surface-related="">
      {binding.related.map((related) => {
        const collection = {
          ...related.collection,
          ...(related.description
            ? { description: related.description }
            : related.collection.description
              ? { description: related.collection.description }
              : {}),
          title: related.title,
        };

        if (!canMountCollections) {
          return (
            <RelatedCollectionUnavailableCard
              description={collection.description}
              key={related.key}
              title={related.title}
            />
          );
        }

        return (
          <CollectionSurfaceMount
            catalog={options.catalog}
            collection={collection}
            executePage={options.executePage}
            key={related.key}
            lookup={options.lookup}
            registry={options.registry ?? builtInQueryRendererRegistry}
            surfaceRegistry={options.surfaceRegistry}
          />
        );
      })}
    </div>
  );
}

export function RecordSurfaceLayout({
  badges,
  children,
  description,
  icon,
  status,
  subtitle,
  summaryItems = [],
  title,
  titlePrefix,
}: RecordSurfaceLayoutProps) {
  return (
    <div className="space-y-4" data-record-surface-layout="">
      <Card className="border-border/70 bg-card/95 border shadow-sm">
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex items-start gap-3">
                {icon ? <div className="shrink-0">{icon}</div> : null}
                <div className="min-w-0 space-y-1">
                  {titlePrefix ? (
                    <div className="text-muted-foreground text-xs font-medium tracking-[0.16em] uppercase">
                      {titlePrefix}
                    </div>
                  ) : null}
                  <CardTitle className="text-2xl font-semibold">{title}</CardTitle>
                  {subtitle ? (
                    <div className="text-muted-foreground text-sm">{subtitle}</div>
                  ) : null}
                  {description ? (
                    <CardDescription className="max-w-2xl text-sm">{description}</CardDescription>
                  ) : null}
                </div>
              </div>

              {summaryItems.length > 0 ? (
                <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {summaryItems.map((item, index) => (
                    <span key={index}>{item}</span>
                  ))}
                </div>
              ) : null}

              {badges ? <div className="flex flex-wrap gap-2">{badges}</div> : null}
            </div>

            {status ? <div className="shrink-0">{status}</div> : null}
          </div>
        </CardHeader>
      </Card>

      {children}
    </div>
  );
}

export function RecordSurfaceSectionView({
  chrome = true,
  description,
  emptyMessage = "No fields are available for this record surface section.",
  fields,
  renderField,
  section,
}: RecordSurfaceSectionViewProps) {
  const content =
    fields.length > 0 ? (
      <div className="flex flex-col gap-4">
        {fields.map((field) => (
          <div key={`${section.key}:${field.path}`}>
            {renderField ? (
              renderField(field, section)
            ) : (
              <DefaultRecordSurfaceFieldRow field={field} />
            )}
          </div>
        ))}
      </div>
    ) : (
      <p className="border-border bg-muted/20 text-muted-foreground rounded-xl border border-dashed p-4 text-sm">
        {emptyMessage}
      </p>
    );

  if (!chrome) {
    return content;
  }

  return (
    <SurfaceCard description={description} title={section.title}>
      {content}
    </SurfaceCard>
  );
}

export function RecordSurfaceMountView({
  badges,
  binding,
  children,
  description,
  icon,
  issue,
  relatedMountOptions,
  renderField,
  status,
  subtitle,
  summaryItems,
  surface,
  title,
  titlePrefix,
  untitledLabel = "Untitled",
}: RecordSurfaceMountViewProps) {
  if (!binding || issue) {
    return <RecordSurfaceUnavailableCard issue={issue} surface={surface} />;
  }

  const resolvedTitle = title ?? renderInlineValue(binding.title, untitledLabel);
  const resolvedSubtitle =
    subtitle ??
    (binding.subtitle === undefined ? undefined : renderInlineValue(binding.subtitle, undefined));

  return (
    <div className="space-y-4" data-record-surface={surface.key}>
      <RecordSurfaceLayout
        badges={badges}
        description={description}
        icon={icon}
        status={status}
        subtitle={resolvedSubtitle}
        summaryItems={summaryItems}
        title={resolvedTitle}
        titlePrefix={titlePrefix}
      >
        <>
          {binding.sections.map((section) => (
            <RecordSurfaceSectionView
              description={section.description}
              fields={section.fields}
              key={section.key}
              renderField={renderField}
              section={section}
            />
          ))}
          <RecordSurfaceRelatedCollections binding={binding} options={relatedMountOptions} />
          {children}
        </>
      </RecordSurfaceLayout>
    </div>
  );
}

export function RecordSurfaceMount({
  badges,
  children,
  description,
  icon,
  lookup,
  relatedMountOptions,
  renderField,
  status,
  subtitle,
  summaryItems,
  surface,
  title,
  titlePrefix,
  untitledLabel,
}: RecordSurfaceMountProps) {
  const [state, setState] = useState<RecordSurfaceMountState>({
    kind: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });

    void resolveRecordSurfaceBinding({
      lookup,
      surface,
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
  }, [lookup, surface]);

  return (
    <RecordSurfaceMountView
      badges={badges}
      binding={state.kind === "ready" ? state.binding : undefined}
      children={children}
      description={description}
      icon={icon}
      issue={state.kind === "unavailable" ? state.issue : undefined}
      relatedMountOptions={relatedMountOptions}
      renderField={renderField}
      status={status}
      subtitle={subtitle}
      summaryItems={summaryItems}
      surface={surface}
      title={title}
      titlePrefix={titlePrefix}
      untitledLabel={untitledLabel}
    />
  );
}
