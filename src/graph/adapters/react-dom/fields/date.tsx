import {
  getPredicateEditorPlaceholder,
  performValidatedMutation,
  usePredicateField,
} from "@io/graph-react";
import { Input } from "@io/web/input";
import { useEffect, useState } from "react";

import {
  clearOrRejectRequiredValue,
  normalizeDateValue,
  setPredicateValue,
  useFieldMutationCallbacks,
  validatePredicateValue,
  type AnyFieldProps,
} from "./shared.js";

export function DateFieldEditor({ onMutationError, onMutationSuccess, predicate }: AnyFieldProps) {
  const callbacks = useFieldMutationCallbacks({ onMutationError, onMutationSuccess });
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
    <Input
      aria-invalid={isInvalid || undefined}
      data-web-field-kind="date"
      onChange={(event) => {
        const nextValue = event.target.value;
        setDraft(nextValue);

        if (nextValue === "") {
          const cleared = clearOrRejectRequiredValue(predicate, callbacks);
          setIsInvalid(!cleared);
          return;
        }

        const parsed = new Date(nextValue);
        if (Number.isNaN(parsed.getTime())) {
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
      type="text"
      value={draft}
    />
  );
}
