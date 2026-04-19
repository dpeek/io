import {
  getPredicateEditorPlaceholder,
  performValidatedMutation,
  usePredicateField,
  type PredicateFieldViewCapability,
} from "@dpeek/graphle-react";
import { SourceEditor, SourcePreviewFieldEditor } from "@dpeek/graphle-web-ui/source-preview";
import { useDeferredValue, useEffect, useState } from "react";

import {
  normalizeTextValue,
  setPredicateValue,
  useFieldMutationCallbacks,
  validatePredicateValue,
  type AnyFieldProps,
} from "./shared.js";
import { SvgPreview } from "./svg-preview.js";

function SvgFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  const content = normalizeTextValue(value);

  return (
    <div data-web-field-kind="svg">
      <SvgPreview content={content} />
    </div>
  );
}

export const svgFieldViewCapability = {
  kind: "svg",
  Component: SvgFieldView,
} satisfies PredicateFieldViewCapability<any, any>;

export function SvgFieldEditor({ onMutationError, onMutationSuccess, predicate }: AnyFieldProps) {
  const callbacks = useFieldMutationCallbacks({ onMutationError, onMutationSuccess });
  const { value } = usePredicateField(predicate);
  const placeholder = getPredicateEditorPlaceholder(predicate.field);
  const committedValue = normalizeTextValue(value);
  const [draft, setDraft] = useState(committedValue);
  const [isInvalid, setIsInvalid] = useState(false);
  const deferredDraft = useDeferredValue(draft);

  useEffect(() => {
    setDraft(committedValue);
    setIsInvalid(false);
  }, [committedValue]);

  function applyDraft(nextValue: string): void {
    setDraft(nextValue);
    const committed = performValidatedMutation(
      callbacks,
      () => validatePredicateValue(predicate, nextValue),
      () => setPredicateValue(predicate, nextValue),
    );
    setIsInvalid(!committed);
  }

  return (
    <SourcePreviewFieldEditor
      defaultMode="preview"
      kind="svg"
      preview={<SvgPreview content={deferredDraft} />}
      source={
        <SourceEditor
          aria-invalid={isInvalid || undefined}
          onChange={applyDraft}
          placeholder={placeholder}
          sourceKind="svg"
          value={draft}
        />
      }
    />
  );
}
