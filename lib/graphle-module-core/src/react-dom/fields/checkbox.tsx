import { performValidatedMutation, usePredicateField } from "@dpeek/graphle-react";
import { Checkbox } from "@dpeek/graphle-web-ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldTitle,
} from "@dpeek/graphle-web-ui/field";

import {
  getFieldState,
  setPredicateValue,
  useFieldMutationCallbacks,
  validatePredicateValue,
  type AnyRenderableFieldProps,
} from "./shared.js";

export function CheckboxFieldEditor(props: AnyRenderableFieldProps) {
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

  if (Array.isArray(value)) {
    return <span data-web-field-status="unsupported">unsupported-editor-kind:checkbox</span>;
  }

  const control = (
    <Checkbox
      aria-invalid={state.invalid || undefined}
      checked={value === true}
      data-web-field-kind="checkbox"
      onCheckedChange={(checked) => {
        controller?.setTouched(true);
        performValidatedMutation(
          callbacks,
          () => validatePredicateValue(predicate, checked),
          () => setPredicateValue(predicate, checked),
        );
      }}
    />
  );

  if (mode !== "field") {
    return control;
  }

  return (
    <Field
      data-invalid={state.invalid || undefined}
      data-orientation="horizontal"
      data-web-field-kind="checkbox"
      data-web-field-mode="field"
      data-web-field-touched={state.controller?.getSnapshot().touched || undefined}
      orientation="horizontal"
    >
      <FieldLabel>
        {control}
        <FieldContent>
          <FieldTitle>{state.label}</FieldTitle>
          {state.description ? <FieldDescription>{state.description}</FieldDescription> : null}
        </FieldContent>
      </FieldLabel>
      <FieldError errors={state.issues} />
    </Field>
  );
}
