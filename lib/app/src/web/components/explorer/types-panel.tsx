import { edgeId } from "@io/app/graph";
import { core } from "@io/graph-module-core";
import { GraphIcon } from "@io/graph-module-core/react-dom";
import { Button } from "@io/web/button";

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
import { Badge, DebugDisclosure, DebugValue, EmptyState, ListButton, Section } from "./ui.js";
import { InspectorFieldSection, InspectorShell } from "../inspector.js";

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
    <ListButton active={active} onClick={onSelect} props={{ "data-explorer-item-type": entry.id }}>
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
    </ListButton>
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
  const fieldRows = [
    { pathLabel: "metadata.name", predicate: fields.name },
    { pathLabel: "metadata.description", predicate: fields.description },
    { pathLabel: "metadata.icon", predicate: fields.icon },
  ];

  return (
    <InspectorShell
      badges={
        <>
          <Badge className="border-border bg-muted/30 text-muted-foreground tracking-normal normal-case">
            {entry.kind}
          </Badge>
          {entry.kind === "entity" ? (
            <Badge className="border-border bg-muted/30 text-muted-foreground tracking-normal normal-case">
              {entry.dataCount} nodes
            </Badge>
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

      <Section
        title={
          entry.kind === "entity"
            ? "Compiled Field Tree"
            : entry.kind === "enum"
              ? "Enum Options"
              : "Scalar Definition"
        }
        right={
          entry.kind === "entity" ? (
            <Badge className="border-slate-700 bg-slate-950 text-slate-300">
              {entry.fieldDefs.length} fields
            </Badge>
          ) : entry.kind === "enum" ? (
            <Badge className="border-slate-700 bg-slate-950 text-slate-300">
              {entry.optionDefs.length} options
            </Badge>
          ) : null
        }
      >
        {entry.kind === "entity" ? (
          <div className="grid gap-3">
            {entry.fieldDefs.map((fieldDef) => (
              <div
                className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3"
                data-explorer-schema-field={fieldDef.pathLabel}
                key={`${entry.id}:${fieldDef.pathLabel}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-slate-100">{fieldDef.pathLabel}</div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Badge className="border-slate-700 bg-slate-900 text-slate-300">
                      {formatCardinality(fieldDef.cardinality)}
                    </Badge>
                    <Badge className="border-slate-700 bg-slate-900 text-slate-300">
                      {getExplorerTypeLabel(fieldDef.rangeId, typeKeyById)}
                    </Badge>
                    <Button
                      className="border-primary/20 bg-primary/5 text-primary h-5 rounded-full px-2 py-0.5 text-[11px]"
                      data-explorer-open-predicate={fieldDef.predicateId}
                      onClick={() => onOpenPredicate(fieldDef.predicateId)}
                      type="button"
                      variant="ghost"
                    >
                      open predicate
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : entry.kind === "enum" ? (
          <div className="grid gap-3">
            {entry.optionDefs.map((option) => (
              <div
                className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3"
                key={option.id}
              >
                <div className="space-y-1">
                  <div className="text-sm font-medium text-slate-100">
                    {getDefinitionDisplayLabel(option.name, option.key)}
                  </div>
                </div>
                {option.description ? (
                  <p className="mt-2 text-sm text-slate-400">{option.description}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>
            Scalar types are codec-backed today. This panel still lets you inspect and edit the
            human metadata node without pretending the runtime can live-edit codecs.
          </EmptyState>
        )}
      </Section>

      <DebugDisclosure panelId="schema">
        <div className="grid gap-3 md:grid-cols-2">
          <DebugValue label="Type ID" value={entry.id} />
          <DebugValue label="Compiled Key" value={entry.key} />
          <DebugValue label="Graph Key" value={graphKey ?? "unset"} />
          <DebugValue label="Compiled Icon ID" value={entry.compiledIconId} />
          <DebugValue label="Graph Icon ID" value={graphIconId ?? "unset"} />
          <DebugValue
            label="Graph Name"
            value={typeof graphName === "string" ? graphName : "unset"}
          />
        </div>

        {entry.kind === "entity" && entry.fieldDefs.length > 0 ? (
          <div className="grid gap-3">
            {entry.fieldDefs.map((fieldDef) => (
              <div
                className="border-border bg-muted/20 grid gap-3 rounded-xl border p-3 md:grid-cols-3"
                key={`debug:${entry.id}:${fieldDef.pathLabel}`}
              >
                <DebugValue label="Field Path" value={fieldDef.pathLabel} />
                <DebugValue label="Predicate Key" value={fieldDef.key} />
                <DebugValue label="Predicate ID" value={fieldDef.predicateId} />
              </div>
            ))}
          </div>
        ) : null}

        {entry.kind === "enum" && entry.optionDefs.length > 0 ? (
          <div className="grid gap-3">
            {entry.optionDefs.map((option) => (
              <div
                className="border-border bg-muted/20 grid gap-3 rounded-xl border p-3 md:grid-cols-3"
                key={`debug:${entry.id}:${option.id}`}
              >
                <DebugValue
                  label="Option Label"
                  value={getDefinitionDisplayLabel(option.name, option.key)}
                />
                <DebugValue label="Option Key" value={option.key} />
                <DebugValue label="Option ID" value={option.id} />
              </div>
            ))}
          </div>
        ) : null}
      </DebugDisclosure>
    </InspectorShell>
  );
}
