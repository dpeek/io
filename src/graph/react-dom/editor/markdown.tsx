import { useDeferredValue, useEffect, useState } from "react";

import {
  getPredicateEditorPlaceholder,
  performValidatedMutation,
  usePredicateField,
} from "../../react/index.js";
import { MarkdownRenderer, MonacoMarkdownEditor } from "../markdown.js";
import { sourcePreviewPanelClassName } from "../source-preview-styles.js";
import {
  EmptyPreview,
  SourcePreviewFieldEditor,
  normalizeTextValue,
  setPredicateValue,
  useFieldMutationCallbacks,
  validatePredicateValue,
  type AnyFieldProps,
} from "./shared.js";

export function MarkdownFieldEditor({
  onMutationError,
  onMutationSuccess,
  predicate,
}: AnyFieldProps) {
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
      kind="markdown"
      preview={
        deferredDraft.trim().length > 0 ? (
          <div
            className={sourcePreviewPanelClassName}
            data-web-markdown-preview={deferredDraft === draft ? "ready" : "deferred"}
          >
            <div className="topic-markdown">
              <MarkdownRenderer content={deferredDraft} />
            </div>
          </div>
        ) : (
          <EmptyPreview attribute="markdown">
            Start writing to preview rendered markdown.
          </EmptyPreview>
        )
      }
      source={
        <div aria-invalid={isInvalid || undefined}>
          <MonacoMarkdownEditor onChange={applyDraft} placeholder={placeholder} value={draft} />
        </div>
      }
    />
  );
}
