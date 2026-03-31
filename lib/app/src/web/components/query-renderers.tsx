"use client";

import type { QueryResultItem, QueryResultPage, ReadQuery } from "@io/graph-client";
import { Badge } from "@io/web/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@io/web/card";
import { Checkbox } from "@io/web/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@io/web/table";
import { cn } from "@io/web/utils";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";

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

const tableColumnFallbackFieldIds = [
  "title",
  "name",
  "label",
  "status",
  "state",
  "summary",
  "owner",
  "updatedAt",
  "createdAt",
] as const;

const syntheticRowColumnFieldId = "__row";

export type QueryRendererViewProps = {
  readonly activeItemKey?: string;
  readonly affordances?: QueryRendererAffordanceSet;
  readonly container: QueryContainerSpec;
  readonly isRefreshing: boolean;
  readonly isStale: boolean;
  readonly onActivateItem?: (item: QueryResultItem) => void;
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

export type QueryRendererSelectionState = {
  readonly items: readonly QueryResultItem[];
  readonly keys: readonly string[];
};

export type QueryRendererAffordanceSet = {
  readonly renderRowActions?: (item: QueryResultItem) => ReactNode;
  readonly renderSelectionActions?: (selection: QueryRendererSelectionState) => ReactNode;
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

function sortTableFieldIds(fieldIds: readonly string[]): readonly string[] {
  return [...fieldIds].sort((left, right) => {
    const leftIndex = tableColumnFallbackFieldIds.indexOf(
      left as (typeof tableColumnFallbackFieldIds)[number],
    );
    const rightIndex = tableColumnFallbackFieldIds.indexOf(
      right as (typeof tableColumnFallbackFieldIds)[number],
    );
    const leftRank = leftIndex === -1 ? Number.POSITIVE_INFINITY : leftIndex;
    const rightRank = rightIndex === -1 ? Number.POSITIVE_INFINITY : rightIndex;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.localeCompare(right);
  });
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
    const inferredFieldIds = sortTableFieldIds(readPayloadKeys(result.items));
    if (inferredFieldIds.length === 0) {
      return [
        {
          fieldId: syntheticRowColumnFieldId,
          label: result.items.some((item) => item.entityId) ? "Entity" : "Row",
        },
      ];
    }
    return inferredFieldIds.map((fieldId) => ({ fieldId }));
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

function formatTableRendererValue(
  value: unknown,
  kind: QueryTableRendererColumnDefinition["kind"] | undefined,
): string {
  if (kind === "boolean" && typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (kind === "boolean-list" && Array.isArray(value)) {
    return value.map((entry) => (entry ? "Yes" : "No")).join(", ");
  }
  return formatRendererValue(value);
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

function TableRenderer({
  activeItemKey,
  affordances,
  container,
  onActivateItem,
  pagination,
  result,
}: QueryRendererViewProps) {
  const columns = resolveTableRendererColumns(container, result);
  const visibleKeys = result.items.map((item) => item.key);
  const [selectedKeys, setSelectedKeys] = useState<readonly string[]>([]);

  useEffect(() => {
    setSelectedKeys((current) => {
      const next = current.filter((key) => visibleKeys.includes(key));
      return next.length === current.length ? current : next;
    });
  }, [visibleKeys]);

  const areAllVisibleRowsSelected =
    visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys.includes(key));
  const selectedCount = selectedKeys.length;
  const selectedItems = result.items.filter((item) => selectedKeys.includes(item.key));
  const hasRowActions = Boolean(affordances?.renderRowActions);
  const selectionActions =
    selectedCount > 0
      ? affordances?.renderSelectionActions?.({
          items: selectedItems,
          keys: selectedKeys,
        })
      : null;

  function toggleRowSelection(rowKey: string, checked: boolean) {
    setSelectedKeys((current) =>
      checked
        ? current.includes(rowKey)
          ? current
          : [...current, rowKey]
        : current.filter((key) => key !== rowKey),
    );
  }

  function toggleVisibleRows(checked: boolean) {
    setSelectedKeys(checked ? visibleKeys : []);
  }

  return (
    <div
      className="border-border/70 overflow-hidden rounded-xl border"
      data-query-renderer="core:table"
    >
      <div className="bg-muted/30 text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {selectedCount > 0
              ? `${selectedCount} selected on this page`
              : "Select rows to stage collection actions."}
          </span>
          {selectionActions}
        </div>
        <span>
          {pagination.hasNextPage
            ? "More rows available."
            : pagination.mode === "infinite"
              ? "No more rows in this result set."
              : "End of current page."}
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                aria-label="Select all visible rows"
                checked={areAllVisibleRowsSelected}
                onCheckedChange={(nextChecked) => {
                  toggleVisibleRows(nextChecked === true);
                }}
              />
            </TableHead>
            {columns.map((column) => (
              <TableHead key={column.fieldId}>{column.label ?? column.fieldId}</TableHead>
            ))}
            {hasRowActions ? <TableHead className="w-1">Actions</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.items.map((item) => (
            <TableRow
              className={cn(
                "transition-colors",
                onActivateItem ? "cursor-pointer" : undefined,
                activeItemKey === item.key ? "bg-muted/50" : undefined,
              )}
              data-query-result-item={item.key}
              data-query-result-state={activeItemKey === item.key ? "active" : undefined}
              data-state={selectedKeys.includes(item.key) ? "selected" : undefined}
              key={item.key}
              onClick={() => {
                onActivateItem?.(item);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") {
                  return;
                }
                event.preventDefault();
                onActivateItem?.(item);
              }}
              tabIndex={onActivateItem ? 0 : undefined}
            >
              <TableCell className="w-10">
                <Checkbox
                  aria-label={`Select ${item.entityId ?? item.key}`}
                  checked={selectedKeys.includes(item.key)}
                  onCheckedChange={(nextChecked) => {
                    toggleRowSelection(item.key, nextChecked === true);
                  }}
                />
              </TableCell>
              {columns.map((column, index) => (
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
                  {column.fieldId === syntheticRowColumnFieldId ? (
                    <span className="font-medium">{item.entityId ?? item.key}</span>
                  ) : hasRenderableText(readFieldValue(item, column.fieldId)) ? (
                    <div className={index === 0 ? "space-y-1" : undefined}>
                      <div className={index === 0 ? "font-medium" : undefined}>
                        {formatTableRendererValue(
                          readFieldValue(item, column.fieldId),
                          column.kind,
                        )}
                      </div>
                      {index === 0 && item.entityId ? (
                        <div className="text-muted-foreground text-[11px]">{item.entityId}</div>
                      ) : null}
                    </div>
                  ) : (
                    (column.emptyLabel ?? "—")
                  )}
                </TableCell>
              ))}
              {hasRowActions ? (
                <TableCell className="w-1">
                  <div
                    className="flex justify-end"
                    data-query-row-actions={item.key}
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    {affordances?.renderRowActions?.(item)}
                  </div>
                </TableCell>
              ) : null}
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
