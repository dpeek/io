import { ColorInput } from "@io/web/color";
import { useEffect, useState } from "react";

import {
  formatPredicateEditorValue,
  getPredicateEditorParser,
  getPredicateEditorPlaceholder,
  performValidatedMutation,
  usePredicateField,
} from "../../../runtime/react/index.js";
import {
  clearOrRejectRequiredValue,
  getPredicateFieldLabel,
  getNormalizedColorValue,
  setPredicateValue,
  useFieldMutationCallbacks,
  validatePredicateValue,
  type AnyFieldProps,
} from "./shared.js";

function toPickerColor(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("#")) return "#2563eb";

  let hex = trimmed.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split("")
      .map((part) => `${part}${part}`)
      .join("");
  }
  if (hex.length === 8) {
    hex = hex.slice(0, 6);
  }

  return hex.length === 6 ? `#${hex}` : "#2563eb";
}

export function ColorFieldEditor({ onMutationError, onMutationSuccess, predicate }: AnyFieldProps) {
  const callbacks = useFieldMutationCallbacks({ onMutationError, onMutationSuccess });
  const { value } = usePredicateField(predicate);
  const placeholder = getPredicateEditorPlaceholder(predicate.field) ?? "#2563eb";
  const parser = getPredicateEditorParser(predicate.field);
  const fieldLabel = getPredicateFieldLabel(predicate);
  const committedValue = formatPredicateEditorValue(predicate.field, value);
  const [draft, setDraft] = useState(committedValue);
  const [isInvalid, setIsInvalid] = useState(false);

  useEffect(() => {
    setDraft(committedValue);
    setIsInvalid(false);
  }, [committedValue]);

  function applyDraft(nextValue: string): void {
    setDraft(nextValue);

    if (nextValue === "") {
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

  const pickerColor = toPickerColor(
    getNormalizedColorValue(parser, draft, committedValue, placeholder),
  );

  return (
    <div data-web-field-kind="color">
      <ColorInput
        ariaLabel={fieldLabel}
        className="mt-0"
        error={isInvalid ? "Enter a valid color" : undefined}
        hideInputValidation
        onBlur={() => undefined}
        onChange={applyDraft}
        pickerValue={pickerColor}
        placeholder={placeholder}
        value={draft}
      />
    </div>
  );
}
