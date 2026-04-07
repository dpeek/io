import { GraphIcon } from "@io/graph-module-core/react-dom";
import { useMemo } from "react";

import { buildLiveEntitySurfacePlan } from "../entity-surface-plan.js";
import { usePredicateSlotValue } from "./field-editor.js";
import { getEntityLabel, getUntitledEntityLabel } from "./helpers.js";
import { InspectorFieldSection, InspectorShell, type InspectorFieldRow } from "./inspector.js";
import { iconTypeId, typePredicateId } from "./model.js";
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
  const iconSlotValue = usePredicateSlotValue(
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
  const iconSlotValue = usePredicateSlotValue(
    store,
    entity.id,
    typeEntry.iconPredicateId ?? typePredicateId,
  );
  const iconId = resolveEntityPreviewIconId(entity.id, iconSlotValue, typeEntry);
  const surfacePlan = useMemo(() => buildLiveEntitySurfacePlan(entity, { mode: "edit" }), [entity]);
  const rows = useMemo(() => {
    return surfacePlan.rows.flatMap((row) => {
      if (row.kind !== "predicate" || row.role === "hidden" || row.role === "title") {
        return [];
      }

      return [
        {
          descriptionVisibility: row.chrome.descriptionVisibility,
          display: row.role === "meta" ? "compact" : "default",
          labelVisibility: row.chrome.labelVisibility,
          pathLabel: row.pathLabel,
          predicate: row.predicate,
          validationPlacement: row.chrome.validationPlacement,
        } satisfies InspectorFieldRow,
      ];
    });
  }, [surfacePlan.rows]);
  const title = getEntityLabel(entity, getUntitledEntityLabel(typeEntry.name));

  return (
    <InspectorShell
      iconId={iconId}
      state="entity"
      status={typeEntry.name}
      title={title}
      typeLabel={typeEntry.name}
    >
      <InspectorFieldSection
        columns={1}
        emptyMessage="No editable fields are exposed for this record yet."
        mode={surfacePlan.mode}
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
