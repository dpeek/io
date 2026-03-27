"use client";

import type { QueryResultItem, QueryResultPage, ReadQuery } from "@io/graph-client";
import { Badge } from "@io/web/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@io/web/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@io/web/table";
import type { ComponentType } from "react";

import type {
  QueryCardRendererDefinition,
  QueryContainerResultKind,
  QueryContainerState,
  QueryContainerSpec,
  QueryListItemRendererDefinition,
  QueryRendererCapability,
  QueryRendererDefinition as QueryRendererBindingDefinition,
  QueryRendererFieldDefinition,
  QueryTableRendererColumnDefinition,
} from "../lib/query-container.js";

const supportedQueryKinds = ["entity", "neighborhood", "collection", "scope"] as const;
const supportedResultKinds = ["entity-detail", "entity-list", "collection", "scope"] as const;

const defaultListRendererDefinition = {
  kind: "list",
  item: {},
} as const satisfies QueryRendererBindingDefinition;

const defaultCardGridRendererDefinition = {
  kind: "card-grid",
  card: {},
} as const satisfies QueryRendererBindingDefinition;

export type QueryRendererViewProps = {
  readonly container: QueryContainerSpec;
  readonly isRefreshing: boolean;
  readonly isStale: boolean;
  readonly pagination: {
    readonly hasNextPage: boolean;
    readonly mode: "paged" | "infinite";
    readonly nextCursor?: string;
    readonly pageSize?: number;
  };
  readonly result: QueryResultPage;
  readonly state: Extract<
    QueryContainerState,
    { readonly kind: "ready" | "paginated" | "stale" | "refreshing" }
  >;
};

export type QueryRendererDefinition = {
  readonly capability: QueryRendererCapability;
  readonly Component: ComponentType<QueryRendererViewProps>;
};

export type QueryRendererRegistry = Readonly<Record<string, QueryRendererDefinition>>;

export class QueryRendererRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryRendererRegistryError";
  }
}

function formatRendererValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((entry) => formatRendererValue(entry)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function readFieldValue(item: QueryResultItem, fieldId: string | undefined): unknown {
  if (!fieldId) return undefined;
  return fieldId in item.payload ? item.payload[fieldId] : undefined;
}

function hasRenderableText(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value !== undefined;
}

function readPayloadKeys(items: readonly QueryResultItem[]): readonly string[] {
  const keys = new Set<string>();
  for (const item of items) {
    for (const key of Object.keys(item.payload)) {
      keys.add(key);
    }
  }
  return [...keys];
}

function readPrimaryValue(
  item: QueryResultItem,
  definition: { readonly titleField?: string },
): string {
  const titleValue = readFieldValue(item, definition.titleField);
  if (hasRenderableText(titleValue)) {
    return formatRendererValue(titleValue);
  }
  const fallbackField = Object.keys(item.payload)[0];
  if (fallbackField) {
    return formatRendererValue(item.payload[fallbackField]);
  }
  return item.entityId ?? item.key;
}

function readSecondaryValue(
  item: QueryResultItem,
  definition: { readonly descriptionField?: string },
): string | undefined {
  const descriptionValue = readFieldValue(item, definition.descriptionField);
  if (hasRenderableText(descriptionValue)) {
    return formatRendererValue(descriptionValue);
  }

  const details = Object.entries(item.payload)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${formatRendererValue(value)}`)
    .join(" • ");
  return details.length > 0 ? details : undefined;
}

function renderFieldBadges(
  item: QueryResultItem,
  fields: readonly QueryRendererFieldDefinition[] | undefined,
) {
  if (!fields || fields.length === 0) {
    return null;
  }
  return fields.map((field) => {
    const value = readFieldValue(item, field.fieldId);
    if (!hasRenderableText(value)) {
      return null;
    }
    return (
      <Badge key={`${item.key}:${field.fieldId}`} variant="outline">
        {field.label ?? field.fieldId}: {formatRendererValue(value)}
      </Badge>
    );
  });
}

function resolveListRendererDefinition(
  container: QueryContainerSpec,
): QueryListItemRendererDefinition {
  const definition = container.renderer.definition;
  if (!definition || definition.kind !== "list") {
    return defaultListRendererDefinition.item;
  }
  return definition.item;
}

function resolveCardRendererDefinition(container: QueryContainerSpec): QueryCardRendererDefinition {
  const definition = container.renderer.definition;
  if (!definition || definition.kind !== "card-grid") {
    return defaultCardGridRendererDefinition.card;
  }
  return definition.card;
}

function resolveTableRendererColumns(
  container: QueryContainerSpec,
  result: QueryResultPage,
): readonly QueryTableRendererColumnDefinition[] {
  const definition = container.renderer.definition;
  if (!definition || definition.kind !== "table" || definition.columns.length === 0) {
    return readPayloadKeys(result.items).map((fieldId) => ({ fieldId }));
  }
  return definition.columns;
}

function resolveCardFields(
  item: QueryResultItem,
  definition: QueryCardRendererDefinition,
): readonly QueryRendererFieldDefinition[] {
  if (definition.fields && definition.fields.length > 0) {
    return definition.fields;
  }
  return readPayloadKeys([item]).map((fieldId) => ({ fieldId }));
}

export function createListRendererBinding(
  item: QueryListItemRendererDefinition = {},
): QueryContainerSpec["renderer"] {
  return {
    definition: {
      item,
      kind: "list",
    },
    rendererId: "core:list",
  };
}

export function createTableRendererBinding(
  columns: readonly QueryTableRendererColumnDefinition[],
): QueryContainerSpec["renderer"] {
  return {
    definition: {
      columns,
      kind: "table",
    },
    rendererId: "core:table",
  };
}

export function createCardGridRendererBinding(
  card: QueryCardRendererDefinition = {},
): QueryContainerSpec["renderer"] {
  return {
    definition: {
      card,
      kind: "card-grid",
    },
    rendererId: "core:card-grid",
  };
}

function ListRenderer({ container, result }: QueryRendererViewProps) {
  const definition = resolveListRendererDefinition(container);
  return (
    <ul className="grid gap-3" data-query-renderer="core:list">
      {result.items.map((item) => (
        <li
          className="border-border/70 bg-background/70 rounded-xl border px-4 py-3"
          key={item.key}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">{readPrimaryValue(item, definition)}</div>
              {readSecondaryValue(item, definition) ? (
                <div className="text-muted-foreground text-xs leading-5">
                  {readSecondaryValue(item, definition)}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{item.key}</Badge>
              {item.entityId ? <Badge variant="outline">{item.entityId}</Badge> : null}
              {renderFieldBadges(item, definition.metaFields)}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function CardGridRenderer({ container, result }: QueryRendererViewProps) {
  const definition = resolveCardRendererDefinition(container);
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-query-renderer="core:card-grid">
      {result.items.map((item) => (
        <Card
          className="border-border/70 bg-background/80 border shadow-sm"
          key={item.key}
          size="sm"
        >
          <CardHeader className="gap-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <CardTitle>{readPrimaryValue(item, definition)}</CardTitle>
                {readSecondaryValue(item, definition) ? (
                  <CardDescription>{readSecondaryValue(item, definition)}</CardDescription>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {item.entityId ? <Badge variant="outline">{item.entityId}</Badge> : null}
                {hasRenderableText(readFieldValue(item, definition.badgeField)) ? (
                  <Badge variant="outline">
                    {formatRendererValue(readFieldValue(item, definition.badgeField))}
                  </Badge>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-2">
            {resolveCardFields(item, definition).map((field) => (
              <div
                className="flex items-start justify-between gap-3 text-xs"
                key={`${item.key}:${field.fieldId}`}
              >
                <span className="text-muted-foreground">{field.label ?? field.fieldId}</span>
                <span className="text-right font-medium">
                  {hasRenderableText(readFieldValue(item, field.fieldId))
                    ? formatRendererValue(readFieldValue(item, field.fieldId))
                    : (field.emptyLabel ?? "—")}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TableRenderer({ container, result }: QueryRendererViewProps) {
  const columns = resolveTableRendererColumns(container, result);
  const showEntityId = result.items.some((item) => item.entityId);

  return (
    <div
      className="border-border/70 overflow-hidden rounded-xl border"
      data-query-renderer="core:table"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Key</TableHead>
            {showEntityId ? <TableHead>Entity</TableHead> : null}
            {columns.map((column) => (
              <TableHead key={column.fieldId}>{column.label ?? column.fieldId}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.items.map((item) => (
            <TableRow key={item.key}>
              <TableCell className="font-medium">{item.key}</TableCell>
              {showEntityId ? <TableCell>{item.entityId ?? "—"}</TableCell> : null}
              {columns.map((column) => (
                <TableCell
                  className={
                    column.align === "center"
                      ? "text-center"
                      : column.align === "end"
                        ? "text-right"
                        : undefined
                  }
                  key={`${item.key}:${column.fieldId}`}
                >
                  {hasRenderableText(readFieldValue(item, column.fieldId))
                    ? formatRendererValue(readFieldValue(item, column.fieldId))
                    : (column.emptyLabel ?? "—")}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function createRendererCapability(
  rendererId: string,
  supportedResultKindsOverride: readonly QueryContainerResultKind[] = supportedResultKinds,
  supportedQueryKindsOverride: readonly ReadQuery["kind"][] = supportedQueryKinds,
): QueryRendererCapability {
  return {
    rendererId,
    supportedPaginationModes: ["paged", "infinite"],
    supportedQueryKinds: supportedQueryKindsOverride,
    supportedResultKinds: supportedResultKindsOverride,
    supportedSourceKinds: ["saved", "inline"],
    supportsEntityId: "optional",
  };
}

export function createQueryRendererRegistry(
  definitions: readonly QueryRendererDefinition[],
): QueryRendererRegistry {
  const entries: [string, QueryRendererDefinition][] = [];
  const seen = new Set<string>();

  for (const definition of definitions) {
    const rendererId = definition.capability.rendererId.trim();
    if (rendererId.length === 0) {
      throw new QueryRendererRegistryError("Query renderer ids must be non-empty strings.");
    }
    if (seen.has(rendererId)) {
      throw new QueryRendererRegistryError(
        `Query renderer registry already contains "${rendererId}".`,
      );
    }
    seen.add(rendererId);
    entries.push([rendererId, definition]);
  }

  return Object.freeze(Object.fromEntries(entries));
}

export function createQueryRendererCapabilityMap(
  registry: QueryRendererRegistry,
): Readonly<Record<string, QueryRendererCapability>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(registry).map(([rendererId, definition]) => [
        rendererId,
        definition.capability,
      ]),
    ),
  );
}

export const builtInQueryRendererRegistry = createQueryRendererRegistry([
  {
    capability: createRendererCapability("core:list"),
    Component: ListRenderer,
  },
  {
    capability: createRendererCapability("core:table"),
    Component: TableRenderer,
  },
  {
    capability: createRendererCapability("core:card-grid"),
    Component: CardGridRenderer,
  },
] as const satisfies readonly QueryRendererDefinition[]);
