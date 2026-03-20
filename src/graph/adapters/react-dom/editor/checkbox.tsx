import { Checkbox } from "@io/web/checkbox";

import { performValidatedMutation, usePredicateField } from "../../../runtime/react/index.js";
import {
  setPredicateValue,
  useFieldMutationCallbacks,
  validatePredicateValue,
  type AnyFieldProps,
} from "./shared.js";

export function CheckboxFieldEditor({
  onMutationError,
  onMutationSuccess,
  predicate,
}: AnyFieldProps) {
  const callbacks = useFieldMutationCallbacks({ onMutationError, onMutationSuccess });
  const { value } = usePredicateField(predicate);

  if (Array.isArray(value)) {
    return <span data-web-field-status="unsupported">unsupported-editor-kind:checkbox</span>;
  }

  return (
    <Checkbox
      checked={value === true}
      data-web-field-kind="checkbox"
      onCheckedChange={(checked) => {
        performValidatedMutation(
          callbacks,
          () => validatePredicateValue(predicate, checked),
          () => setPredicateValue(predicate, checked),
        );
      }}
    />
  );
}
