import { useEffect, useRef, useState } from "react";

import { GraphValidationError, type GraphMutationValidationResult } from "../graph/client.js";
import type { PredicateRef } from "../graph/client.js";
import { isEnumType } from "../graph/schema.js";
import {
  performValidatedMutation,
  type MutationCallbacks,
  type MutationValidation,
} from "./mutation-validation.js";
import {
  formatPredicateEditorValue,
  formatPredicateValue,
  getPredicateEditorAutocomplete,
  getPredicateEditorInputMode,
  getPredicateEditorInputType,
  getPredicateEditorKind,
  getPredicateEditorParser,
  getPredicateEditorPlaceholder,
  getPredicateEntityReferenceOptions,
  getPredicateEntityReferenceSelection,
  getPredicateEnumOptions,
  usePredicateField,
} from "./predicate.js";
import type {
  PredicateFieldEditorCapability,
  PredicateFieldProps,
  PredicateFieldViewCapability,
} from "./resolver.js";

type AnyPredicate = PredicateRef<any, any>;
type AnyFieldProps = PredicateFieldProps<any, any>;

function setPredicateValue(predicate: AnyPredicate, value: unknown): boolean {
  if (typeof (predicate as { set?: unknown }).set !== "function") return false;
  (predicate as { set(nextValue: unknown): void }).set(value);
  return true;
}

function clearPredicateValue(predicate: AnyPredicate): boolean {
  if (typeof (predicate as { clear?: unknown }).clear !== "function") return false;
  (predicate as { clear(): void }).clear();
  return true;
}

function addPredicateItem(predicate: AnyPredicate, value: unknown): boolean {
  if (typeof (predicate as { add?: unknown }).add !== "function") return false;
  (predicate as { add(nextValue: unknown): void }).add(value);
  return true;
}

function removePredicateItem(predicate: AnyPredicate, value: unknown): boolean {
  if (typeof (predicate as { remove?: unknown }).remove !== "function") return false;
  (predicate as { remove(nextValue: unknown): void }).remove(value);
  return true;
}

function validatePredicateValue(predicate: AnyPredicate, value: unknown): MutationValidation {
  if (typeof (predicate as { validateSet?: unknown }).validateSet !== "function") return false;
  return (predicate as { validateSet(nextValue: unknown): GraphMutationValidationResult }).validateSet(
    value,
  );
}

function validatePredicateClear(predicate: AnyPredicate): MutationValidation {
  if (typeof (predicate as { validateClear?: unknown }).validateClear !== "function") return false;
  return (predicate as { validateClear(): GraphMutationValidationResult }).validateClear();
}

function validatePredicateAdd(predicate: AnyPredicate, value: unknown): MutationValidation {
  if (typeof (predicate as { validateAdd?: unknown }).validateAdd !== "function") return false;
  return (predicate as { validateAdd(nextValue: unknown): GraphMutationValidationResult }).validateAdd(
    value,
  );
}

function validatePredicateRemove(predicate: AnyPredicate, value: unknown): MutationValidation {
  if (typeof (predicate as { validateRemove?: unknown }).validateRemove !== "function") return false;
  return (predicate as {
    validateRemove(nextValue: unknown): GraphMutationValidationResult;
  }).validateRemove(value);
}

function clearOrRejectRequiredValue(
  predicate: AnyPredicate,
  callbacks: MutationCallbacks,
): boolean {
  if (predicate.field.cardinality === "one?") {
    return performValidatedMutation(
      callbacks,
      () => validatePredicateClear(predicate),
      () => clearPredicateValue(predicate),
    );
  }

  const validation = validatePredicateValue(predicate, undefined);
  if (validation !== false && !validation.ok) {
    callbacks.onMutationError?.(new GraphValidationError(validation));
  }
  return false;
}

function normalizeTextValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return String(value);
}

function normalizeNumberValue(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (value === undefined) return "";
  return String(value);
}

function normalizeUrlValue(value: unknown): string {
  if (value instanceof URL) return value.toString();
  if (value === undefined) return "";
  return String(value);
}

function normalizeDateValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return "";
  return String(value);
}

function BooleanFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);

  if (Array.isArray(value)) {
    return <span data-web-field-status="unsupported">unsupported-display-kind:boolean</span>;
  }

  return (
    <input
      aria-label={formatPredicateValue(predicate, value)}
      checked={value === true}
      data-web-field-kind="boolean"
      disabled
      readOnly
      type="checkbox"
    />
  );
}

function TextFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  return <span data-web-field-kind="text">{formatPredicateValue(predicate, value)}</span>;
}

function NumberFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  return <span data-web-field-kind="number">{formatPredicateValue(predicate, value)}</span>;
}

function DateFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  if (!(value instanceof Date)) {
    return <span data-web-field-kind="date">{formatPredicateValue(predicate, value)}</span>;
  }

  const formatted = formatPredicateValue(predicate, value);
  return (
    <time data-web-field-kind="date" dateTime={value.toISOString()}>
      {formatted}
    </time>
  );
}

function LinkFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  if (!(value instanceof URL)) {
    return <span data-web-field-kind="link">{formatPredicateValue(predicate, value)}</span>;
  }

  const href = value.toString();
  return (
    <a data-web-field-kind="link" href={href}>
      {formatPredicateValue(predicate, value)}
    </a>
  );
}

function ExternalLinkFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  if (!(value instanceof URL)) {
    return (
      <span data-web-field-kind="external-link">{formatPredicateValue(predicate, value)}</span>
    );
  }

  const href = value.toString();
  return (
    <a data-web-field-kind="external-link" href={href} rel="noreferrer" target="_blank">
      {formatPredicateValue(predicate, value)}
    </a>
  );
}

function BadgeFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  return <span data-web-field-kind="badge">{formatPredicateValue(predicate, value)}</span>;
}

function getEntityReferenceLabel(entity: { id: string; get(): Record<string, unknown> }): string {
  const snapshot = entity.get();
  const name = snapshot.name;
  if (typeof name === "string" && name.length > 0) return name;
  const label = snapshot.label;
  if (typeof label === "string" && label.length > 0) return label;
  return entity.id;
}

function EntityReferenceSummary({
  entity,
}: {
  entity: { id: string; get(): Record<string, unknown> };
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span>{getEntityReferenceLabel(entity)}</span>
      <code>{entity.id}</code>
    </span>
  );
}

function EntityReferenceListView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  const references = getPredicateEntityReferenceSelection(predicate, value);

  return (
    <ul data-web-field-kind="entity-reference-list">
      {references.map(({ entity, id }) => (
        <li data-web-reference-id={id} key={id}>
          <EntityReferenceSummary entity={entity} />
        </li>
      ))}
    </ul>
  );
}

function TextFieldEditor({ onMutationError, onMutationSuccess, predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  const editorKind = getPredicateEditorKind(predicate.field);
  const placeholder = getPredicateEditorPlaceholder(predicate.field);
  const parser = getPredicateEditorParser(predicate.field);
  const inputType = getPredicateEditorInputType(predicate.field) ?? "text";
  const inputMode = getPredicateEditorInputMode(predicate.field);
  const autoComplete = getPredicateEditorAutocomplete(predicate.field);
  const committedValue = formatPredicateEditorValue(predicate.field, value);
  const [draft, setDraft] = useState(committedValue);
  const [isInvalid, setIsInvalid] = useState(false);

  useEffect(() => {
    setDraft(committedValue);
    setIsInvalid(false);
  }, [committedValue]);

  function applyDraft(nextValue: string): void {
    setDraft(nextValue);

    if (nextValue === "" && parser) {
      const cleared = clearOrRejectRequiredValue(predicate, {
        onMutationError,
        onMutationSuccess,
      });
      setIsInvalid(!cleared);
      return;
    }

    try {
      const parsedValue = parser ? parser(nextValue) : nextValue;
      const committed = performValidatedMutation(
        { onMutationError, onMutationSuccess },
        () => validatePredicateValue(predicate, parsedValue),
        () => setPredicateValue(predicate, parsedValue),
      );
      setIsInvalid(!committed);
    } catch {
      setIsInvalid(true);
    }
  }

  if (editorKind === "textarea") {
    return (
      <textarea
        aria-invalid={isInvalid || undefined}
        data-web-field-kind="textarea"
        onChange={(event) => applyDraft(event.target.value)}
        placeholder={placeholder}
        value={draft}
      />
    );
  }

  return (
    <input
      aria-invalid={isInvalid || undefined}
      autoComplete={autoComplete}
      data-web-field-kind="text"
      inputMode={inputMode}
      onChange={(event) => applyDraft(event.target.value)}
      placeholder={placeholder}
      type={inputType}
      value={draft}
    />
  );
}

function NumberFieldEditor({ onMutationError, onMutationSuccess, predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  const committedValue = normalizeNumberValue(value);
  const [draft, setDraft] = useState(committedValue);
  const [isInvalid, setIsInvalid] = useState(false);

  useEffect(() => {
    setDraft(committedValue);
    setIsInvalid(false);
  }, [committedValue]);

  return (
    <input
      aria-invalid={isInvalid || undefined}
      data-web-field-kind="number"
      inputMode="numeric"
      onChange={(event) => {
        const nextValue = event.target.value;
        setDraft(nextValue);

        if (nextValue === "") {
          const cleared = clearOrRejectRequiredValue(predicate, {
            onMutationError,
            onMutationSuccess,
          });
          setIsInvalid(!cleared);
          return;
        }

        const parsed = Number(nextValue);
        const committed = performValidatedMutation(
          { onMutationError, onMutationSuccess },
          () => validatePredicateValue(predicate, parsed),
          () => setPredicateValue(predicate, parsed),
        );
        setIsInvalid(!committed);
      }}
      type="number"
      value={draft}
    />
  );
}

function UrlFieldEditor({ onMutationError, onMutationSuccess, predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  const placeholder = getPredicateEditorPlaceholder(predicate.field);
  const committedValue = normalizeUrlValue(value);
  const [draft, setDraft] = useState(committedValue);
  const [isInvalid, setIsInvalid] = useState(false);

  useEffect(() => {
    setDraft(committedValue);
    setIsInvalid(false);
  }, [committedValue]);

  return (
    <input
      aria-invalid={isInvalid || undefined}
      data-web-field-kind="url"
      onChange={(event) => {
        const nextValue = event.target.value;
        setDraft(nextValue);

        if (nextValue === "") {
          const cleared = clearOrRejectRequiredValue(predicate, {
            onMutationError,
            onMutationSuccess,
          });
          setIsInvalid(!cleared);
          return;
        }

        try {
          const nextUrl = new URL(nextValue);
          const committed = performValidatedMutation(
            { onMutationError, onMutationSuccess },
            () => validatePredicateValue(predicate, nextUrl),
            () => setPredicateValue(predicate, nextUrl),
          );
          setIsInvalid(!committed);
        } catch {
          setIsInvalid(true);
        }
      }}
      placeholder={placeholder}
      type="url"
      value={draft}
    />
  );
}

function DateFieldEditor({ onMutationError, onMutationSuccess, predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  const placeholder = getPredicateEditorPlaceholder(predicate.field);
  const committedValue = normalizeDateValue(value);
  const [draft, setDraft] = useState(committedValue);
  const [isInvalid, setIsInvalid] = useState(false);

  useEffect(() => {
    setDraft(committedValue);
    setIsInvalid(false);
  }, [committedValue]);

  return (
    <input
      aria-invalid={isInvalid || undefined}
      data-web-field-kind="date"
      onChange={(event) => {
        const nextValue = event.target.value;
        setDraft(nextValue);

        if (nextValue === "") {
          const cleared = clearOrRejectRequiredValue(predicate, {
            onMutationError,
            onMutationSuccess,
          });
          setIsInvalid(!cleared);
          return;
        }

        const parsed = new Date(nextValue);
        if (Number.isNaN(parsed.getTime())) {
          setIsInvalid(true);
          return;
        }

        const committed = performValidatedMutation(
          { onMutationError, onMutationSuccess },
          () => validatePredicateValue(predicate, parsed),
          () => setPredicateValue(predicate, parsed),
        );
        setIsInvalid(!committed);
      }}
      placeholder={placeholder}
      type="text"
      value={draft}
    />
  );
}

function CheckboxFieldEditor({ onMutationError, onMutationSuccess, predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);

  if (Array.isArray(value)) {
    return <span data-web-field-status="unsupported">unsupported-editor-kind:checkbox</span>;
  }

  return (
    <input
      checked={value === true}
      data-web-field-kind="checkbox"
      onChange={(event) => {
        performValidatedMutation(
          { onMutationError, onMutationSuccess },
          () => validatePredicateValue(predicate, event.target.checked),
          () => setPredicateValue(predicate, event.target.checked),
        );
      }}
      type="checkbox"
    />
  );
}

function SelectFieldEditor({ onMutationError, onMutationSuccess, predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  const options = getPredicateEnumOptions(predicate);
  const valueId = typeof value === "string" ? value : "";
  const isOptional = predicate.field.cardinality === "one?";
  const isEnum = predicate.rangeType ? isEnumType(predicate.rangeType) : false;

  if (!isEnum) {
    return <span data-web-field-status="unsupported">unsupported-editor-kind:select</span>;
  }

  return (
    <select
      data-web-field-kind="select"
      onChange={(event) => {
        const nextValue = event.target.value;
        if (nextValue === "") {
          clearOrRejectRequiredValue(predicate, {
            onMutationError,
            onMutationSuccess,
          });
          return;
        }
        performValidatedMutation(
          { onMutationError, onMutationSuccess },
          () => validatePredicateValue(predicate, nextValue),
          () => setPredicateValue(predicate, nextValue),
        );
      }}
      value={valueId}
    >
      {isOptional ? <option value="">Select an option</option> : null}
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function TokenListFieldEditor({ onMutationError, onMutationSuccess, predicate }: AnyFieldProps) {
  const { collectionKind, value } = usePredicateField(predicate);
  const placeholder = getPredicateEditorPlaceholder(predicate.field);
  const [draft, setDraft] = useState("");
  const draftRef = useRef(draft);

  if (!Array.isArray(value) || collectionKind !== "unordered") {
    return <span data-web-field-status="unsupported">unsupported-editor-kind:token-list</span>;
  }

  const tokens = value.map((item) => normalizeTextValue(item)).filter((item) => item.length > 0);

  function commitDraft(): void {
    const nextToken = draftRef.current.trim();
    if (!nextToken) return;
    const committed = performValidatedMutation(
      { onMutationError, onMutationSuccess },
      () => validatePredicateAdd(predicate, nextToken),
      () => addPredicateItem(predicate, nextToken),
    );
    if (!committed) return;
    draftRef.current = "";
    setDraft("");
  }

  return (
    <div data-web-field-kind="token-list">
      <div data-web-field-tokens="">
        {tokens.map((token) => (
          <button
            data-proof-mutation="collection"
            data-web-field-action="remove-token"
            data-web-token-value={token}
            key={token}
            onClick={() => {
              performValidatedMutation(
                { onMutationError, onMutationSuccess },
                () => validatePredicateRemove(predicate, token),
                () => removePredicateItem(predicate, token),
              );
            }}
            type="button"
          >
            {token}
          </button>
        ))}
      </div>
      <div>
        <input
          data-web-field-kind="token-list-input"
          onChange={(event) => {
            draftRef.current = event.target.value;
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commitDraft();
          }}
          placeholder={placeholder}
          type="text"
          value={draft}
        />
        <button
          data-proof-mutation="collection"
          data-web-field-action="add-token"
          onClick={() => {
            commitDraft();
          }}
          type="button"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function EntityReferenceChecklistEditor({
  onMutationError,
  onMutationSuccess,
  predicate,
}: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  const options = getPredicateEntityReferenceOptions(predicate);
  const selected = getPredicateEntityReferenceSelection(predicate, value);
  const selectedIds = new Set(selected.map((option) => option.id));

  if (predicate.field.cardinality !== "many") {
    return (
      <span data-web-field-status="unsupported">
        unsupported-editor-kind:entity-reference-checklist
      </span>
    );
  }

  return (
    <div data-web-field-kind="entity-reference-checklist">
      <ul data-web-reference-selected="">
        {selected.map(({ entity, id }) => (
          <li data-web-reference-selected-id={id} key={id}>
            <EntityReferenceSummary entity={entity} />
            <button
              data-proof-mutation="entity-reference"
              data-web-field-action="remove-reference"
              data-web-reference-remove-id={id}
              onClick={() => {
                performValidatedMutation(
                  { onMutationError, onMutationSuccess },
                  () => validatePredicateRemove(predicate, id),
                  () => removePredicateItem(predicate, id),
                );
              }}
              type="button"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div data-web-reference-options="">
        {options.map(({ entity, id }) => {
          const checked = selectedIds.has(id);
          return (
            <label data-web-reference-option-id={id} key={id}>
              <input
                checked={checked}
                onChange={(event) => {
                  if (event.target.checked) {
                    if (!checked) {
                      performValidatedMutation(
                        { onMutationError, onMutationSuccess },
                        () => validatePredicateAdd(predicate, id),
                        () => addPredicateItem(predicate, id),
                      );
                    }
                    return;
                  }
                  performValidatedMutation(
                    { onMutationError, onMutationSuccess },
                    () => validatePredicateRemove(predicate, id),
                    () => removePredicateItem(predicate, id),
                  );
                }}
                type="checkbox"
              />
              <EntityReferenceSummary entity={entity} />
            </label>
          );
        })}
      </div>
    </div>
  );
}
export const genericWebFieldViewCapabilities = [
  { kind: "boolean", Component: BooleanFieldView },
  { kind: "text", Component: TextFieldView },
  { kind: "date", Component: DateFieldView },
  { kind: "number", Component: NumberFieldView },
  { kind: "link", Component: LinkFieldView },
  { kind: "external-link", Component: ExternalLinkFieldView },
  { kind: "badge", Component: BadgeFieldView },
  { kind: "entity-reference-list", Component: EntityReferenceListView },
] satisfies readonly PredicateFieldViewCapability<any, any>[];

export const genericWebFieldEditorCapabilities = [
  { kind: "checkbox", Component: CheckboxFieldEditor },
  { kind: "text", Component: TextFieldEditor },
  { kind: "textarea", Component: TextFieldEditor },
  { kind: "date", Component: DateFieldEditor },
  { kind: "number", Component: NumberFieldEditor },
  { kind: "url", Component: UrlFieldEditor },
  { kind: "select", Component: SelectFieldEditor },
  { kind: "token-list", Component: TokenListFieldEditor },
  { kind: "entity-reference-checklist", Component: EntityReferenceChecklistEditor },
] satisfies readonly PredicateFieldEditorCapability<any, any>[];
