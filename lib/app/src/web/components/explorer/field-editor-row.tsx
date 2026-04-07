import { fieldWritePolicy, isEntityType, typeId } from "@io/app/graph";
import {
  defaultWebFieldResolver,
  GraphIcon,
  PredicateFieldEditor,
  PredicateFieldView,
} from "@io/graph-module-core/react-dom";
import {
  formatPredicateValue,
  usePersistedMutationCallbacks,
  usePredicateField,
} from "@io/graph-react";
import { cn } from "@io/web/utils";
import { useContext, useEffect, useState, type ReactNode } from "react";

import type {
  EntitySurfaceDescriptionVisibilityPolicy,
  EntitySurfaceLabelVisibilityPolicy,
  EntitySurfaceMode,
  EntitySurfaceModeValue,
  EntitySurfaceValidationPlacementPolicy,
} from "../entity-surface-plan.js";
import {
  collectFieldValidationMessages,
  describePredicateValue,
  formatPredicateMetaSummary,
  getEntityLabel,
  getFieldLabel,
  statusBadgeClass,
} from "./helpers.js";
import { iconTypeId } from "./model.js";
import type { AnyPredicateRef, FieldValidationMessage, MutationCallbacks } from "./model.js";
import { ExplorerSyncContext } from "./sync.js";
import { Badge } from "./ui.js";

type PredicateRowDisplay = "compact" | "default";

function ValidationMessagePanel({
  attribute,
  messages,
}: {
  attribute: string;
  messages: readonly FieldValidationMessage[];
}) {
  if (messages.length === 0) return null;

  return (
    <div
      className="mt-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100"
      data-explorer-field-validation={attribute}
    >
      <div className="mb-2 text-xs font-medium tracking-[0.16em] text-rose-200 uppercase">
        Validation
      </div>
      <div className="space-y-2">
        {messages.map((issue) => (
          <div
            className="flex flex-wrap items-start gap-2"
            data-explorer-field-validation-message={issue.pathLabel || attribute}
            key={issue.id}
          >
            <Badge className="border-rose-400/30 bg-rose-400/10 text-rose-100">
              {issue.source}
            </Badge>
            <span>{issue.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function isModeValueRecord<T>(
  value: EntitySurfaceModeValue<T> | undefined,
): value is Partial<Record<EntitySurfaceMode, T>> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    ("view" in value || "edit" in value)
  );
}

function resolveModeValue<T>(
  value: EntitySurfaceModeValue<T> | undefined,
  mode: EntitySurfaceMode,
  fallback: T,
): T {
  if (value === undefined) return fallback;
  if (isModeValueRecord(value)) return value[mode] ?? fallback;
  return value;
}

function mergeValidationMessages(
  ...groups: ReadonlyArray<readonly FieldValidationMessage[] | undefined>
): FieldValidationMessage[] {
  const merged = new Map<string, FieldValidationMessage>();

  for (const group of groups) {
    for (const message of group ?? []) {
      merged.set(message.id, message);
    }
  }

  return [...merged.values()];
}

function FieldIssueBadge({
  issueLabel,
  invalid,
  statusTone,
}: {
  issueLabel: string | null;
  invalid: boolean;
  statusTone?: "empty" | "missing" | "present";
}) {
  if (!issueLabel) return null;

  return (
    <Badge
      className={
        invalid
          ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
          : statusTone
            ? statusBadgeClass(statusTone)
            : "border-border bg-muted/30 text-muted-foreground"
      }
      data={{
        "data-explorer-field-status": invalid ? "invalid" : (statusTone ?? "valid"),
      }}
    >
      {issueLabel}
    </Badge>
  );
}

function PredicateValuePreview({ predicate }: { predicate: AnyPredicateRef }) {
  const { value } = usePredicateField(predicate);

  if (predicate.rangeType && isEntityType(predicate.rangeType)) {
    const isIconRange = typeId(predicate.rangeType) === iconTypeId;
    const ids = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : typeof value === "string"
        ? [value]
        : [];

    if (ids.length === 0) {
      if (predicate.field.cardinality === "one?") return null;
      return <span className="text-muted-foreground text-sm">Unset</span>;
    }

    return (
      <div className="flex flex-wrap gap-1.5">
        {ids.map((id) => {
          const entity = predicate.resolveEntity(id);
          const label = entity ? getEntityLabel(entity) : "Unresolved reference";
          return (
            <Badge
              className="border-border bg-muted/40 text-foreground tracking-normal normal-case"
              key={id}
            >
              <span className="inline-flex items-center gap-1.5">
                {isIconRange ? (
                  <GraphIcon className="text-foreground/70 size-3.5" iconId={id} />
                ) : null}
                <span>{label}</span>
              </span>
            </Badge>
          );
        })}
      </div>
    );
  }

  if (value === undefined) {
    if (predicate.field.cardinality === "one?") return null;
    return <span className="text-muted-foreground text-sm">Unset</span>;
  }

  if (Array.isArray(value) && value.length === 0) {
    return <span className="text-muted-foreground text-sm">Empty</span>;
  }

  const formatted = formatPredicateValue(predicate, value as never);
  if (formatted.length > 0) {
    return <span className="text-foreground text-sm">{formatted}</span>;
  }

  if (value === "") {
    return <span className="text-muted-foreground text-sm">Empty string</span>;
  }

  return <span className="text-foreground text-sm">{String(value)}</span>;
}

function CompactPredicateValue({ predicate }: { predicate: AnyPredicateRef }) {
  const { value } = usePredicateField(predicate);
  const viewResolution = defaultWebFieldResolver.resolveView(predicate);

  if (value === undefined) {
    return <span className="text-muted-foreground">Unset</span>;
  }

  if (Array.isArray(value) && value.length === 0) {
    return <span className="text-muted-foreground">Unset</span>;
  }

  if (value === "") {
    return <span className="text-muted-foreground">Empty string</span>;
  }

  if (viewResolution.status === "unsupported") {
    return <PredicateValuePreview predicate={predicate} />;
  }

  return <PredicateFieldView predicate={predicate} />;
}

function CompactRow({
  fieldTitle,
  helperText,
  issueLabel,
  mode,
  predicate,
  shouldShowInlineValidation,
  shouldShowLabel,
  statusTone,
  validationMessages,
  pathLabel,
  value,
}: {
  fieldTitle: string;
  helperText?: string;
  issueLabel: string | null;
  mode: EntitySurfaceMode;
  pathLabel: string;
  predicate?: AnyPredicateRef;
  shouldShowInlineValidation: boolean;
  shouldShowLabel: boolean;
  statusTone?: "empty" | "missing" | "present";
  validationMessages: readonly FieldValidationMessage[];
  value?: ReactNode;
}) {
  return (
    <div
      className="space-y-3 pb-4 last:pb-0"
      data-explorer-field-display="compact"
      data-explorer-field-mode={mode}
      data-explorer-field-path={pathLabel}
      data-explorer-field-validation-state={validationMessages.length > 0 ? "invalid" : "valid"}
    >
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <FieldIssueBadge
          invalid={validationMessages.length > 0}
          issueLabel={issueLabel}
          statusTone={statusTone}
        />
      </div>

      <div
        className={cn(
          "border-border/60 bg-muted/10 grid items-start gap-3 rounded-xl border px-3 py-2",
          shouldShowLabel ? "grid-cols-[minmax(0,auto)_minmax(0,1fr)]" : "grid-cols-1",
        )}
        data-explorer-field-compact={pathLabel}
      >
        {shouldShowLabel ? (
          <div
            className="text-muted-foreground text-[11px] font-medium tracking-[0.16em] uppercase"
            data-explorer-field-label={pathLabel}
          >
            {fieldTitle}
          </div>
        ) : null}
        <div
          className={cn(
            "min-w-0 text-sm break-words [&_a]:underline-offset-2 [&_a:hover]:underline [&_code]:text-[11px] [&_code]:break-all [&_li]:list-none [&_ul]:space-y-1",
            shouldShowLabel ? "justify-self-end text-right" : "",
          )}
        >
          {predicate ? <CompactPredicateValue predicate={predicate} /> : value}
        </div>
      </div>

      {helperText ? <div className="text-muted-foreground text-xs">{helperText}</div> : null}

      {shouldShowInlineValidation ? (
        <ValidationMessagePanel attribute={pathLabel} messages={validationMessages} />
      ) : null}
    </div>
  );
}

export function PredicateRow({
  customEditor,
  description,
  descriptionVisibility = "auto",
  display = "default",
  hideMissingStatus = false,
  labelVisibility = "auto",
  mode,
  pathLabel,
  predicate,
  readOnly = false,
  title,
  validationMessages = [],
  validationPlacement = "auto",
  value,
}: {
  customEditor?: (callbacks: MutationCallbacks) => ReactNode;
  description?: string;
  descriptionVisibility?: EntitySurfaceModeValue<EntitySurfaceDescriptionVisibilityPolicy>;
  display?: EntitySurfaceModeValue<PredicateRowDisplay>;
  hideMissingStatus?: boolean;
  labelVisibility?: EntitySurfaceModeValue<EntitySurfaceLabelVisibilityPolicy>;
  mode: EntitySurfaceMode;
  pathLabel: string;
  predicate?: AnyPredicateRef;
  readOnly?: boolean;
  title?: string;
  validationMessages?: readonly FieldValidationMessage[];
  validationPlacement?: EntitySurfaceModeValue<EntitySurfaceValidationPlacementPolicy>;
  value?: ReactNode;
}) {
  const resolvedDisplay = resolveModeValue(display, mode, "default");
  const resolvedDescriptionVisibility = resolveModeValue(descriptionVisibility, mode, "auto");
  const resolvedLabelVisibility = resolveModeValue(labelVisibility, mode, "auto");
  const resolvedValidationPlacement = resolveModeValue(validationPlacement, mode, "auto");
  const shouldShowLabel = resolvedLabelVisibility !== "hide";
  const shouldShowInlineValidation = resolvedValidationPlacement !== "summary-only";

  if (!predicate) {
    const issueLabel = validationMessages.length > 0 ? "invalid" : null;

    if (resolvedDisplay === "compact") {
      return (
        <CompactRow
          fieldTitle={title ?? pathLabel}
          helperText={
            description && resolvedDescriptionVisibility !== "hide" ? description : undefined
          }
          issueLabel={issueLabel}
          mode={mode}
          pathLabel={pathLabel}
          shouldShowInlineValidation={shouldShowInlineValidation}
          shouldShowLabel={shouldShowLabel}
          validationMessages={validationMessages}
          value={value}
        />
      );
    }

    return (
      <div
        className="space-y-3 pb-4 last:pb-0"
        data-explorer-field-mode={mode}
        data-explorer-field-path={pathLabel}
        data-explorer-field-validation-state={validationMessages.length > 0 ? "invalid" : "valid"}
      >
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              {shouldShowLabel ? (
                <div
                  className="flex flex-wrap items-center gap-2"
                  data-explorer-field-heading={pathLabel}
                >
                  <div
                    className="text-foreground text-sm font-medium"
                    data-explorer-field-label={pathLabel}
                  >
                    {title ?? pathLabel}
                  </div>
                </div>
              ) : null}
              {description && resolvedDescriptionVisibility !== "hide" ? (
                <div className="text-muted-foreground text-xs">{description}</div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <FieldIssueBadge invalid={validationMessages.length > 0} issueLabel={issueLabel} />
            </div>
          </div>
        </div>

        <div className="mt-3">{value}</div>

        {shouldShowInlineValidation ? (
          <ValidationMessagePanel attribute={pathLabel} messages={validationMessages} />
        ) : null}
      </div>
    );
  }

  const rowPredicate = predicate;
  const sync = useContext(ExplorerSyncContext);
  const binding = usePredicateField(rowPredicate);
  const status = describePredicateValue(rowPredicate, binding.value);
  const editorResolution = defaultWebFieldResolver.resolveEditor(rowPredicate);
  const writePolicy = fieldWritePolicy(rowPredicate.field);
  const isEditable =
    mode === "edit" &&
    !readOnly &&
    (customEditor !== undefined ||
      (writePolicy === "client-tx" && editorResolution.status === "resolved"));
  const [localValidationMessages, setLocalValidationMessages] = useState<FieldValidationMessage[]>(
    [],
  );

  useEffect(() => {
    setLocalValidationMessages([]);
  }, [binding.value]);

  function handleMutationError(error: unknown): void {
    setLocalValidationMessages(collectFieldValidationMessages(error, rowPredicate));
  }

  function handleMutationSuccess(): void {
    setLocalValidationMessages([]);
  }

  const mutationCallbacks = usePersistedMutationCallbacks(
    {
      onMutationError: handleMutationError,
      onMutationSuccess: handleMutationSuccess,
    },
    sync ? { sync } : null,
  );
  const fieldTitle = title ?? getFieldLabel(rowPredicate);
  const mergedValidationMessages = mergeValidationMessages(
    localValidationMessages,
    validationMessages,
  );
  const shouldHideMissingStatus =
    hideMissingStatus && mergedValidationMessages.length === 0 && status.tone === "missing";
  const metaSummary = formatPredicateMetaSummary(rowPredicate, {
    includeReadOnly: !isEditable,
    status: shouldHideMissingStatus ? undefined : status,
  });
  const helperText = description ?? metaSummary;
  const shouldShowHelperText =
    resolvedDescriptionVisibility === "show"
      ? helperText !== undefined
      : resolvedDescriptionVisibility === "hide"
        ? false
        : Boolean(helperText);
  const isOptionalField = rowPredicate.field.cardinality !== "one";
  const issueLabel =
    mergedValidationMessages.length > 0
      ? "invalid"
      : status.tone === "present" ||
          status.label === "unset" ||
          status.label === "empty" ||
          shouldHideMissingStatus
        ? null
        : status.label;
  const editorContent =
    customEditor?.({
      onMutationError: mutationCallbacks.onMutationError,
      onMutationSuccess: mutationCallbacks.onMutationSuccess,
    }) ??
    (isEditable ? (
      <PredicateFieldEditor
        onMutationError={mutationCallbacks.onMutationError}
        onMutationSuccess={mutationCallbacks.onMutationSuccess}
        predicate={rowPredicate}
      />
    ) : (
      <PredicateValuePreview predicate={rowPredicate} />
    ));

  if (resolvedDisplay === "compact") {
    return (
      <CompactRow
        fieldTitle={fieldTitle}
        helperText={shouldShowHelperText ? helperText : undefined}
        issueLabel={issueLabel}
        mode={mode}
        pathLabel={pathLabel}
        predicate={rowPredicate}
        shouldShowInlineValidation={shouldShowInlineValidation}
        shouldShowLabel={shouldShowLabel}
        statusTone={status.tone}
        validationMessages={mergedValidationMessages}
      />
    );
  }

  return (
    <div
      className="space-y-3 pb-4 last:pb-0"
      data-explorer-field-mode={mode}
      data-explorer-field-path={pathLabel}
      data-explorer-field-validation-state={
        mergedValidationMessages.length > 0 ? "invalid" : "valid"
      }
      data-explorer-field-state={status.tone}
    >
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            {shouldShowLabel ? (
              <div
                className="flex flex-wrap items-center gap-2"
                data-explorer-field-heading={pathLabel}
              >
                <div
                  className={cn(
                    "text-sm font-medium",
                    isOptionalField ? "text-foreground/65" : "text-foreground",
                  )}
                  data-explorer-field-label={pathLabel}
                >
                  {fieldTitle}
                </div>
              </div>
            ) : null}
            {shouldShowHelperText ? (
              <div className="text-muted-foreground text-xs">{helperText}</div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <FieldIssueBadge
              invalid={mergedValidationMessages.length > 0}
              issueLabel={issueLabel}
              statusTone={status.tone}
            />
          </div>
        </div>
      </div>

      <div className="mt-3">{editorContent}</div>

      {shouldShowInlineValidation ? (
        <ValidationMessagePanel attribute={pathLabel} messages={mergedValidationMessages} />
      ) : null}
    </div>
  );
}
