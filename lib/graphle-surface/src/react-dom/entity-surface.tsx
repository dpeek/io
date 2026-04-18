"use client";

import {
  formatValidationPath,
  GraphValidationError,
  type EntityRef,
  type GraphMutationValidationResult,
  type GraphValidationIssue,
} from "@dpeek/graphle-client";
import { fieldWritePolicy, isEntityType, typeId, type AnyTypeOutput } from "@dpeek/graphle-kernel";
import type { RecordSurfaceSpec } from "@dpeek/graphle-module";
import { core } from "@dpeek/graphle-module-core";
import {
  defaultWebFieldResolver,
  GraphIcon,
  PredicateFieldControl,
  PredicateFieldView,
} from "@dpeek/graphle-module-core/react-dom";
import {
  createEntityDraftController,
  formatPredicateValue,
  persistSyncedGraphChanges,
  usePersistedMutationCallbacks,
  usePredicateField,
  type MutationCallbacks,
  type PersistedMutationRuntime,
  type ValidationIssue,
} from "@dpeek/graphle-react";
import { Badge } from "@dpeek/graphle-web-ui/badge";
import { Button } from "@dpeek/graphle-web-ui/button";
import { ButtonGroup } from "@dpeek/graphle-web-ui/button-group";
import { Card, CardContent, CardFooter } from "@dpeek/graphle-web-ui/card";
import { Empty, EmptyDescription } from "@dpeek/graphle-web-ui/empty";
import { cn } from "@dpeek/graphle-web-ui/utils";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { buildEntityCreateDefaults, buildEntityCreatePlan } from "../entity-create-plan.js";
import {
  buildDraftEntitySurfacePlan,
  buildLiveEntitySurfacePlan,
  type AnyEntitySurfaceEntityRef,
  type AnyEntitySurfacePredicateRef,
  type EntitySurfaceDescriptionVisibilityPolicy,
  type EntitySurfaceLabelVisibilityPolicy,
  type EntitySurfaceMode,
  type EntitySurfaceModeValue,
  type EntitySurfacePlan,
  type EntitySurfaceRowPlan,
  type EntitySurfaceRowRole,
  type EntitySurfaceValidationPlacementPolicy,
} from "../entity-surface-plan.js";
import type { RecordSurfaceFieldBinding } from "../record-surface.js";
import { RecordSurfaceSectionView } from "./record-surface-mount.js";

export type PredicateRowDisplay = "compact" | "default";

export type EntitySurfaceValidationMessage = {
  readonly id: string;
  readonly message: string;
  readonly pathLabel: string;
  readonly source: string;
};

export type EntitySurfaceFieldEditorRendererInput = {
  readonly callbacks: MutationCallbacks;
  readonly mode: EntitySurfaceMode;
  readonly pathLabel: string;
  readonly predicate: AnyEntitySurfacePredicateRef;
  readonly validationMessages: readonly EntitySurfaceValidationMessage[];
};

export type EntitySurfaceFieldEditorRenderer = (
  input: EntitySurfaceFieldEditorRendererInput,
) => ReactNode | undefined;

export type EntitySurfaceFieldRow = {
  readonly customEditor?: (callbacks: MutationCallbacks) => ReactNode;
  readonly description?: string;
  readonly descriptionVisibility?: EntitySurfaceModeValue<EntitySurfaceDescriptionVisibilityPolicy>;
  readonly display?: EntitySurfaceModeValue<PredicateRowDisplay>;
  readonly labelVisibility?: EntitySurfaceModeValue<EntitySurfaceLabelVisibilityPolicy>;
  readonly pathLabel: string;
  readonly predicate?: AnyEntitySurfacePredicateRef;
  readonly readOnly?: boolean;
  readonly renderEditor?: EntitySurfaceFieldEditorRenderer;
  readonly role?: EntitySurfaceRowRole;
  readonly title?: string;
  readonly validationMessages?: readonly EntitySurfaceValidationMessage[];
  readonly validationPlacement?: EntitySurfaceModeValue<EntitySurfaceValidationPlacementPolicy>;
  readonly value?: ReactNode;
};

export type EntitySurfaceFieldSectionModel = {
  readonly description?: string;
  readonly key: string;
  readonly rows: readonly EntitySurfaceFieldRow[];
  readonly title: string;
};

export type CreateEntitySurfaceActionState = {
  readonly busy: boolean;
  readonly submit: () => Promise<void>;
  readonly submitLabel: string;
  readonly supported: boolean;
};

const iconTypeId = typeId(core.icon);

function ValidationMessagePanel({
  attribute,
  messages,
}: {
  readonly attribute: string;
  readonly messages: readonly EntitySurfaceValidationMessage[];
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

function ValidationSummary({ message }: { readonly message: string }) {
  if (!message) return null;

  return (
    <div
      className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100"
      data-explorer-create-error="true"
    >
      {message}
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
  ...groups: ReadonlyArray<readonly EntitySurfaceValidationMessage[] | undefined>
): EntitySurfaceValidationMessage[] {
  const merged = new Map<string, EntitySurfaceValidationMessage>();

  for (const group of groups) {
    for (const message of group ?? []) {
      merged.set(message.id, message);
    }
  }

  return [...merged.values()];
}

function validationMessagesToIssues(
  messages: readonly EntitySurfaceValidationMessage[],
): readonly ValidationIssue[] {
  return messages.map((message) => ({
    kind: "path",
    message: message.message,
    path: Object.freeze(message.pathLabel.split(".").filter(Boolean)),
    source: message.source,
  }));
}

function formatFieldValidationMessage(
  issue: Pick<
    GraphValidationIssue,
    "code" | "message" | "nodeId" | "path" | "predicateKey" | "source"
  >,
  index: number,
): EntitySurfaceValidationMessage {
  return {
    id: `${issue.nodeId}:${issue.predicateKey}:${issue.code}:${index}`,
    message: issue.message,
    pathLabel: formatValidationPath(issue.path),
    source: issue.source,
  };
}

export function collectEntitySurfaceValidationMessages(
  error: unknown,
): EntitySurfaceValidationMessage[] {
  if (!(error instanceof GraphValidationError)) return [];
  return error.result.issues.map((issue, index) => formatFieldValidationMessage(issue, index));
}

export function collectEntitySurfaceValidationMessagesByPath(
  error: unknown,
): Map<string, EntitySurfaceValidationMessage[]> {
  const grouped = new Map<string, EntitySurfaceValidationMessage[]>();

  for (const message of collectEntitySurfaceValidationMessages(error)) {
    if (message.pathLabel.length === 0) continue;
    const existing = grouped.get(message.pathLabel);
    if (existing) {
      existing.push(message);
      continue;
    }
    grouped.set(message.pathLabel, [message]);
  }

  return grouped;
}

function collectFieldValidationMessages(
  error: unknown,
  predicate: AnyEntitySurfacePredicateRef,
): EntitySurfaceValidationMessage[] {
  if (!(error instanceof GraphValidationError)) return [];
  const relevantByNode = error.result.issues.filter(
    (issue) => issue.nodeId === predicate.subjectId && issue.predicateKey === predicate.field.key,
  );
  const relevantByPredicate = error.result.issues.filter(
    (issue) => issue.predicateKey === predicate.field.key,
  );
  const issues =
    relevantByNode.length > 0
      ? relevantByNode
      : relevantByPredicate.length > 0
        ? relevantByPredicate
        : error.result.issues;

  return issues.map((issue, index) => formatFieldValidationMessage(issue, index));
}

function validationMessagesFromResult(
  result: Extract<GraphMutationValidationResult, { ok: false }>,
): EntitySurfaceValidationMessage[] {
  return result.issues.map((issue, index) => formatFieldValidationMessage(issue, index));
}

function FieldIssueBadge({
  issueLabel,
  invalid,
  statusTone,
}: {
  readonly issueLabel: string | null;
  readonly invalid: boolean;
  readonly statusTone?: "empty" | "missing" | "present";
}) {
  if (!issueLabel) return null;

  return (
    <Badge
      className={
        invalid
          ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
          : statusTone === "missing"
            ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
            : statusTone === "empty"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
              : statusTone === "present"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : "border-border bg-muted/30 text-muted-foreground"
      }
      data-explorer-field-status={invalid ? "invalid" : (statusTone ?? "valid")}
    >
      {issueLabel}
    </Badge>
  );
}

function getEntityLabel(
  entity: { readonly id: string; get(): Record<string, unknown> },
  fallbackLabel = "Untitled record",
): string {
  const snapshot = entity.get();
  const name = snapshot.name;
  if (typeof name === "string" && name.length > 0) return name;
  return fallbackLabel;
}

function getFieldLabel(predicate: AnyEntitySurfacePredicateRef): string {
  const field = predicate.field as {
    readonly key: string;
    readonly meta?: { readonly label?: string };
  };
  if (field.meta?.label) return field.meta.label;
  const segments = field.key.split(":");
  return segments.at(-1) ?? field.key;
}

function startCase(text: string): string {
  return text.length > 0 ? `${text[0]!.toUpperCase()}${text.slice(1)}` : text;
}

function describePredicateValue(
  predicate: AnyEntitySurfacePredicateRef,
  value: unknown,
): {
  readonly label: string;
  readonly tone: "empty" | "missing" | "present";
} {
  if (predicate.field.cardinality === "many") {
    const count = Array.isArray(value) ? value.length : 0;
    return count > 0
      ? { label: `${count} items`, tone: "present" }
      : { label: "empty", tone: "empty" };
  }

  if (value === undefined) {
    return predicate.field.cardinality === "one"
      ? { label: "missing", tone: "missing" }
      : { label: "unset", tone: "empty" };
  }

  if (typeof value === "string" && value.length === 0) {
    return { label: "empty string", tone: "empty" };
  }

  return { label: "set", tone: "present" };
}

function formatPredicateMetaSummary(
  predicate: AnyEntitySurfacePredicateRef,
  options: {
    readonly status?: ReturnType<typeof describePredicateValue>;
  },
): string {
  const parts: string[] = [];

  if (
    options.status &&
    options.status.tone !== "present" &&
    options.status.label !== "unset" &&
    options.status.label !== "empty"
  ) {
    parts.push(startCase(options.status.label));
  }

  return parts.join(" · ");
}

function PredicateValuePreview({
  predicate,
}: {
  readonly predicate: AnyEntitySurfacePredicateRef;
}) {
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

function PredicateValueView({ predicate }: { readonly predicate: AnyEntitySurfacePredicateRef }) {
  const viewResolution = defaultWebFieldResolver.resolveView(predicate);
  if (viewResolution.status === "unsupported") {
    return <PredicateValuePreview predicate={predicate} />;
  }
  return <PredicateFieldView predicate={predicate} />;
}

function CompactPredicateValue({
  predicate,
}: {
  readonly predicate: AnyEntitySurfacePredicateRef;
}) {
  const { value } = usePredicateField(predicate);

  if (value === undefined) {
    return <span className="text-muted-foreground">Unset</span>;
  }

  if (Array.isArray(value) && value.length === 0) {
    return <span className="text-muted-foreground">Unset</span>;
  }

  if (value === "") {
    return <span className="text-muted-foreground">Empty string</span>;
  }

  return <PredicateValueView predicate={predicate} />;
}

function TitleRow({
  mode,
  pathLabel,
  predicate,
  validationMessages,
  value,
}: {
  readonly mode: EntitySurfaceMode;
  readonly pathLabel: string;
  readonly predicate?: AnyEntitySurfacePredicateRef;
  readonly validationMessages: readonly EntitySurfaceValidationMessage[];
  readonly value?: ReactNode;
}) {
  return (
    <div
      data-entity-surface-title={pathLabel}
      data-explorer-field-mode={mode}
      data-explorer-field-path={pathLabel}
      data-explorer-field-role="title"
      data-explorer-field-validation-state={validationMessages.length > 0 ? "invalid" : "valid"}
    >
      <h1 className="text-foreground text-3xl leading-tight font-semibold tracking-normal">
        {predicate ? <PredicateValueView predicate={predicate} /> : value}
      </h1>
    </div>
  );
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
  readonly fieldTitle: string;
  readonly helperText?: string;
  readonly issueLabel: string | null;
  readonly mode: EntitySurfaceMode;
  readonly pathLabel: string;
  readonly predicate?: AnyEntitySurfacePredicateRef;
  readonly shouldShowInlineValidation: boolean;
  readonly shouldShowLabel: boolean;
  readonly statusTone?: "empty" | "missing" | "present";
  readonly validationMessages: readonly EntitySurfaceValidationMessage[];
  readonly value?: ReactNode;
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
        className="border-border/60 bg-muted/10 flex flex-col gap-2 rounded-xl border px-3 py-2"
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
        <div className="min-w-0 text-sm wrap-break-word [&_a]:underline-offset-2 [&_a:hover]:underline [&_code]:text-[11px] [&_code]:break-all [&_li]:list-none [&_ul]:space-y-1">
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
  mutationRuntime,
  pathLabel,
  predicate,
  readOnly = false,
  renderEditor,
  role = "body",
  title,
  validationMessages = [],
  validationPlacement = "auto",
  value,
}: {
  readonly customEditor?: (callbacks: MutationCallbacks) => ReactNode;
  readonly description?: string;
  readonly descriptionVisibility?: EntitySurfaceModeValue<EntitySurfaceDescriptionVisibilityPolicy>;
  readonly display?: EntitySurfaceModeValue<PredicateRowDisplay>;
  readonly hideMissingStatus?: boolean;
  readonly labelVisibility?: EntitySurfaceModeValue<EntitySurfaceLabelVisibilityPolicy>;
  readonly mode: EntitySurfaceMode;
  readonly mutationRuntime?: PersistedMutationRuntime | null;
  readonly pathLabel: string;
  readonly predicate?: AnyEntitySurfacePredicateRef;
  readonly readOnly?: boolean;
  readonly renderEditor?: EntitySurfaceFieldEditorRenderer;
  readonly role?: EntitySurfaceRowRole;
  readonly title?: string;
  readonly validationMessages?: readonly EntitySurfaceValidationMessage[];
  readonly validationPlacement?: EntitySurfaceModeValue<EntitySurfaceValidationPlacementPolicy>;
  readonly value?: ReactNode;
}) {
  const resolvedDisplay = resolveModeValue(display, mode, "default");
  const resolvedDescriptionVisibility = resolveModeValue(descriptionVisibility, mode, "auto");
  const resolvedLabelVisibility = resolveModeValue(labelVisibility, mode, "auto");
  const resolvedValidationPlacement = resolveModeValue(validationPlacement, mode, "auto");
  const shouldShowLabel = resolvedLabelVisibility !== "hide";
  const shouldShowInlineValidation = resolvedValidationPlacement !== "summary-only";

  if (mode === "view" && role === "title") {
    return (
      <TitleRow
        mode={mode}
        pathLabel={pathLabel}
        predicate={predicate}
        validationMessages={validationMessages}
        value={value}
      />
    );
  }

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
  const binding = usePredicateField(rowPredicate);
  const status = describePredicateValue(rowPredicate, binding.value);
  const editorResolution = defaultWebFieldResolver.resolveControl(rowPredicate);
  const writePolicy = fieldWritePolicy(
    rowPredicate.field as Parameters<typeof fieldWritePolicy>[0],
  );
  const isEditable =
    mode === "edit" &&
    !readOnly &&
    (customEditor !== undefined ||
      renderEditor !== undefined ||
      (writePolicy === "client-tx" && editorResolution.status === "resolved"));
  const [localValidationMessages, setLocalValidationMessages] = useState<
    EntitySurfaceValidationMessage[]
  >([]);

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
    mutationRuntime,
  );
  const fieldTitle = title ?? getFieldLabel(rowPredicate);
  const mergedValidationMessages = mergeValidationMessages(
    localValidationMessages,
    validationMessages,
  );
  const shouldHideMissingStatus =
    hideMissingStatus && mergedValidationMessages.length === 0 && status.tone === "missing";
  const metaSummary = formatPredicateMetaSummary(rowPredicate, {
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
  const customEditorContent =
    customEditor?.({
      onMutationError: mutationCallbacks.onMutationError,
      onMutationSuccess: mutationCallbacks.onMutationSuccess,
    }) ??
    renderEditor?.({
      callbacks: {
        onMutationError: mutationCallbacks.onMutationError,
        onMutationSuccess: mutationCallbacks.onMutationSuccess,
      },
      mode,
      pathLabel,
      predicate: rowPredicate,
      validationMessages: mergedValidationMessages,
    });
  const editorContent =
    customEditorContent ??
    (isEditable ? (
      <PredicateFieldControl
        issues={validationMessagesToIssues(mergedValidationMessages)}
        onMutationError={mutationCallbacks.onMutationError}
        onMutationSuccess={mutationCallbacks.onMutationSuccess}
        predicate={rowPredicate}
      />
    ) : (
      <PredicateValueView predicate={rowPredicate} />
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

export function buildEntitySurfaceFieldRows(
  rows: readonly EntitySurfaceRowPlan<AnyEntitySurfacePredicateRef>[],
): EntitySurfaceFieldRow[] {
  return rows.flatMap((row) => {
    if (row.kind !== "predicate" || row.role === "hidden") {
      return [];
    }

    return [
      {
        ...(row.description ? { description: row.description } : {}),
        descriptionVisibility: row.chrome.descriptionVisibility,
        display: row.role === "meta" ? "compact" : "default",
        labelVisibility: row.chrome.labelVisibility,
        pathLabel: row.pathLabel,
        predicate: row.predicate,
        role: row.role,
        ...(row.title ? { title: row.title } : {}),
        validationPlacement: row.chrome.validationPlacement,
      } satisfies EntitySurfaceFieldRow,
    ];
  });
}

export function buildEntitySurfaceFieldSections(
  plan: EntitySurfacePlan<AnyEntitySurfacePredicateRef>,
): EntitySurfaceFieldSectionModel[] {
  const plannedSections =
    plan.sections.length > 0
      ? plan.sections
      : [
          {
            key: "fields",
            rows: plan.rows,
            title: "Fields",
          },
        ];

  return plannedSections.flatMap((section) => {
    const rows = buildEntitySurfaceFieldRows(section.rows);
    if (rows.length === 0) return [];
    return [
      {
        ...(section.description ? { description: section.description } : {}),
        key: section.key,
        rows,
        title: section.title,
      },
    ];
  });
}

export function EntitySurfaceFieldSection({
  chrome = true,
  description,
  emptyMessage = "No shared fields are available for this selection.",
  hideMissingStatus = false,
  mode,
  mutationRuntime,
  renderEditor,
  rows,
  title = "Fields",
  validationMessagesByPath,
}: {
  readonly chrome?: boolean;
  readonly description?: string;
  readonly emptyMessage?: string;
  readonly hideMissingStatus?: boolean;
  readonly mode: EntitySurfaceMode;
  readonly mutationRuntime?: PersistedMutationRuntime | null;
  readonly renderEditor?: EntitySurfaceFieldEditorRenderer;
  readonly rows: readonly EntitySurfaceFieldRow[];
  readonly title?: string;
  readonly validationMessagesByPath?: ReadonlyMap<
    string,
    readonly EntitySurfaceValidationMessage[]
  >;
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
        if (!entry) return null;
        const row = entry.row;
        return (
          <PredicateRow
            customEditor={row.customEditor}
            description={row.description}
            descriptionVisibility={row.descriptionVisibility}
            display={row.display}
            hideMissingStatus={hideMissingStatus}
            labelVisibility={row.labelVisibility}
            mode={mode}
            mutationRuntime={mutationRuntime}
            pathLabel={row.pathLabel}
            predicate={row.predicate}
            readOnly={row.readOnly}
            renderEditor={row.renderEditor ?? renderEditor}
            role={row.role}
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

export function EntitySurfaceFieldSections({
  chrome = true,
  emptyMessage,
  hideMissingStatus,
  mode,
  mutationRuntime,
  renderEditor,
  sections,
  validationMessagesByPath,
}: {
  readonly chrome?: boolean;
  readonly emptyMessage?: string;
  readonly hideMissingStatus?: boolean;
  readonly mode: EntitySurfaceMode;
  readonly mutationRuntime?: PersistedMutationRuntime | null;
  readonly renderEditor?: EntitySurfaceFieldEditorRenderer;
  readonly sections: readonly EntitySurfaceFieldSectionModel[];
  readonly validationMessagesByPath?: ReadonlyMap<
    string,
    readonly EntitySurfaceValidationMessage[]
  >;
}) {
  if (sections.length === 0) {
    return (
      <EntitySurfaceFieldSection
        chrome={chrome}
        emptyMessage={emptyMessage}
        hideMissingStatus={hideMissingStatus}
        mode={mode}
        mutationRuntime={mutationRuntime}
        renderEditor={renderEditor}
        rows={[]}
        validationMessagesByPath={validationMessagesByPath}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {sections.map((section) => (
        <EntitySurfaceFieldSection
          chrome={chrome}
          description={section.description}
          emptyMessage={emptyMessage}
          hideMissingStatus={hideMissingStatus}
          key={section.key}
          mode={mode}
          mutationRuntime={mutationRuntime}
          renderEditor={renderEditor}
          rows={section.rows}
          title={section.title}
          validationMessagesByPath={validationMessagesByPath}
        />
      ))}
    </div>
  );
}

function EntitySurfaceModeToggle({
  mode,
  onModeChange,
}: {
  readonly mode: EntitySurfaceMode;
  readonly onModeChange: (mode: EntitySurfaceMode) => void;
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
  mutationRuntime,
  onModeChange,
  renderEditor,
  sectionChrome = false,
  showModeToggle = true,
  surface,
  validationMessagesByPath,
}: {
  readonly defaultMode?: EntitySurfaceMode;
  readonly entity: AnyEntitySurfaceEntityRef;
  readonly mode?: EntitySurfaceMode;
  readonly mutationRuntime?: PersistedMutationRuntime | null;
  readonly onModeChange?: (mode: EntitySurfaceMode) => void;
  readonly renderEditor?: EntitySurfaceFieldEditorRenderer;
  readonly sectionChrome?: boolean;
  readonly showModeToggle?: boolean;
  readonly surface?: RecordSurfaceSpec;
  readonly validationMessagesByPath?: ReadonlyMap<
    string,
    readonly EntitySurfaceValidationMessage[]
  >;
}) {
  const [uncontrolledMode, setUncontrolledMode] = useState<EntitySurfaceMode>(defaultMode);
  const mode = controlledMode ?? uncontrolledMode;
  const surfacePlan = useMemo(
    () => buildLiveEntitySurfacePlan(entity, { mode, surface }),
    [entity, mode, surface],
  );
  const sections = useMemo(() => buildEntitySurfaceFieldSections(surfacePlan), [surfacePlan]);

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
        <EntitySurfaceFieldSections
          chrome={sectionChrome}
          emptyMessage="No editable fields are exposed for this record yet."
          mode={surfacePlan.mode}
          mutationRuntime={mutationRuntime}
          renderEditor={renderEditor}
          sections={sections}
          validationMessagesByPath={validationMessagesByPath}
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

function describeCreateError(error: unknown): string | null {
  if (error instanceof GraphValidationError) {
    return error.result.issues[0]?.message ?? error.message;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.length > 0) return error;
  return null;
}

export function CreateEntitySurfaceBody({
  create,
  createDefaults,
  draftSubjectId = "draft:entity",
  fieldTree,
  listEntities,
  mutationRuntime,
  onCreated,
  renderActions,
  renderEditor,
  resolveEntity,
  submitLabel = "Create record",
  surface,
  typeById,
  validateCreate,
  visibleFieldPaths,
}: {
  readonly create: (input: Record<string, unknown>) => string;
  readonly createDefaults?: Record<string, unknown>;
  readonly draftSubjectId?: string;
  readonly fieldTree: Record<string, unknown>;
  readonly listEntities: (rangeTypeId: string) => EntityRef<any, any>[];
  readonly mutationRuntime?: PersistedMutationRuntime | null;
  readonly onCreated: (entityId: string) => void;
  readonly renderActions?: (state: CreateEntitySurfaceActionState) => ReactNode;
  readonly renderEditor?: EntitySurfaceFieldEditorRenderer;
  readonly resolveEntity: (rangeTypeId: string, id: string) => EntityRef<any, any> | undefined;
  readonly submitLabel?: string;
  readonly surface?: RecordSurfaceSpec;
  readonly typeById: ReadonlyMap<string, AnyTypeOutput>;
  readonly validateCreate: (input: Record<string, unknown>) => GraphMutationValidationResult;
  readonly visibleFieldPaths?: readonly string[];
}) {
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitValidationMessagesByPath, setSubmitValidationMessagesByPath] = useState<
    ReadonlyMap<string, readonly EntitySurfaceValidationMessage[]>
  >(new Map());
  const createRef = useRef(create);
  const validateCreateRef = useRef(validateCreate);
  const onCreatedRef = useRef(onCreated);

  useEffect(() => {
    createRef.current = create;
  }, [create]);

  useEffect(() => {
    validateCreateRef.current = validateCreate;
  }, [validateCreate]);

  useEffect(() => {
    onCreatedRef.current = onCreated;
  }, [onCreated]);

  const createPlan = useMemo(() => buildEntityCreatePlan(fieldTree), [fieldTree]);
  const initialInput = useMemo(
    () => createDefaults ?? buildEntityCreateDefaults(fieldTree, typeById),
    [createDefaults, fieldTree, typeById],
  );
  const controller = useMemo(
    () =>
      createEntityDraftController({
        draftSubjectId,
        fieldTree,
        initialInput,
        listEntities,
        resolveEntity,
        typeById,
        validate: validateCreate,
      }),
    [
      draftSubjectId,
      fieldTree,
      initialInput,
      listEntities,
      resolveEntity,
      typeById,
      validateCreate,
    ],
  );
  const fieldPaths = useMemo(
    () => visibleFieldPaths ?? createPlan.clientFields.map((field) => field.pathLabel),
    [createPlan.clientFields, visibleFieldPaths],
  );
  const surfacePlan = useMemo(
    () =>
      buildDraftEntitySurfacePlan(controller.fields, fieldPaths, {
        mode: "edit",
        surface,
      }),
    [controller.fields, fieldPaths, surface],
  );
  const fieldSections = useMemo(() => buildEntitySurfaceFieldSections(surfacePlan), [surfacePlan]);
  const visibleFieldPathSet = useMemo(
    () => new Set(fieldSections.flatMap((section) => section.rows.map((row) => row.pathLabel))),
    [fieldSections],
  );

  async function handleCreate(): Promise<void> {
    const input = controller.session.getSnapshot().draftValue;
    const validation = validateCreateRef.current(input);

    if (!validation.ok) {
      const fieldMessagesByPath = new Map<string, readonly EntitySurfaceValidationMessage[]>();

      for (const message of validationMessagesFromResult(validation)) {
        if (!visibleFieldPathSet.has(message.pathLabel)) continue;
        const existing = fieldMessagesByPath.get(message.pathLabel) ?? [];
        fieldMessagesByPath.set(message.pathLabel, [...existing, message]);
      }

      setSubmitValidationMessagesByPath(fieldMessagesByPath);

      const summaryMessage = validationMessagesFromResult(validation).find(
        (message) => !visibleFieldPathSet.has(message.pathLabel),
      );
      setSubmitError(summaryMessage?.message ?? "");
      return;
    }

    setBusy(true);
    setSubmitError("");
    setSubmitValidationMessagesByPath(new Map());

    try {
      const createdId = createRef.current(input);
      if (mutationRuntime) {
        await persistSyncedGraphChanges(mutationRuntime);
      }
      onCreatedRef.current(createdId);
    } catch (error) {
      setSubmitValidationMessagesByPath(new Map());
      setSubmitError(describeCreateError(error) ?? "Create failed.");
    } finally {
      setBusy(false);
    }
  }

  const actionState = {
    busy,
    submit: handleCreate,
    submitLabel,
    supported: createPlan.supported,
  } satisfies CreateEntitySurfaceActionState;

  return (
    <div className="space-y-4" data-entity-surface="create-body">
      {createPlan.supported ? (
        <EntitySurfaceFieldSections
          chrome={false}
          emptyMessage="No client-writable fields."
          hideMissingStatus
          mode="edit"
          mutationRuntime={mutationRuntime}
          renderEditor={renderEditor}
          sections={fieldSections}
          validationMessagesByPath={submitValidationMessagesByPath}
        />
      ) : (
        <Empty className="border-border bg-muted/20 flex-none p-4">
          <EmptyDescription className="text-sm">
            This type requires fields that cannot be set in the generic create surface.
          </EmptyDescription>
        </Empty>
      )}
      <ValidationSummary message={submitError} />
      {renderActions ? (
        renderActions(actionState)
      ) : (
        <div className="flex justify-end">
          <Button
            disabled={busy || !createPlan.supported}
            onClick={() => {
              void handleCreate();
            }}
            type="button"
          >
            {busy ? "Creating..." : submitLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

export function CreateEntitySurface(
  props: Omit<Parameters<typeof CreateEntitySurfaceBody>[0], "renderActions">,
) {
  return <CreateEntitySurfaceBody {...props} />;
}
