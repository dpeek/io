import {
  formatPredicateEditorValue,
  getPredicateEditorParser,
  getPredicateEditorPlaceholder,
  performValidatedMutation,
  usePredicateField,
  type PredicateFieldViewCapability,
} from "@io/graph-react";
import { ColorInput } from "@io/web/color";
import { InputGroup, InputGroupAddon } from "@io/web/input-group";
import { useEffect, useState } from "react";

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

function ColorSwatch({ color }: { color: string }) {
  return (
    <span className="border-border relative size-3.5 overflow-hidden rounded-[calc(var(--radius-sm)-2px)] border">
      <span aria-hidden="true" className="absolute inset-0" style={{ backgroundColor: color }} />
    </span>
  );
}

function ColorFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  const placeholder = getPredicateEditorPlaceholder(predicate.field) ?? "#2563eb";
  const parser = getPredicateEditorParser(predicate.field);
  const committedValue = formatPredicateEditorValue(predicate.field, value);
  const normalizedValue = getNormalizedColorValue(parser, committedValue, placeholder);
  const pickerColor = toPickerColor(normalizedValue);
  const displayValue =
    committedValue.trim().length > 0 ? committedValue.toUpperCase() : placeholder.toUpperCase();

  return (
    <div data-web-field-kind="color">
      <InputGroup className="w-full">
        <InputGroupAddon align="inline-start">
          <span
            className="flex items-center justify-center"
            data-web-color-swatch={normalizedValue}
          >
            <ColorSwatch color={pickerColor} />
          </span>
        </InputGroupAddon>
        <div className="flex min-w-0 flex-1 items-center px-1.5 text-sm font-medium uppercase">
          <span
            className={
              committedValue.trim().length > 0 ? "truncate" : "text-muted-foreground truncate"
            }
            data-web-color-display-value=""
          >
            {displayValue}
          </span>
        </div>
      </InputGroup>
    </div>
  );
}

export const colorFieldViewCapability = {
  kind: "color",
  Component: ColorFieldView,
} satisfies PredicateFieldViewCapability<any, any>;

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
