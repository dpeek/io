"use client";

import {
  bootstrap,
  createIdMap,
  createStore,
  createTypeClient,
  applyIdMap,
  serializedQueryVersion,
  type PredicateRef,
} from "@io/core/graph";
import {
  PredicateFieldEditor,
  PredicateFieldView,
  genericWebFieldEditorCapabilities,
  genericWebFieldViewCapabilities,
} from "@io/core/graph/adapters/react-dom";
import { defineType } from "@io/core/graph/def";
import { core, defaultMoneyCurrencyKey, urlTypeModule } from "@io/core/graph/modules";
import {
  getPredicateDisplayKind,
  getPredicateEditorKind,
  usePredicateField,
} from "@io/core/graph/runtime/react";
import { Badge } from "@io/web/badge";
import { Button } from "@io/web/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@io/web/card";
import { useMemo, useState } from "react";

import { kitchenSink } from "../../graph/testing/kitchen-sink.js";
import type {
  QueryContainerSpec,
  QueryContainerRuntimeValue,
  QuerySurfaceRendererCompatibility,
} from "../lib/query-container.js";
import type { QueryWorkbenchRouteSearch } from "../lib/query-workbench.js";
import {
  createCardGridRendererBinding,
  createListRendererBinding,
  createTableRendererBinding,
} from "./query-renderers.js";
import { QueryRouteMountView } from "./query-route-mount.js";
import { QueryWorkbench } from "./query-workbench.js";

type AnyPredicateRef = PredicateRef<any, any>;

type ViewsPageItem = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly predicate: AnyPredicateRef;
};

type ViewsPageFixture = {
  readonly items: readonly ViewsPageItem[];
};

const queryRendererPreviewSurface = {
  compatibleRendererIds: ["core:list", "core:table", "core:card-grid"],
  itemEntityIds: "optional",
  queryKind: "collection",
  resultKind: "collection",
  sourceKinds: ["inline"],
  surfaceId: "views:query-renderer-preview",
} as const satisfies QuerySurfaceRendererCompatibility;

const queryRendererPreviewSpec = {
  containerId: "views-query-renderer-preview",
  pagination: {
    mode: "paged",
    pageSize: 2,
  },
  query: {
    kind: "inline",
    request: {
      version: serializedQueryVersion,
      query: {
        kind: "collection",
        indexId: "views:query-renderer-preview",
      },
    },
  },
  renderer: {
    ...createListRendererBinding({
      descriptionField: "summary",
      metaFields: [
        { fieldId: "status", label: "Status" },
        { fieldId: "owner", label: "Owner" },
      ],
      titleField: "title",
    }),
  },
} as const satisfies QueryContainerSpec;

const supportedViewKinds = genericWebFieldViewCapabilities.map((capability) => capability.kind);
const supportedEditorKinds = genericWebFieldEditorCapabilities.map((capability) => capability.kind);
const linkPreview = defineType({
  values: { key: "web:linkPreview", name: "Link Preview" },
  fields: {
    ...core.node.fields,
    resourceUrl: urlTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Resource URL",
      },
    }),
  },
});

const viewsPageNamespace = applyIdMap(createIdMap({ linkPreview }).map, {
  linkPreview,
});

const viewsPageGraph = { ...core, ...kitchenSink, ...viewsPageNamespace } as const;

function formatDebugValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof URL) return value.toString();
  return JSON.stringify(
    value,
    (_key, candidate) => (candidate instanceof URL ? candidate.toString() : candidate),
    2,
  );
}

function createViewsPageFixture(): ViewsPageFixture {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, kitchenSink);
  bootstrap(store, viewsPageNamespace);

  const graph = createTypeClient(store, viewsPageGraph);
  const draftStatusId = kitchenSink.status.values.draft.id;
  const inReviewStatusId = kitchenSink.status.values.inReview.id;
  const approvedStatusId = kitchenSink.status.values.approved.id;
  const highSeverityId = kitchenSink.severity.values.high.id;

  const platformTagId = graph.tag.create({
    color: "#2563eb",
    key: "platform",
    name: "Platform",
  });
  const uxTagId = graph.tag.create({
    color: "#0f766e",
    key: "ux",
    name: "UX",
  });
  const managerId = graph.person.create({
    name: "Avery Operator",
    status: approvedStatusId,
  });
  const reviewerAId = graph.person.create({
    name: "Sam Reviewer",
    status: inReviewStatusId,
    manager: managerId,
  });
  const reviewerBId = graph.person.create({
    name: "Jo Reviewer",
    status: draftStatusId,
    manager: managerId,
    peers: [reviewerAId],
  });
  const companyId = graph.company.create({
    foundedYear: 2019,
    name: "IO Labs",
    status: approvedStatusId,
    tags: [platformTagId],
    website: new URL("https://io.example.com"),
  });

  graph.person.update(managerId, {
    worksAt: [companyId],
  });
  graph.person.update(reviewerAId, {
    worksAt: [companyId],
  });
  graph.person.update(reviewerBId, {
    worksAt: [companyId],
  });

  const blockId = graph.block.create({
    collapsed: false,
    name: "Review Notes",
    order: 1,
    text: "First line of editable textarea content.\nSecond line for multiline review.",
  });
  const recordId = graph.record.create({
    accentColor: "#2563eb",
    archived: false,
    budget: { amount: 1250, currency: defaultMoneyCurrencyKey },
    burnRate: {
      denominator: {
        kind: "duration",
        value: 86_400_000,
      },
      numerator: {
        kind: "money",
        value: { amount: 1250, currency: defaultMoneyCurrencyKey },
      },
    },
    completion: 72.5,
    completionBand: {
      kind: "percent",
      max: 80,
      min: 10,
    },
    details: "# Predicate Views\n\nReview **every** shared renderer from one page.",
    duration: 5_400_000,
    headline: "KS-42",
    name: "Predicate Views Fixture",
    owner: managerId,
    quantity: { amount: 12.5, unit: "kg" },
    review: {
      approvedAt: new Date("2026-03-24T10:15:00.000Z"),
      notes: "Ready to validate the shared editor surface.",
      reviewer: reviewerAId,
    },
    reviewers: [reviewerAId, reviewerBId],
    score: 84,
    severity: highSeverityId,
    status: inReviewStatusId,
    statusHistory: [draftStatusId, inReviewStatusId],
    syncedAt: new Date("2026-03-24T09:30:00.000Z"),
    tags: [platformTagId, uxTagId],
    website: new URL("https://io.example.com/views"),
  });
  const iconId = graph.icon.create({
    key: "predicate-views",
    name: "Predicate Views",
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 10h8M8 14h5"/></svg>',
  });
  const linkPreviewId = graph.linkPreview.create({
    name: "Docs Reference",
    resourceUrl: new URL("https://docs.example.com/predicate-views"),
  });

  const record = graph.record.ref(recordId);
  const block = graph.block.ref(blockId);
  const company = graph.company.ref(companyId);
  const icon = graph.icon.ref(iconId);
  const link = graph.linkPreview.ref(linkPreviewId);

  return {
    items: [
      {
        description: "Custom text formatter and parser.",
        id: "score",
        label: "Text",
        predicate: record.fields.score as AnyPredicateRef,
      },
      {
        description: "Read-only color swatch display with the dedicated color editor.",
        id: "accentColor",
        label: "Color",
        predicate: record.fields.accentColor as AnyPredicateRef,
      },
      {
        description: "Multiline string editor backed by a plain text predicate.",
        id: "textarea",
        label: "Textarea",
        predicate: block.fields.text as AnyPredicateRef,
      },
      {
        description: "Markdown source editor with live rendered preview.",
        id: "markdown",
        label: "Markdown",
        predicate: record.fields.details as AnyPredicateRef,
      },
      {
        description: "SVG source editor and rendered preview.",
        id: "svg",
        label: "SVG",
        predicate: icon.fields.svg as AnyPredicateRef,
      },
      {
        description: "Date display and freeform date editor.",
        id: "date",
        label: "Date",
        predicate: record.fields.syncedAt as AnyPredicateRef,
      },
      {
        description: "Default number display and numeric input.",
        id: "number",
        label: "Number",
        predicate: company.fields.foundedYear as AnyPredicateRef,
      },
      {
        description: "Boolean display with the shared checkbox editor.",
        id: "boolean",
        label: "Boolean",
        predicate: record.fields.archived as AnyPredicateRef,
      },
      {
        description: "Duration formatter and editor.",
        id: "duration",
        label: "Duration",
        predicate: record.fields.duration as AnyPredicateRef,
      },
      {
        description: "Percent formatter and editor.",
        id: "percent",
        label: "Percent",
        predicate: record.fields.completion as AnyPredicateRef,
      },
      {
        description: "Quantity formatter and editor.",
        id: "quantity",
        label: "Quantity",
        predicate: record.fields.quantity as AnyPredicateRef,
      },
      {
        description: "Structured range display and editor.",
        id: "range",
        label: "Range",
        predicate: record.fields.completionBand as AnyPredicateRef,
      },
      {
        description: "Rate display and editor.",
        id: "rate",
        label: "Rate",
        predicate: record.fields.burnRate as AnyPredicateRef,
      },
      {
        description: "Money amount display and editor.",
        id: "money",
        label: "Money",
        predicate: record.fields.budget as AnyPredicateRef,
      },
      {
        description: "Default URL display kind resolves to an in-app link view.",
        id: "link",
        label: "Link",
        predicate: link.fields.resourceUrl as AnyPredicateRef,
      },
      {
        description: "External link display override with the shared URL editor.",
        id: "externalLink",
        label: "External Link",
        predicate: record.fields.website as AnyPredicateRef,
      },
      {
        description: "Enum badge display with select editor.",
        id: "badge",
        label: "Badge",
        predicate: record.fields.status as AnyPredicateRef,
      },
      {
        description: "Entity reference list display with combobox editor.",
        id: "entityReferenceList",
        label: "Entity References",
        predicate: record.fields.reviewers as AnyPredicateRef,
      },
    ],
  };
}

function createQueryRendererPreviewValue(): QueryContainerRuntimeValue {
  const result = {
    kind: "collection",
    freshness: {
      completeness: "complete",
      freshness: "current",
    },
    items: [
      {
        key: "row:workflow-shell",
        entityId: "workflow-branch:1",
        payload: {
          owner: "Avery Operator",
          status: "active",
          summary: "Shared route helper preview using the list renderer.",
          title: "Workflow shell",
        },
      },
      {
        key: "row:query-cards",
        entityId: "workflow-branch:2",
        payload: {
          owner: "Sam Reviewer",
          status: "ready",
          summary: "Same query result rendered through the first reusable card and table views.",
          title: "Query cards",
        },
      },
    ],
  } as const;

  return {
    cacheKey: "views:query-renderer-preview",
    instanceKey: "views:query-renderer-preview",
    pageKey: "views:query-renderer-preview:first",
    request: queryRendererPreviewSpec.query.request,
    snapshot: { result },
    state: {
      kind: "ready",
      result,
    },
  };
}

function QueryRendererPreviewGallery() {
  const previewValue = createQueryRendererPreviewValue();

  return (
    <div className="grid gap-4">
      <Card className="border-border/70 bg-card/95 border shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Query Renderer Preview</CardTitle>
          <CardDescription>
            The same query container binding can now mount through a shared route helper and switch
            layouts by stable renderer id instead of route-local rendering code.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="outline">core:list</Badge>
          <Badge variant="outline">core:table</Badge>
          <Badge variant="outline">core:card-grid</Badge>
          <Badge variant="outline">route helper</Badge>
        </CardContent>
      </Card>

      <div className="grid gap-4 2xl:grid-cols-3">
        {(["core:list", "core:table", "core:card-grid"] as const).map((rendererId) => (
          <QueryRouteMountView
            description="Shared route-mount chrome for reusable query container renderers."
            initialValue={previewValue}
            key={rendererId}
            spec={{
              ...queryRendererPreviewSpec,
              containerId: `views-query-renderer-preview:${rendererId}`,
              renderer:
                rendererId === "core:list"
                  ? queryRendererPreviewSpec.renderer
                  : rendererId === "core:table"
                    ? createTableRendererBinding([
                        { fieldId: "title", label: "Title" },
                        { fieldId: "status", label: "Status" },
                        { fieldId: "owner", label: "Owner" },
                      ])
                    : createCardGridRendererBinding({
                        badgeField: "status",
                        descriptionField: "summary",
                        fields: [
                          { fieldId: "owner", label: "Owner" },
                          { fieldId: "updatedAt", label: "Updated" },
                        ],
                        titleField: "title",
                      }),
            }}
            surface={queryRendererPreviewSurface}
            title={rendererId}
          />
        ))}
      </div>
    </div>
  );
}

function KindCoverageCard({
  coveredKinds,
  supportedKinds,
  title,
}: {
  readonly coveredKinds: ReadonlySet<string>;
  readonly supportedKinds: readonly string[];
  readonly title: string;
}) {
  const missingKinds = supportedKinds.filter((kind) => !coveredKinds.has(kind));

  return (
    <Card className="border-border/70 bg-card/95 border shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>
          {missingKinds.length === 0
            ? "Every shared capability is represented on this page."
            : `Missing coverage for: ${missingKinds.join(", ")}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {supportedKinds.map((kind) => (
          <Badge
            className={
              coveredKinds.has(kind)
                ? "border-border/70 bg-background"
                : "border-destructive/30 text-destructive"
            }
            key={kind}
            variant="outline"
          >
            {kind}
          </Badge>
        ))}
      </CardContent>
    </Card>
  );
}

function ViewsPageItemCard({ item }: { readonly item: ViewsPageItem }) {
  const displayKind = getPredicateDisplayKind(item.predicate.field) ?? "missing";
  const editorKind = getPredicateEditorKind(item.predicate.field) ?? "missing";
  const { value } = usePredicateField(item.predicate);

  return (
    <Card className="border-border/70 bg-card/95 border shadow-sm">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">{item.label}</CardTitle>
            <CardDescription>{item.description}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">display: {displayKind}</Badge>
            <Badge variant="outline">editor: {editorKind}</Badge>
            <Badge variant="outline">{item.predicate.field.cardinality}</Badge>
          </div>
        </div>
        <div className="text-muted-foreground font-mono text-xs">{item.predicate.field.key}</div>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-2">
          <div className="text-xs font-medium tracking-[0.18em] text-sky-700 uppercase">
            Display
          </div>
          <div className="border-border/70 bg-muted/20 min-h-16 rounded-[1rem] border p-4">
            <PredicateFieldView predicate={item.predicate} />
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-xs font-medium tracking-[0.18em] text-sky-700 uppercase">Editor</div>
          <div className="border-border/70 bg-background min-h-16 rounded-[1rem] border p-4">
            <PredicateFieldEditor predicate={item.predicate} />
          </div>
        </div>
        <div className="space-y-2 xl:col-span-2">
          <div className="text-muted-foreground text-xs font-medium tracking-[0.18em] uppercase">
            Current Value
          </div>
          <pre className="bg-muted/30 overflow-x-auto rounded-[1rem] px-4 py-3 text-xs whitespace-pre-wrap">
            {formatDebugValue(value)}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}

function ViewsPageCatalog() {
  const [fixture] = useState(createViewsPageFixture);

  const viewKinds = useMemo(() => {
    const coveredKinds = new Set<string>();
    for (const item of fixture.items) {
      const kind = getPredicateDisplayKind(item.predicate.field);
      if (kind) coveredKinds.add(kind);
    }
    return coveredKinds;
  }, [fixture.items]);

  const editorKinds = useMemo(() => {
    const coveredKinds = new Set<string>();
    for (const item of fixture.items) {
      const kind = getPredicateEditorKind(item.predicate.field);
      if (kind) coveredKinds.add(kind);
    }
    return coveredKinds;
  }, [fixture.items]);

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="border-border/70 bg-card/95 border shadow-sm xl:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Fixture</CardTitle>
            <CardDescription>
              This page uses a local in-memory graph fixture. Every edit is live, but none of it is
              persisted.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Badge variant="outline">{fixture.items.length} predicates</Badge>
            <Badge variant="outline">
              {viewKinds.size} / {supportedViewKinds.length} view kinds
            </Badge>
            <Badge variant="outline">
              {editorKinds.size} / {supportedEditorKinds.length} editor kinds
            </Badge>
          </CardContent>
        </Card>
        <div className="grid gap-4 xl:col-span-2 xl:grid-cols-2">
          <KindCoverageCard
            coveredKinds={viewKinds}
            supportedKinds={supportedViewKinds}
            title="Display Coverage"
          />
          <KindCoverageCard
            coveredKinds={editorKinds}
            supportedKinds={supportedEditorKinds}
            title="Editor Coverage"
          />
        </div>
      </div>

      <div className="grid gap-4 2xl:grid-cols-2">
        {fixture.items.map((item) => (
          <ViewsPageItemCard item={item} key={item.id} />
        ))}
      </div>
    </div>
  );
}

export function ViewsPage({
  onSearchChange,
  search = {},
}: {
  readonly onSearchChange?: (search: QueryWorkbenchRouteSearch) => void | Promise<void>;
  readonly search?: QueryWorkbenchRouteSearch;
}) {
  const [fixtureVersion, setFixtureVersion] = useState(0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pr-1">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="text-xs font-medium tracking-[0.18em] text-sky-700 uppercase">
            Predicate Renderer Review
          </div>
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">Views</h1>
            <p className="text-muted-foreground max-w-3xl text-sm leading-6">
              Review every shared predicate display and editor capability from one page, including
              text, markdown, date, ranges, structured values, enums, URLs, and entity references.
            </p>
          </div>
        </div>
        <Button
          onClick={() => {
            setFixtureVersion((current) => current + 1);
          }}
          type="button"
          variant="outline"
        >
          Reset fixture
        </Button>
      </div>

      <QueryRendererPreviewGallery />
      <QueryWorkbench onSearchChange={onSearchChange} search={search} />
      <ViewsPageCatalog key={fixtureVersion} />
    </div>
  );
}
