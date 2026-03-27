import { GraphIcon } from "@io/graph-module-core/react-dom";
import { usePredicateField } from "@io/graph-react";
import { useMemo } from "react";

import { asNodeMetadataFields, flattenPredicateRefs } from "./catalog.js";
import { useStoreSlotValue } from "./field-editor.js";
import { formatEntityHeaderDate, getEntityLabel, getUntitledEntityLabel } from "./helpers.js";
import { InspectorFieldSection, InspectorShell, type InspectorFieldRow } from "./inspector.js";
import {
  createdAtPredicateId,
  iconTypeId,
  typePredicateId,
  updatedAtPredicateId,
} from "./model.js";
import type {
  AnyEntityRef,
  EntityCatalogEntry,
  ExplorerRuntime,
  SubmitSecretFieldMutation,
} from "./model.js";
import { DebugDisclosure, DebugValue, ListButton } from "./ui.js";

function resolveEntityPreviewIconId(
  entityId: string,
  iconSlotValue: string | undefined,
  typeEntry: EntityCatalogEntry,
): string | undefined {
  if (typeEntry.id === iconTypeId) return entityId;
  return typeEntry.iconPredicateId ? iconSlotValue : undefined;
}

export function EntityListItem({
  active,
  className,
  entity,
  onSelect,
  props,
  store,
  typeEntry,
}: {
  active: boolean;
  className?: string;
  entity: AnyEntityRef;
  onSelect: () => void;
  props?: Record<string, string>;
  store: ExplorerRuntime["store"];
  typeEntry: EntityCatalogEntry;
}) {
  const iconSlotValue = useStoreSlotValue(
    store,
    entity.id,
    typeEntry.iconPredicateId ?? typePredicateId,
  );
  const iconId = resolveEntityPreviewIconId(entity.id, iconSlotValue, typeEntry);
  const title = getEntityLabel(entity, getUntitledEntityLabel(typeEntry.name));

  return (
    <ListButton
      active={active}
      className={className}
      onClick={onSelect}
      props={{ "data-explorer-item-entity": entity.id, ...props }}
    >
      <div className="flex items-start gap-3">
        {typeof iconId === "string" && iconId.length > 0 ? (
          <GraphIcon className="text-muted-foreground size-8" iconId={iconId} />
        ) : null}
        <div className="space-y-1">
          <div className="text-sm font-medium">{title}</div>
        </div>
      </div>
    </ListButton>
  );
}

export function EntityInspector({
  entity,
  runtime,
  submitSecretField,
  store,
  typeEntry,
}: {
  entity: AnyEntityRef;
  runtime: ExplorerRuntime;
  submitSecretField: SubmitSecretFieldMutation;
  store: ExplorerRuntime["store"];
  typeEntry: EntityCatalogEntry;
}) {
  const fields = asNodeMetadataFields(entity.fields);
  const { value: createdAt } = usePredicateField(fields.createdAt);
  const { value: updatedAt } = usePredicateField(fields.updatedAt);
  const iconSlotValue = useStoreSlotValue(
    store,
    entity.id,
    typeEntry.iconPredicateId ?? typePredicateId,
  );
  const iconId = resolveEntityPreviewIconId(entity.id, iconSlotValue, typeEntry);
  const rows = useMemo(() => {
    const compactPredicateIds = new Set([
      typePredicateId,
      createdAtPredicateId,
      updatedAtPredicateId,
    ]);

    return [
      {
        display: "compact",
        pathLabel: "id",
        readOnly: true,
        title: "ID",
        value: <code>{entity.id}</code>,
      },
      ...flattenPredicateRefs(entity.fields as Record<string, unknown>).map((row) => ({
        ...row,
        ...(compactPredicateIds.has(row.predicate.predicateId)
          ? { display: "compact" as const, readOnly: true }
          : {}),
      })),
    ] satisfies InspectorFieldRow[];
  }, [entity]);
  const createdAtLabel = formatEntityHeaderDate(createdAt);
  const updatedAtLabel = formatEntityHeaderDate(updatedAt);
  const summaryItems = [
    createdAtLabel ? `Created ${createdAtLabel}` : null,
    updatedAtLabel ? `Updated ${updatedAtLabel}` : null,
  ].filter((item): item is string => typeof item === "string");
  const title = getEntityLabel(entity, getUntitledEntityLabel(typeEntry.name));

  return (
    <InspectorShell
      iconId={iconId}
      state="entity"
      status={typeEntry.name}
      summaryItems={summaryItems}
      title={title}
      typeLabel={typeEntry.name}
    >
      <InspectorFieldSection
        emptyMessage="No editable fields are exposed for this record yet."
        rows={rows}
        runtime={runtime}
        submitSecretField={submitSecretField}
      />

      <DebugDisclosure panelId="entity">
        <div className="grid gap-3 md:grid-cols-2">
          <DebugValue label="Record ID" value={entity.id} />
          <DebugValue label="Type ID" value={typeEntry.id} />
          <DebugValue label="Type Key" value={typeEntry.key} />
        </div>
      </DebugDisclosure>
    </InspectorShell>
  );
}
