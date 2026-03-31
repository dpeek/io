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
} from "@io/graph-react";
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
  clearOrRejectRequiredValue,
  DefaultFieldRow,
  getFieldState,
  getPredicateFieldLabel,
  setPredicateValue,
  useFieldMutationCallbacks,
  validatePredicateValue,
  type AnyRenderableFieldProps,
} from "./shared.js";

export function TextFieldEditor(props: AnyRenderableFieldProps) {
  const { controller, issues, mode, onMutationError, onMutationSuccess, predicate } = props;
  const callbacks = useFieldMutationCallbacks({ onMutationError, onMutationSuccess });
  const { value } = usePredicateField(predicate);
  const state = getFieldState({
    controller,
    issues,
    mode,
    onMutationError,
    onMutationSuccess,
    predicate,
  });
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
  const [localError, setLocalError] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(!isOptionalTextEditor || committedValue !== "");
  const [shouldAutoFocus, setShouldAutoFocus] = useState(false);
  const invalid = state.invalid || localError !== null;

  useEffect(() => {
    setDraft(committedValue);
    setLocalError(null);
    if (isOptionalTextEditor) {
      setShowEditor(committedValue !== "");
      setShouldAutoFocus(false);
    }
  }, [committedValue, isOptionalTextEditor]);

  function applyDraft(nextValue: string): void {
    controller?.setTouched(true);
    setDraft(nextValue);

    if (isOptionalTextEditor && nextValue === "") {
      setLocalError(null);
      return;
    }

    if (nextValue === "" && parser) {
      const cleared = clearOrRejectRequiredValue(predicate, callbacks);
      setLocalError(cleared ? null : "Enter a valid value.");
      return;
    }

    try {
      const parsedValue = parser ? parser(nextValue) : nextValue;
      const committed = performValidatedMutation(
        callbacks,
        () => validatePredicateValue(predicate, parsedValue),
        () => setPredicateValue(predicate, parsedValue),
      );
      setLocalError(committed ? null : "Enter a valid value.");
    } catch {
      setLocalError("Enter a valid value.");
    }
  }

  function handleShowEditor(): void {
    controller?.setTouched(true);
    setShouldAutoFocus(true);
    setShowEditor(true);
    setDraft(committedValue);
    setLocalError(null);
  }

  function handleClear(): void {
    controller?.setTouched(true);
    const cleared = clearOrRejectRequiredValue(predicate, callbacks);
    setLocalError(cleared ? null : "Enter a valid value.");
    if (!cleared) return;
    setDraft("");
    setShowEditor(false);
    setShouldAutoFocus(false);
  }

  function handleBlur(): void {
    controller?.setTouched(true);
    if (!isOptionalTextEditor || draft !== "") return;

    const cleared = clearOrRejectRequiredValue(predicate, callbacks);
    setLocalError(cleared ? null : "Enter a valid value.");
    if (!cleared) return;
    setShowEditor(false);
    setShouldAutoFocus(false);
  }

  const control =
    isOptionalTextEditor && !showEditor ? (
      <InputGroupButton
        aria-label={`Add ${fieldLabel}`}
        data-web-text-field-expand={predicate.field.key}
        onClick={handleShowEditor}
        size="icon-xs"
        variant="ghost"
      >
        <PlusIcon className="size-3" />
      </InputGroupButton>
    ) : isTextarea ? (
      <InputGroup className="h-auto" data-web-text-field-state="expanded">
        <InputGroupTextarea
          aria-invalid={invalid || undefined}
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
    ) : (
      <InputGroup data-web-text-field-state="expanded">
        <InputGroupInput
          aria-invalid={invalid || undefined}
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
  const fieldErrors = localError ? [...state.issues, { message: localError }] : [...state.issues];

  if (mode !== "field") {
    return control;
  }

  return (
    <DefaultFieldRow
      fieldKind={editorKind === "textarea" ? "textarea" : "text"}
      state={{ ...state, invalid, issues: fieldErrors }}
    >
      {control}
    </DefaultFieldRow>
  );
}
