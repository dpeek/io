import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupTextarea,
} from "@io/web/input-group";
import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import {
  formatPredicateEditorValue,
  getPredicateEditorAutocomplete,
  getPredicateEditorInputMode,
  getPredicateEditorInputType,
  getPredicateEditorKind,
  getPredicateEditorParser,
  getPredicateEditorPlaceholder,
  performValidatedMutation,
  usePredicateField,
} from "../../../runtime/react/index.js";
import {
  clearOrRejectRequiredValue,
  getPredicateFieldLabel,
  setPredicateValue,
  useFieldMutationCallbacks,
  validatePredicateValue,
  type AnyFieldProps,
} from "./shared.js";

export function TextFieldEditor({ onMutationError, onMutationSuccess, predicate }: AnyFieldProps) {
  const callbacks = useFieldMutationCallbacks({ onMutationError, onMutationSuccess });
  const { value } = usePredicateField(predicate);
  const editorKind = getPredicateEditorKind(predicate.field);
  const placeholder = getPredicateEditorPlaceholder(predicate.field);
  const parser = getPredicateEditorParser(predicate.field);
  const inputType = getPredicateEditorInputType(predicate.field) ?? "text";
  const inputMode = getPredicateEditorInputMode(predicate.field);
  const autoComplete = getPredicateEditorAutocomplete(predicate.field);
  const fieldLabel = getPredicateFieldLabel(predicate);
  const committedValue = formatPredicateEditorValue(predicate.field, value);
  const isTextarea = editorKind === "textarea";
  const isOptionalTextEditor = predicate.field.cardinality === "one?";
  const [draft, setDraft] = useState(committedValue);
  const [isInvalid, setIsInvalid] = useState(false);
  const [showEditor, setShowEditor] = useState(!isOptionalTextEditor || committedValue !== "");
  const [shouldAutoFocus, setShouldAutoFocus] = useState(false);

  useEffect(() => {
    setDraft(committedValue);
    setIsInvalid(false);
    if (isOptionalTextEditor) {
      setShowEditor(committedValue !== "");
      setShouldAutoFocus(false);
    }
  }, [committedValue, isOptionalTextEditor]);

  function applyDraft(nextValue: string): void {
    setDraft(nextValue);

    if (isOptionalTextEditor && nextValue === "") {
      setIsInvalid(false);
      return;
    }

    if (nextValue === "" && parser) {
      const cleared = clearOrRejectRequiredValue(predicate, callbacks);
      setIsInvalid(!cleared);
      return;
    }

    try {
      const parsedValue = parser ? parser(nextValue) : nextValue;
      const committed = performValidatedMutation(
        callbacks,
        () => validatePredicateValue(predicate, parsedValue),
        () => setPredicateValue(predicate, parsedValue),
      );
      setIsInvalid(!committed);
    } catch {
      setIsInvalid(true);
    }
  }

  function handleShowEditor(): void {
    setShouldAutoFocus(true);
    setShowEditor(true);
    setDraft(committedValue);
    setIsInvalid(false);
  }

  function handleClear(): void {
    const cleared = clearOrRejectRequiredValue(predicate, callbacks);
    setIsInvalid(!cleared);
    if (!cleared) return;
    setDraft("");
    setShowEditor(false);
    setShouldAutoFocus(false);
  }

  function handleBlur(): void {
    if (!isOptionalTextEditor || draft !== "") return;

    const cleared = clearOrRejectRequiredValue(predicate, callbacks);
    setIsInvalid(!cleared);
    if (!cleared) return;
    setShowEditor(false);
    setShouldAutoFocus(false);
  }

  if (isOptionalTextEditor && !showEditor) {
    return (
      <InputGroupButton
        aria-label={`Add ${fieldLabel}`}
        data-web-text-field-expand={predicate.field.key}
        onClick={handleShowEditor}
        size="icon-xs"
        variant="ghost"
      >
        <PlusIcon className="size-3" />
      </InputGroupButton>
    );
  }

  if (isTextarea) {
    return (
      <InputGroup className="h-auto" data-web-text-field-state="expanded">
        <InputGroupTextarea
          aria-invalid={isInvalid || undefined}
          autoFocus={shouldAutoFocus}
          className="min-h-28 resize-y"
          data-web-field-kind="textarea"
          onBlur={handleBlur}
          onChange={(event) => applyDraft(event.target.value)}
          placeholder={placeholder}
          value={draft}
        />
        {isOptionalTextEditor ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              aria-label={`Clear ${fieldLabel}`}
              data-web-text-field-clear={predicate.field.key}
              onClick={handleClear}
              size="icon-xs"
              variant="ghost"
            >
              <XIcon className="size-3" />
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    );
  }

  return (
    <InputGroup data-web-text-field-state="expanded">
      <InputGroupInput
        aria-invalid={isInvalid || undefined}
        autoComplete={autoComplete}
        autoFocus={shouldAutoFocus}
        data-web-field-kind="text"
        inputMode={inputMode}
        onBlur={handleBlur}
        onChange={(event) => applyDraft(event.target.value)}
        placeholder={placeholder}
        type={inputType}
        value={draft}
      />
      {isOptionalTextEditor ? (
        <InputGroupButton
          aria-label={`Clear ${fieldLabel}`}
          data-web-text-field-clear={predicate.field.key}
          onClick={handleClear}
          size="icon-xs"
          variant="ghost"
        >
          <XIcon className="size-3" />
        </InputGroupButton>
      ) : null}
    </InputGroup>
  );
}
