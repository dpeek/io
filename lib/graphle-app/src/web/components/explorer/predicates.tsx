import { usePredicateField } from "@dpeek/graphle-react";
import { Badge } from "@dpeek/graphle-web-ui/badge";
import { Button } from "@dpeek/graphle-web-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dpeek/graphle-web-ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@dpeek/graphle-web-ui/collapsible";
import { Item, ItemActions, ItemContent, ItemTitle } from "@dpeek/graphle-web-ui/item";
import { type ReactNode, useState } from "react";

import { asPredicateMetadataFields } from "./catalog.js";
import { PredicateRangeEditor, usePredicateSlotValue } from "./field-editor.js";
import {
  checkToneClass,
  formatGraphCardinality,
  getDefinitionDisplayLabel,
  resolveDisplayedDefinitionIconId,
} from "./helpers.js";
import { compiledCardinalityIdByLiteral, predicateIconPredicateId } from "./model.js";
import type {
  AnyEntityRef,
  ExplorerClient,
  ExplorerRuntime,
  PredicateCatalogEntry,
  TypeCatalogEntry,
} from "./model.js";
import { type InspectorFieldRow, InspectorFieldSection, InspectorShell } from "../inspector.js";

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

export function PredicateInspector({
  client,
  entry,
  onOpenType,
  store,
  typeEntries,
}: {
  client: ExplorerClient;
  entry: PredicateCatalogEntry;
  onOpenType: (typeId: string) => void;
  store: ExplorerRuntime["store"];
  typeEntries: readonly TypeCatalogEntry[];
}) {
  const predicate = client.predicate.ref(entry.id) as unknown as AnyEntityRef;
  const fields = asPredicateMetadataFields(predicate.fields);
  const key = usePredicateField(fields.key).value;
  const name = usePredicateField(fields.name).value;
  const range = usePredicateField(fields.range).value;
  const cardinality = usePredicateField(fields.cardinality).value;
  const graphIconId = usePredicateSlotValue(store, entry.id, predicateIconPredicateId);
  const iconId = resolveDisplayedDefinitionIconId(entry.compiledIconId, graphIconId);
  const title = getDefinitionDisplayLabel(typeof name === "string" ? name : undefined, entry.key);

  const keyState =
    key === entry.key
      ? "aligned"
      : typeof key === "string" && key.length > 0
        ? "drifted"
        : "missing";
  const rangeState =
    range === entry.compiledRangeId
      ? "aligned"
      : typeof range === "string" && range.length > 0
        ? "drifted"
        : "missing";
  const cardinalityState =
    cardinality === compiledCardinalityIdByLiteral[entry.compiledCardinality]
      ? "aligned"
      : typeof cardinality === "string" && cardinality.length > 0
        ? "drifted"
        : "missing";
  const iconState =
    graphIconId === entry.compiledIconId
      ? "aligned"
      : typeof graphIconId === "string" && graphIconId.length > 0
        ? "drifted"
        : "missing";
  const usageCount = store.facts(undefined, entry.id).length;
  const [debugOpen, setDebugOpen] = useState(false);
  const fieldRows: InspectorFieldRow[] = [
    { pathLabel: "metadata.key", predicate: fields.key },
    { pathLabel: "metadata.name", predicate: fields.name },
    { pathLabel: "metadata.description", predicate: fields.description },
    { pathLabel: "metadata.icon", predicate: fields.icon },
    {
      customEditor: ({ onMutationError, onMutationSuccess }) => (
        <PredicateRangeEditor
          onMutationError={onMutationError}
          onMutationSuccess={onMutationSuccess}
          options={typeEntries}
          predicate={fields.range}
        />
      ),
      pathLabel: "metadata.range",
      predicate: fields.range,
      title: "Range",
    },
    { pathLabel: "metadata.cardinality", predicate: fields.cardinality },
  ];

  return (
    <InspectorShell
      badges={
        <>
          <Badge variant="outline">{usageCount} asserted edges</Badge>
          <Badge variant="outline">{entry.owners.length} compiled uses</Badge>
        </>
      }
      description="Predicate nodes are live metadata, while the checked-in compiled schema remains the source of runtime field behavior."
      iconId={iconId}
      state="predicate"
      status="Predicate"
      title={title}
      typeLabel="Predicate"
    >
      <InspectorFieldSection mode="edit" rows={fieldRows} />

      <Card>
        <CardHeader>
          <CardTitle>Compiled Checks</CardTitle>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="grid gap-3 md:grid-cols-4">
            {[
              ["predicate-key", "Key", keyState],
              ["predicate-range", "Range", rangeState],
              ["predicate-cardinality", "Cardinality", cardinalityState],
              ["predicate-icon", "Icon", iconState],
            ].map(([check, label, state]) => (
              <Item
                className="items-center justify-between"
                data-explorer-check={check}
                data-explorer-check-state={state}
                key={check}
                size="sm"
                variant="outline"
              >
                <ItemContent>
                  <ItemTitle>{label}</ItemTitle>
                </ItemContent>
                <Badge className={checkToneClass(state as typeof keyState)} variant="outline">
                  {state}
                </Badge>
              </Item>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/95 flex min-h-0 flex-col border shadow-sm">
        <CardHeader className="border-border/60 border-b">
          <CardTitle>Compiled Uses</CardTitle>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="grid gap-3">
            {entry.owners.map((owner) => (
              <Item
                className="items-center justify-between gap-3"
                key={`${owner.typeId}:${owner.pathLabel}`}
                size="sm"
                variant="outline"
              >
                <ItemContent>
                  <ItemTitle>{owner.pathLabel}</ItemTitle>
                  <div className="text-muted-foreground text-xs">{owner.typeName}</div>
                </ItemContent>
                <ItemActions>
                  <Button
                    data-explorer-open-type={owner.typeId}
                    onClick={() => onOpenType(owner.typeId)}
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    Open type
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </div>
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
                <Button data-explorer-debug-toggle="predicate" type="button" variant="outline" />
              }
            >
              {debugOpen ? "Hide debug" : "Show debug"}
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent>
            <div className="grid gap-3 pt-3" data-explorer-debug-panel="predicate">
              <div className="grid gap-3 md:grid-cols-2">
                <DebugValueCard label="Predicate ID" value={entry.id} />
                <DebugValueCard label="Compiled Key" value={entry.key} />
                <DebugValueCard label="Graph Key" value={typeof key === "string" ? key : "unset"} />
                <DebugValueCard label="Compiled Range ID" value={entry.compiledRangeId} />
                <DebugValueCard
                  label="Graph Range ID"
                  value={typeof range === "string" ? range : "unset"}
                />
                <DebugValueCard label="Compiled Cardinality" value={entry.compiledCardinality} />
                <DebugValueCard
                  label="Graph Cardinality"
                  value={formatGraphCardinality(
                    typeof cardinality === "string" ? cardinality : undefined,
                  )}
                />
                <DebugValueCard label="Compiled Icon ID" value={entry.compiledIconId} />
                <DebugValueCard
                  label="Graph Icon ID"
                  value={typeof graphIconId === "string" ? graphIconId : "unset"}
                />
              </div>

              <div className="grid gap-3">
                {entry.owners.map((owner) => (
                  <div
                    className="grid gap-3 md:grid-cols-3"
                    key={`debug:${owner.typeId}:${owner.pathLabel}`}
                  >
                    <DebugValueCard label="Owner Path" value={owner.pathLabel} />
                    <DebugValueCard label="Owner Type ID" value={owner.typeId} />
                    <DebugValueCard label="Owner Type Key" value={owner.typeKey} />
                  </div>
                ))}
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </InspectorShell>
  );
}
