import { fieldWritePolicy, isEntityType, typeId } from "@io/core/graph";
import {
  defaultWebFieldResolver,
  GraphIcon,
  PredicateFieldEditor,
  PredicateFieldView,
} from "@io/core/graph/adapters/react-dom";
import {
  formatPredicateValue,
  usePersistedMutationCallbacks,
  usePredicateField,
} from "@io/graph-react";
import { cn } from "@io/web/utils";
import { useContext, useEffect, useState, type ReactNode } from "react";

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
  pathLabel,
  predicate,
  title,
  value,
}: {
  pathLabel: string;
  predicate?: AnyPredicateRef;
  title?: string;
  value?: ReactNode;
}) {
  const fieldTitle = title ?? (predicate ? getFieldLabel(predicate) : pathLabel);

  return (
    <div
      className="border-border/60 bg-muted/10 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-start gap-3 rounded-xl border px-3 py-2"
      data-explorer-field-compact={pathLabel}
    >
      <div className="text-muted-foreground text-[11px] font-medium tracking-[0.16em] uppercase">
        {fieldTitle}
      </div>
      <div className="min-w-0 justify-self-end text-right text-sm break-words [&_a]:underline-offset-2 [&_a:hover]:underline [&_code]:text-[11px] [&_code]:break-all [&_li]:list-none [&_ul]:space-y-1">
        {predicate ? <CompactPredicateValue predicate={predicate} /> : value}
      </div>
    </div>
  );
}

export function PredicateRow({
  customEditor,
  description,
  display = "default",
  hideMissingStatus = false,
  pathLabel,
  predicate,
  readOnly = false,
  title,
  value,
}: {
  customEditor?: (callbacks: MutationCallbacks) => ReactNode;
  description?: string;
  display?: "compact" | "default";
  hideMissingStatus?: boolean;
  pathLabel: string;
  predicate?: AnyPredicateRef;
  readOnly?: boolean;
  title?: string;
  value?: ReactNode;
}) {
  if (display === "compact") {
    return <CompactRow pathLabel={pathLabel} predicate={predicate} title={title} value={value} />;
  }

  if (!predicate) {
    return (
      <div className="space-y-3 pb-4 last:pb-0" data-explorer-field-path={pathLabel}>
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
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
              {description ? (
                <div className="text-muted-foreground text-xs">{description}</div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-3">{value}</div>
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
    !readOnly &&
    (customEditor !== undefined ||
      (writePolicy === "client-tx" && editorResolution.status === "resolved"));
  const [validationMessages, setValidationMessages] = useState<FieldValidationMessage[]>([]);

  useEffect(() => {
    setValidationMessages([]);
  }, [binding.value]);

  function handleMutationError(error: unknown): void {
    setValidationMessages(collectFieldValidationMessages(error, rowPredicate));
  }

  function handleMutationSuccess(): void {
    setValidationMessages([]);
  }

  const mutationCallbacks = usePersistedMutationCallbacks(
    {
      onMutationError: handleMutationError,
      onMutationSuccess: handleMutationSuccess,
    },
    sync ? { sync } : null,
  );
  const fieldTitle = title ?? getFieldLabel(rowPredicate);
  const shouldHideMissingStatus =
    hideMissingStatus && validationMessages.length === 0 && status.tone === "missing";
  const metaSummary = formatPredicateMetaSummary(rowPredicate, {
    includeReadOnly: !isEditable,
    status: shouldHideMissingStatus ? undefined : status,
  });
  const helperText = description ?? metaSummary;
  const isOptionalField = rowPredicate.field.cardinality !== "one";
  const issueLabel =
    validationMessages.length > 0
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

  return (
    <div
      className="space-y-3 pb-4 last:pb-0"
      data-explorer-field-path={pathLabel}
      data-explorer-field-validation-state={validationMessages.length > 0 ? "invalid" : "valid"}
      data-explorer-field-state={status.tone}
    >
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
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
            {helperText ? <div className="text-muted-foreground text-xs">{helperText}</div> : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {issueLabel ? (
              <Badge
                className={
                  validationMessages.length > 0
                    ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
                    : statusBadgeClass(status.tone)
                }
                data={{
                  "data-explorer-field-status":
                    validationMessages.length > 0 ? "invalid" : status.tone,
                }}
              >
                {issueLabel}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-3">{editorContent}</div>

      <ValidationMessagePanel attribute={pathLabel} messages={validationMessages} />
    </div>
  );
}
