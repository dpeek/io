import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@io/web/input-group";
import { useEffect, useState } from "react";

import {
  formatPredicateEditorValue,
  getPredicateEditorPlaceholder,
  performValidatedMutation,
  usePredicateField,
} from "../../../runtime/react/index.js";
import {
  createFormattedFieldViewCapability,
  clearOrRejectRequiredValue,
  setPredicateValue,
  useFieldMutationCallbacks,
  validatePredicateValue,
  type AnyFieldProps,
} from "./shared.js";

export const percentFieldViewCapability = createFormattedFieldViewCapability("number/percent");

export function PercentFieldEditor({
  onMutationError,
  onMutationSuccess,
  predicate,
}: AnyFieldProps) {
  const callbacks = useFieldMutationCallbacks({ onMutationError, onMutationSuccess });
  const { value } = usePredicateField(predicate);
  const placeholder = getPredicateEditorPlaceholder(predicate.field);
  const committedValue = formatPredicateEditorValue(predicate.field, value);
  const [draft, setDraft] = useState(committedValue);
  const [isInvalid, setIsInvalid] = useState(false);

  useEffect(() => {
    setDraft(committedValue);
    setIsInvalid(false);
  }, [committedValue]);

  return (
    <InputGroup data-web-field-kind="number/percent">
      <InputGroupInput
        aria-invalid={isInvalid || undefined}
        inputMode="decimal"
        max={100}
        min={0}
        onChange={(event) => {
          const nextValue = event.target.value;
          setDraft(nextValue);

          if (nextValue === "") {
            const cleared = clearOrRejectRequiredValue(predicate, callbacks);
            setIsInvalid(!cleared);
            return;
          }

          const parsed = Number(nextValue);
          if (!Number.isFinite(parsed)) {
            setIsInvalid(true);
            return;
          }

          const committed = performValidatedMutation(
            callbacks,
            () => validatePredicateValue(predicate, parsed),
            () => setPredicateValue(predicate, parsed),
          );
          setIsInvalid(!committed);
        }}
        placeholder={placeholder}
        step="any"
        type="number"
        value={draft}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupText>%</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  );
}
