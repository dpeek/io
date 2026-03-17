import { usePredicateField } from "@io/core/graph/react";
import { Button } from "@io/web/button";

import { asPredicateMetadataFields } from "./catalog.js";
import { PredicateRangeEditor, useStoreSlotValue } from "./field-editor.js";
import {
  formatGraphCardinality,
  getDefinitionDisplayLabel,
  resolveDisplayedDefinitionIconId,
} from "./helpers.js";
import { type InspectorFieldRow, InspectorFieldSection, InspectorShell } from "./inspector.js";
import { compiledCardinalityIdByLiteral, predicateIconPredicateId } from "./model.js";
import type {
  AnyEntityRef,
  ExplorerClient,
  ExplorerRuntime,
  PredicateCatalogEntry,
  TypeCatalogEntry,
} from "./model.js";
import { Badge, DebugDisclosure, DebugValue, DefinitionCheck, Section } from "./ui.js";

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
  const graphIconId = useStoreSlotValue(store, entry.id, predicateIconPredicateId);
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
          <Badge className="border-border bg-muted/30 text-muted-foreground tracking-normal normal-case">
            {usageCount} asserted edges
          </Badge>
          <Badge className="border-border bg-muted/30 text-muted-foreground tracking-normal normal-case">
            {entry.owners.length} compiled uses
          </Badge>
        </>
      }
      description="Predicate nodes are live metadata, while the checked-in compiled schema remains the source of runtime field behavior."
      iconId={iconId}
      state="predicate"
      status="Predicate"
      title={title}
      typeLabel="Predicate"
    >
      <InspectorFieldSection rows={fieldRows} />

      <Section title="Compiled Checkss">
        <div className="grid gap-3 md:grid-cols-4">
          <DefinitionCheck check="predicate-key" label="Key" state={keyState} />
          <DefinitionCheck check="predicate-range" label="Range" state={rangeState} />
          <DefinitionCheck
            check="predicate-cardinality"
            label="Cardinality"
            state={cardinalityState}
          />
          <DefinitionCheck check="predicate-icon" label="Icon" state={iconState} />
        </div>
      </Section>

      <Section title="Compiled Uses">
        <div className="grid gap-3">
          {entry.owners.map((owner) => (
            <div
              className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3"
              key={`${owner.typeId}:${owner.pathLabel}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium text-slate-100">{owner.pathLabel}</div>
                  <div className="text-xs text-slate-400">{owner.typeName}</div>
                </div>
                <Button
                  className="border-primary/20 bg-primary/5 text-primary h-5 rounded-full px-2 py-0.5 text-[11px]"
                  data-explorer-open-type={owner.typeId}
                  onClick={() => onOpenType(owner.typeId)}
                  type="button"
                  variant="ghost"
                >
                  open type
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <DebugDisclosure panelId="predicate">
        <div className="grid gap-3 md:grid-cols-2">
          <DebugValue label="Predicate ID" value={entry.id} />
          <DebugValue label="Compiled Key" value={entry.key} />
          <DebugValue label="Graph Key" value={typeof key === "string" ? key : "unset"} />
          <DebugValue label="Compiled Range ID" value={entry.compiledRangeId} />
          <DebugValue label="Graph Range ID" value={typeof range === "string" ? range : "unset"} />
          <DebugValue label="Compiled Cardinality" value={entry.compiledCardinality} />
          <DebugValue
            label="Graph Cardinality"
            value={formatGraphCardinality(
              typeof cardinality === "string" ? cardinality : undefined,
            )}
          />
          <DebugValue label="Compiled Icon ID" value={entry.compiledIconId} />
          <DebugValue
            label="Graph Icon ID"
            value={typeof graphIconId === "string" ? graphIconId : "unset"}
          />
        </div>

        <div className="grid gap-3">
          {entry.owners.map((owner) => (
            <div
              className="border-border bg-muted/20 grid gap-3 rounded-xl border p-3 md:grid-cols-3"
              key={`debug:${owner.typeId}:${owner.pathLabel}`}
            >
              <DebugValue label="Owner Path" value={owner.pathLabel} />
              <DebugValue label="Owner Type ID" value={owner.typeId} />
              <DebugValue label="Owner Type Key" value={owner.typeKey} />
            </div>
          ))}
        </div>
      </DebugDisclosure>
    </InspectorShell>
  );
}
