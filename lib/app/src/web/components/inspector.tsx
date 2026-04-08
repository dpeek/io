import { isSecretBackedField } from "@io/app/graph";
import type { RecordSurfaceFieldBinding } from "@io/graph-surface";
import { RecordSurfaceLayout, RecordSurfaceSectionView } from "@io/graph-surface/react-dom";
import { GraphIcon } from "@io/graph-module-core/react-dom";
import { type ReactNode } from "react";

import type {
  EntitySurfaceDescriptionVisibilityPolicy,
  EntitySurfaceLabelVisibilityPolicy,
  EntitySurfaceMode,
  EntitySurfaceModeValue,
  EntitySurfaceValidationPlacementPolicy,
} from "./entity-surface-plan.js";
import { PredicateRow, SecretFieldEditor } from "./field-editor.js";
import type {
  AnyPredicateRef,
  ExplorerRuntime,
  FieldValidationMessage,
  MutationCallbacks,
  SubmitSecretFieldMutation,
} from "./explorer/model.js";
import { Badge } from "./explorer/ui.js";

export type InspectorFieldRow = {
  customEditor?: (callbacks: MutationCallbacks) => ReactNode;
  description?: string;
  descriptionVisibility?: EntitySurfaceModeValue<EntitySurfaceDescriptionVisibilityPolicy>;
  display?: EntitySurfaceModeValue<"compact" | "default">;
  labelVisibility?: EntitySurfaceModeValue<EntitySurfaceLabelVisibilityPolicy>;
  pathLabel: string;
  predicate?: AnyPredicateRef;
  readOnly?: boolean;
  title?: string;
  validationMessages?: readonly FieldValidationMessage[];
  validationPlacement?: EntitySurfaceModeValue<EntitySurfaceValidationPlacementPolicy>;
  value?: ReactNode;
};

export function InspectorShell({
  badges,
  children,
  description,
  iconId,
  state,
  status,
  summaryItems = [],
  title,
  typeLabel,
}: {
  badges?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  iconId?: string;
  state: "entity" | "new" | "predicate" | "schema";
  status: string;
  summaryItems?: readonly string[];
  title: string;
  typeLabel: string;
}) {
  return (
    <div className="space-y-4" data-explorer-panel="inspector" data-explorer-state={state}>
      <RecordSurfaceLayout
        badges={badges}
        description={description}
        icon={
          typeof iconId === "string" && iconId.length > 0 ? (
            <GraphIcon className="text-muted-foreground size-12" iconId={iconId} />
          ) : undefined
        }
        status={
          <Badge
            className="border-border bg-muted/30 text-muted-foreground tracking-normal normal-case"
            data={{ "data-explorer-inspector-status": status }}
          >
            {status}
          </Badge>
        }
        summaryItems={summaryItems}
        title={<span data-explorer-inspector-title={title}>{title}</span>}
        titlePrefix={<span data-explorer-inspector-type={typeLabel}>{typeLabel}</span>}
      >
        {children}
      </RecordSurfaceLayout>
    </div>
  );
}

export function InspectorFieldSection({
  chrome = true,
  description,
  emptyMessage = "No shared fields are available for this selection.",
  hideMissingStatus = false,
  mode,
  rows,
  runtime,
  submitSecretField,
  title = "Fields",
  validationMessagesByPath,
}: {
  chrome?: boolean;
  description?: string;
  emptyMessage?: string;
  hideMissingStatus?: boolean;
  mode: EntitySurfaceMode;
  rows: readonly InspectorFieldRow[];
  runtime?: ExplorerRuntime;
  submitSecretField?: SubmitSecretFieldMutation;
  title?: string;
  validationMessagesByPath?: ReadonlyMap<string, readonly FieldValidationMessage[]>;
}) {
  const fieldEntries = rows.map((row) => ({
    field: {
      ...(row.description ? { description: row.description } : {}),
      label: row.title ?? row.pathLabel,
      path: row.pathLabel,
      value: row.value,
    } satisfies RecordSurfaceFieldBinding,
    row,
  }));

  return (
    <RecordSurfaceSectionView
      chrome={chrome}
      description={description}
      emptyMessage={emptyMessage}
      fields={fieldEntries.map((entry) => entry.field)}
      renderField={(field) => {
        const entry = fieldEntries.find((candidate) => candidate.field === field);
        if (!entry) {
          return null;
        }
        const row = entry.row;
        const predicate = row.predicate;
        return (
          <PredicateRow
            customEditor={
              predicate
                ? (row.customEditor ??
                  (runtime &&
                  submitSecretField &&
                  isSecretBackedField(predicate.field) &&
                  predicate.field.cardinality !== "many"
                    ? (callbacks) => (
                        <SecretFieldEditor
                          callbacks={callbacks}
                          predicate={predicate}
                          runtime={runtime}
                          submitSecretField={submitSecretField}
                        />
                      )
                    : undefined))
                : undefined
            }
            description={row.description}
            descriptionVisibility={row.descriptionVisibility}
            display={row.display}
            hideMissingStatus={hideMissingStatus}
            labelVisibility={row.labelVisibility}
            mode={mode}
            pathLabel={row.pathLabel}
            predicate={predicate}
            readOnly={row.readOnly}
            title={row.title}
            validationMessages={[
              ...(row.validationMessages ?? []),
              ...(validationMessagesByPath?.get(row.pathLabel) ?? []),
            ]}
            validationPlacement={row.validationPlacement}
            value={row.value}
          />
        );
      }}
      section={{
        ...(description ? { description } : {}),
        fields: fieldEntries.map((entry) => entry.field),
        key: title,
        title,
      }}
    />
  );
}
