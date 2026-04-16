import { edgeId } from "@dpeek/graphle-app/graph";
import { core } from "@dpeek/graphle-module-core";
import { GraphIcon } from "@dpeek/graphle-module-core/react-dom";
import { Badge } from "@dpeek/graphle-web-ui/badge";
import { Button } from "@dpeek/graphle-web-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dpeek/graphle-web-ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@dpeek/graphle-web-ui/collapsible";
import { Empty, EmptyDescription } from "@dpeek/graphle-web-ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@dpeek/graphle-web-ui/item";
import { cn } from "@dpeek/graphle-web-ui/utils";
import { useState, type ReactNode } from "react";

import { asTypeMetadataFields } from "./catalog.js";
import { usePredicateSlotValue } from "./field-editor.js";
import {
  formatCardinality,
  getDefinitionDisplayLabel,
  getExplorerTypeLabel,
  resolveDisplayedDefinitionIconId,
} from "./helpers.js";
import { keyPredicateId, typeIconPredicateId } from "./model.js";
import type { AnyEntityRef, ExplorerClient, ExplorerRuntime, TypeCatalogEntry } from "./model.js";
import { InspectorFieldSection, InspectorShell } from "../inspector.js";

function DebugValueCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Item className="rounded-xl border-border bg-muted/20" size="sm" variant="muted">
      <ItemContent>
        <div className="text-muted-foreground text-[11px] font-medium tracking-[0.16em] uppercase">
          {label}
        </div>
        <code className="text-foreground block text-xs break-all">{value}</code>
      </ItemContent>
    </Item>
  );
}

export function TypeListItem({
  active,
  entry,
  onSelect,
  store,
}: {
  active: boolean;
  entry: TypeCatalogEntry;
  onSelect: () => void;
  store: ExplorerRuntime["store"];
}) {
  const graphName = usePredicateSlotValue(store, entry.id, edgeId(core.node.fields.name));
  const graphIconId = usePredicateSlotValue(store, entry.id, typeIconPredicateId);
  const iconId = resolveDisplayedDefinitionIconId(entry.compiledIconId, graphIconId);

  return (
    <Button
      className={cn(
        "rounded-none h-auto w-full justify-start border px-3 py-3 text-left text-sm",
        active ? "bg-secondary text-foreground" : "bg-background text-foreground hover:bg-muted",
      )}
      data-explorer-item-type={entry.id}
      onClick={onSelect}
      type="button"
      variant="ghost"
    >
      <div className="flex items-start gap-3">
        {typeof iconId === "string" && iconId.length > 0 ? (
          <GraphIcon className="text-muted-foreground size-6" iconId={iconId} />
        ) : null}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{graphName ?? entry.name}</span>
          </div>
        </div>
      </div>
    </Button>
  );
}

export function TypeInspector({
  client,
  entry,
  onOpenPredicate,
  store,
  typeKeyById,
}: {
  client: ExplorerClient;
  entry: TypeCatalogEntry;
  onOpenPredicate: (predicateId: string) => void;
  store: ExplorerRuntime["store"];
  typeKeyById: ReadonlyMap<string, string>;
}) {
  const typeRef = client.type.ref(entry.id) as unknown as AnyEntityRef;
  const fields = asTypeMetadataFields(typeRef.fields);
  const graphKey = usePredicateSlotValue(store, entry.id, keyPredicateId);
  const graphName = usePredicateSlotValue(store, entry.id, edgeId(core.node.fields.name));
  const graphIconId = usePredicateSlotValue(store, entry.id, typeIconPredicateId);
  const graphNameText =
    typeof graphName === "string" && graphName.length > 0 ? graphName : entry.name;
  const iconId = resolveDisplayedDefinitionIconId(entry.compiledIconId, graphIconId);
  const [debugOpen, setDebugOpen] = useState(false);
  const fieldRows = [
    { pathLabel: "metadata.name", predicate: fields.name },
    { pathLabel: "metadata.description", predicate: fields.description },
    { pathLabel: "metadata.icon", predicate: fields.icon },
  ];

  return (
    <InspectorShell
      badges={
        <>
          <Badge variant="outline">{entry.kind}</Badge>
          {entry.kind === "entity" ? (
            <Badge variant="outline">{entry.dataCount} nodes</Badge>
          ) : null}
        </>
      }
      description="Type metadata is editable here as graph data while compiled schema context stays visible in shared supplements."
      iconId={iconId}
      state="schema"
      status="Schema"
      title={graphNameText}
      typeLabel={entry.name}
    >
      <InspectorFieldSection mode="edit" rows={fieldRows} />

      <Card className="border-border/70 bg-card/95 flex min-h-0 flex-col border shadow-sm">
        <CardHeader className="border-border/60 border-b">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <CardTitle>
                {entry.kind === "entity"
                  ? "Compiled Field Tree"
                  : entry.kind === "enum"
                    ? "Enum Options"
                    : "Scalar Definition"}
              </CardTitle>
            </div>
            {entry.kind === "entity" ? (
              <Badge variant="outline">{entry.fieldDefs.length} fields</Badge>
            ) : entry.kind === "enum" ? (
              <Badge variant="outline">{entry.optionDefs.length} options</Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
          {entry.kind === "entity" ? (
            <div className="grid gap-3">
              {entry.fieldDefs.map((fieldDef) => (
                <Item
                  className="items-start justify-between gap-3"
                  data-explorer-schema-field={fieldDef.pathLabel}
                  key={`${entry.id}:${fieldDef.pathLabel}`}
                  size="sm"
                  variant="outline"
                >
                  <ItemContent>
                    <ItemTitle>{fieldDef.pathLabel}</ItemTitle>
                  </ItemContent>
                  <ItemActions className="flex-wrap justify-end">
                    <Badge variant="outline">{formatCardinality(fieldDef.cardinality)}</Badge>
                    <Badge variant="outline">
                      {getExplorerTypeLabel(fieldDef.rangeId, typeKeyById)}
                    </Badge>
                    <Button
                      data-explorer-open-predicate={fieldDef.predicateId}
                      onClick={() => onOpenPredicate(fieldDef.predicateId)}
                      size="xs"
                      type="button"
                      variant="outline"
                    >
                      Open predicate
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            </div>
          ) : entry.kind === "enum" ? (
            <div className="grid gap-3">
              {entry.optionDefs.map((option) => (
                <Item className="items-start" key={option.id} size="sm" variant="outline">
                  <ItemContent>
                    <ItemTitle>{getDefinitionDisplayLabel(option.name, option.key)}</ItemTitle>
                    {option.description ? (
                      <ItemDescription>{option.description}</ItemDescription>
                    ) : null}
                  </ItemContent>
                </Item>
              ))}
            </div>
          ) : (
            <Empty className="border-border bg-muted/20 flex-none p-4">
              <EmptyDescription className="text-sm">
                Scalar types are codec-backed today. This panel still lets you inspect and edit the
                human metadata node without pretending the runtime can live-edit codecs.
              </EmptyDescription>
            </Empty>
          )}
        </CardContent>
      </Card>

      <Collapsible onOpenChange={setDebugOpen} open={debugOpen}>
        <div className="border-border/70 bg-card/70 rounded-2xl border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">Advanced Debug</div>
              <div className="text-muted-foreground text-sm">
                Raw ids, keys, and compiled values stay hidden until you ask for them.
              </div>
            </div>
            <CollapsibleTrigger
              render={
                <Button data-explorer-debug-toggle="schema" type="button" variant="outline" />
              }
            >
              {debugOpen ? "Hide debug" : "Show debug"}
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent>
            <div className="grid gap-3 pt-3" data-explorer-debug-panel="schema">
              <div className="grid gap-3 md:grid-cols-2">
                <DebugValueCard label="Type ID" value={entry.id} />
                <DebugValueCard label="Compiled Key" value={entry.key} />
                <DebugValueCard label="Graph Key" value={graphKey ?? "unset"} />
                <DebugValueCard label="Compiled Icon ID" value={entry.compiledIconId} />
                <DebugValueCard label="Graph Icon ID" value={graphIconId ?? "unset"} />
                <DebugValueCard
                  label="Graph Name"
                  value={typeof graphName === "string" ? graphName : "unset"}
                />
              </div>

              {entry.kind === "entity" && entry.fieldDefs.length > 0 ? (
                <div className="grid gap-3">
                  {entry.fieldDefs.map((fieldDef) => (
                    <div
                      className="grid gap-3 md:grid-cols-3"
                      key={`debug:${entry.id}:${fieldDef.pathLabel}`}
                    >
                      <DebugValueCard label="Field Path" value={fieldDef.pathLabel} />
                      <DebugValueCard label="Predicate Key" value={fieldDef.key} />
                      <DebugValueCard label="Predicate ID" value={fieldDef.predicateId} />
                    </div>
                  ))}
                </div>
              ) : null}

              {entry.kind === "enum" && entry.optionDefs.length > 0 ? (
                <div className="grid gap-3">
                  {entry.optionDefs.map((option) => (
                    <div
                      className="grid gap-3 md:grid-cols-3"
                      key={`debug:${entry.id}:${option.id}`}
                    >
                      <DebugValueCard
                        label="Option Label"
                        value={getDefinitionDisplayLabel(option.name, option.key)}
                      />
                      <DebugValueCard label="Option Key" value={option.key} />
                      <DebugValueCard label="Option ID" value={option.id} />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </InspectorShell>
  );
}
