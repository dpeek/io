import { useDeferredValue, useEffect, useState } from "react";

import {
  getPredicateEditorPlaceholder,
  performValidatedMutation,
  usePredicateField,
} from "../../react/index.js";
import { MonacoCodeEditor } from "../markdown.js";
import {
  SourcePreviewFieldEditor,
  SvgPreview,
  normalizeTextValue,
  setPredicateValue,
  useFieldMutationCallbacks,
  validatePredicateValue,
  type AnyFieldProps,
} from "./shared.js";

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
        <div aria-invalid={isInvalid || undefined}>
          <MonacoCodeEditor
            height={360}
            language="xml"
            onChange={applyDraft}
            placeholder={placeholder}
            sourceKind="svg"
            value={draft}
          />
        </div>
      }
    />
  );
}
