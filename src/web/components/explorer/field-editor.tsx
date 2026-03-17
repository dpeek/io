import { fieldWritePolicy, isEntityType, typeId, type Store } from "@io/core/graph";
import {
  formatPredicateValue,
  performValidatedMutation,
  usePersistedMutationCallbacks,
  usePredicateField,
} from "@io/core/graph/react";
import {
  defaultWebFieldResolver,
  GraphIcon,
  PredicateFieldEditor,
  PredicateFieldView,
} from "@io/core/graph/react-dom";
import { Button } from "@io/web/button";
import { Input } from "@io/web/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@io/web/select";
import { cn } from "@io/web/utils";
import {
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { secretFieldPlaintextRequiredMessage } from "../../lib/secret-fields.js";
import {
  collectFieldValidationMessages,
  describePredicateValue,
  formatPredicateMetaSummary,
  formatTimestamp,
  getDefinitionDisplayLabel,
  getEntityLabel,
  getFieldLabel,
  getFirstObject,
  statusBadgeClass,
} from "./helpers.js";
import { iconTypeId } from "./model.js";
import type {
  AnyPredicateRef,
  ExplorerRuntime,
  FieldValidationMessage,
  MutableOptionalPredicateRef,
  MutationCallbacks,
  SubmitSecretFieldMutation,
  TypeCatalogEntry,
} from "./model.js";
import { ExplorerSyncContext } from "./sync.js";
import { Badge } from "./ui.js";

const unsetSelectValue = "__io_unset_select_value__";

export function useStoreSlotValue(
  store: Store,
  subjectId: string,
  predicateId: string,
): string | undefined {
  const hasSnapshotRef = useRef(false);
  const snapshotRef = useRef<string | undefined>(undefined);

  function readSnapshot(): string | undefined {
    const next = getFirstObject(store, subjectId, predicateId);
    if (hasSnapshotRef.current && snapshotRef.current === next) return snapshotRef.current;
    snapshotRef.current = next;
    hasSnapshotRef.current = true;
    return next;
  }

  return useSyncExternalStore(
    (listener) => store.subscribePredicateSlot(subjectId, predicateId, listener),
    readSnapshot,
    readSnapshot,
  );
}

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
      : status.tone === "present" || status.label === "unset" || shouldHideMissingStatus
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

export function PredicateRangeEditor({
  onMutationError,
  onMutationSuccess,
  options,
  predicate,
}: {
  onMutationError?: (error: unknown) => void;
  onMutationSuccess?: () => void;
  options: readonly TypeCatalogEntry[];
  predicate: MutableOptionalPredicateRef;
}) {
  const { value } = usePredicateField(predicate);
  const selectedId = typeof value === "string" ? value : "";
  const knownOptionIds = new Set(options.map((option) => option.id));

  function handleValueChange(nextValue: string): void {
    if (nextValue === unsetSelectValue) {
      performValidatedMutation(
        { onMutationError, onMutationSuccess },
        () => predicate.validateClear(),
        () => {
          predicate.clear();
          return true;
        },
      );
      return;
    }
    performValidatedMutation(
      { onMutationError, onMutationSuccess },
      () => predicate.validateSet(nextValue),
      () => {
        predicate.set(nextValue);
        return true;
      },
    );
  }

  return (
    <>
      <Select
        items={[
          { label: "Unset range", value: unsetSelectValue },
          ...(!knownOptionIds.has(selectedId) && selectedId.length > 0
            ? [{ label: "Unrecognized range", value: selectedId }]
            : []),
          ...options.map((option) => ({
            label: getDefinitionDisplayLabel(option.name, option.key),
            value: option.id,
          })),
        ]}
        onValueChange={(nextValue) => {
          if (typeof nextValue !== "string") {
            handleValueChange(unsetSelectValue);
            return;
          }
          handleValueChange(nextValue);
        }}
        value={selectedId.length > 0 ? selectedId : null}
      >
        <SelectTrigger
          aria-label="Predicate range"
          className="h-10 w-full justify-between"
          data-explorer-range-editor={predicate.subjectId}
        >
          <SelectValue placeholder="Unset range" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={unsetSelectValue}>Unset range</SelectItem>
          {!knownOptionIds.has(selectedId) && selectedId.length > 0 ? (
            <SelectItem data-web-select-item-value={selectedId} value={selectedId}>
              Unrecognized range
            </SelectItem>
          ) : null}
          {options.map((option) => (
            <SelectItem data-web-select-item-value={option.id} key={option.id} value={option.id}>
              {getDefinitionDisplayLabel(option.name, option.key)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <select
        aria-hidden="true"
        className="sr-only"
        data-explorer-range-editor={predicate.subjectId}
        onChange={(event) => {
          handleValueChange(event.target.value);
        }}
        tabIndex={-1}
        value={selectedId}
      >
        <option value={unsetSelectValue}>Unset range</option>
        {!knownOptionIds.has(selectedId) && selectedId.length > 0 ? (
          <option value={selectedId}>Unrecognized range</option>
        ) : null}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {getDefinitionDisplayLabel(option.name, option.key)}
          </option>
        ))}
      </select>
    </>
  );
}

export function SecretFieldEditor({
  callbacks,
  predicate,
  runtime,
  submitSecretField,
}: {
  callbacks: MutationCallbacks;
  predicate: AnyPredicateRef;
  runtime: ExplorerRuntime;
  submitSecretField: SubmitSecretFieldMutation;
}) {
  const { value } = usePredicateField(predicate);
  const secretId = typeof value === "string" ? value : undefined;
  const secret = secretId ? runtime.graph.secretHandle.get(secretId) : undefined;
  const [plaintext, setPlaintext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    setPlaintext("");
    setBusy(false);
    setError("");
    setStatus("");
  }, [predicate.predicateId, predicate.subjectId]);

  async function handleSubmit(): Promise<void> {
    const nextPlaintext = plaintext.trim();
    if (!nextPlaintext) {
      const nextError = secretFieldPlaintextRequiredMessage;
      setError(nextError);
      setStatus("");
      callbacks.onMutationError?.(new Error(nextError));
      return;
    }

    setBusy(true);
    setError("");
    setStatus("");

    try {
      const result = await submitSecretField({
        entityId: predicate.subjectId,
        predicateId: predicate.predicateId,
        plaintext: nextPlaintext,
      });
      await runtime.sync.sync();
      callbacks.onMutationSuccess?.();
      setPlaintext("");
      setStatus(
        result.created ? "Secret set." : result.rotated ? "Secret rotated." : "Secret confirmed.",
      );
    } catch (submitError) {
      const nextError = submitError instanceof Error ? submitError.message : String(submitError);
      setError(nextError);
      callbacks.onMutationError?.(
        submitError instanceof Error ? submitError : new Error(nextError),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" data-explorer-secret-field={predicate.predicateId}>
      <div className="grid gap-3 text-sm text-slate-300">
        <div className="flex items-center justify-between gap-3">
          <span>Secret status</span>
          <span data-explorer-secret-status={predicate.predicateId}>
            {secretId ? "Present" : "Missing"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Secret version</span>
          <span data-explorer-secret-version={predicate.predicateId}>
            {secret?.version === undefined ? "Not set" : `v${secret.version}`}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Last rotated</span>
          <span data-explorer-secret-last-rotated={predicate.predicateId}>
            {formatTimestamp(secret?.lastRotatedAt)}
          </span>
        </div>
      </div>

      <label className="grid gap-2">
        <span className="text-sm font-medium text-slate-100">
          {secretId ? "Rotate secret" : "Set secret"}
        </span>
        <Input
          data-explorer-secret-input={predicate.predicateId}
          onChange={(event) => {
            setPlaintext(event.target.value);
          }}
          placeholder={secretId ? "Paste a new plaintext value" : "Paste the plaintext value once"}
          type="password"
          value={plaintext}
        />
      </label>

      {error ? (
        <div
          className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100"
          data-explorer-secret-error={predicate.predicateId}
        >
          {error}
        </div>
      ) : null}

      {status ? (
        <div
          className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100"
          data-explorer-secret-result={predicate.predicateId}
        >
          {status}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          data-explorer-secret-submit={predicate.predicateId}
          disabled={busy}
          onClick={() => {
            void handleSubmit();
          }}
          type="button"
        >
          {busy ? "Saving..." : secretId ? "Rotate secret" : "Save secret"}
        </Button>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3 text-xs text-slate-400">
        Plaintext stays authority-only. The synced graph only carries the opaque handle, version,
        and rotation metadata.
      </div>
    </div>
  );
}
