import { Input } from "@io/web/input";
import { useEffect, useState } from "react";

import {
  getPredicateEditorPlaceholder,
  performValidatedMutation,
  usePredicateField,
} from "../../../runtime/react/index.js";
import {
  clearOrRejectRequiredValue,
  normalizeUrlValue,
  setPredicateValue,
  useFieldMutationCallbacks,
  validatePredicateValue,
  type AnyFieldProps,
} from "./shared.js";

export function UrlFieldEditor({ onMutationError, onMutationSuccess, predicate }: AnyFieldProps) {
  const callbacks = useFieldMutationCallbacks({ onMutationError, onMutationSuccess });
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
    <Input
      aria-invalid={isInvalid || undefined}
      data-web-field-kind="url"
      onChange={(event) => {
        const nextValue = event.target.value;
        setDraft(nextValue);

        if (nextValue === "") {
          const cleared = clearOrRejectRequiredValue(predicate, callbacks);
          setIsInvalid(!cleared);
          return;
        }

        try {
          const nextUrl = new URL(nextValue);
          const committed = performValidatedMutation(
            callbacks,
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
