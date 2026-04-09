import { Button } from "@io/web/button";
import { ButtonGroup } from "@io/web/button-group";
import { Card, CardContent, CardFooter } from "@io/web/card";
import { useMemo, useState } from "react";

import {
  buildLiveEntitySurfacePlan,
  type EntitySurfaceMode,
  type EntitySurfaceRowPlan,
} from "./entity-surface-plan.js";
import { iconTypeId } from "./explorer/model.js";
import type {
  AnyEntityRef,
  AnyPredicateRef,
  EntityCatalogEntry,
  ExplorerRuntime,
  SubmitSecretFieldMutation,
} from "./explorer/model.js";
import { InspectorFieldSection, type InspectorFieldRow } from "./inspector.js";

function resolveEntityPreviewIconId(
  entityId: string,
  iconSlotValue: string | undefined,
  typeEntry: EntityCatalogEntry,
): string | undefined {
  if (typeEntry.id === iconTypeId) return entityId;
  return typeEntry.iconPredicateId ? iconSlotValue : undefined;
}

export function buildEntitySurfaceFieldRows(
  rows: readonly EntitySurfaceRowPlan<AnyPredicateRef>[],
): InspectorFieldRow[] {
  return rows.flatMap((row) => {
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
}

function EntitySurfaceModeToggle({
  mode,
  onModeChange,
}: {
  mode: EntitySurfaceMode;
  onModeChange: (mode: EntitySurfaceMode) => void;
}) {
  return (
    <ButtonGroup
      aria-label="Entity surface mode"
      className="shrink-0"
      data-entity-surface-mode-toggle="true"
    >
      <Button
        aria-pressed={mode === "view"}
        data-entity-surface-mode-option="view"
        onClick={() => onModeChange("view")}
        size="sm"
        type="button"
        variant={mode === "view" ? "secondary" : "outline"}
      >
        View
      </Button>
      <Button
        aria-pressed={mode === "edit"}
        data-entity-surface-mode-option="edit"
        onClick={() => onModeChange("edit")}
        size="sm"
        type="button"
        variant={mode === "edit" ? "secondary" : "outline"}
      >
        Edit
      </Button>
    </ButtonGroup>
  );
}

export function EntitySurface({
  defaultMode = "edit",
  entity,
  mode: controlledMode,
  onModeChange,
  runtime,
  showModeToggle = true,
  submitSecretField,
}: {
  defaultMode?: EntitySurfaceMode;
  entity: AnyEntityRef;
  mode?: EntitySurfaceMode;
  onModeChange?: (mode: EntitySurfaceMode) => void;
  runtime: ExplorerRuntime;
  showModeToggle?: boolean;
  submitSecretField: SubmitSecretFieldMutation;
}) {
  const [uncontrolledMode, setUncontrolledMode] = useState<EntitySurfaceMode>(defaultMode);
  const mode = controlledMode ?? uncontrolledMode;
  const surfacePlan = useMemo(() => buildLiveEntitySurfacePlan(entity, { mode }), [entity, mode]);
  const rows = useMemo(() => buildEntitySurfaceFieldRows(surfacePlan.rows), [surfacePlan.rows]);

  function commitMode(nextMode: EntitySurfaceMode): void {
    onModeChange?.(nextMode);
    if (controlledMode === undefined) {
      setUncontrolledMode(nextMode);
    }
  }

  return (
    <Card
      data-entity-surface="entity"
      data-entity-surface-entity={entity.id}
      data-entity-surface-mode={surfacePlan.mode}
    >
      <CardContent className="flex min-h-0 flex-1 flex-col">
        <InspectorFieldSection
          chrome={false}
          emptyMessage="No editable fields are exposed for this record yet."
          mode={surfacePlan.mode}
          rows={rows}
          runtime={runtime}
          submitSecretField={submitSecretField}
        />
      </CardContent>
      {showModeToggle ? (
        <CardFooter className="border-border/60 justify-end border-t">
          <EntitySurfaceModeToggle mode={surfacePlan.mode} onModeChange={commitMode} />
        </CardFooter>
      ) : null}
    </Card>
  );
}

export { resolveEntityPreviewIconId };
