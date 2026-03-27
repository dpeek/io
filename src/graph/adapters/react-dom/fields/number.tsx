import { performValidatedMutation, usePredicateField } from "@io/graph-react";
import { Input } from "@io/web/input";
import { useEffect, useState } from "react";

import {
  clearOrRejectRequiredValue,
  normalizeNumberValue,
  setPredicateValue,
  useFieldMutationCallbacks,
  validatePredicateValue,
  type AnyFieldProps,
} from "./shared.js";

export function NumberFieldEditor({
  onMutationError,
  onMutationSuccess,
  predicate,
}: AnyFieldProps) {
  const callbacks = useFieldMutationCallbacks({ onMutationError, onMutationSuccess });
  const { value } = usePredicateField(predicate);
  const committedValue = normalizeNumberValue(value);
  const [draft, setDraft] = useState(committedValue);
  const [isInvalid, setIsInvalid] = useState(false);

  useEffect(() => {
    setDraft(committedValue);
    setIsInvalid(false);
  }, [committedValue]);

  return (
    <Input
      aria-invalid={isInvalid || undefined}
      data-web-field-kind="number"
      inputMode="numeric"
      onChange={(event) => {
        const nextValue = event.target.value;
        setDraft(nextValue);

        if (nextValue === "") {
          const cleared = clearOrRejectRequiredValue(predicate, callbacks);
          setIsInvalid(!cleared);
          return;
        }

        const parsed = Number(nextValue);
        const committed = performValidatedMutation(
          callbacks,
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
