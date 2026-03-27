import {
  getPredicateEditorPlaceholder,
  performValidatedMutation,
  usePredicateField,
  type PredicateFieldViewCapability,
} from "@io/graph-react";
import { MarkdownRenderer } from "@io/web/markdown";
import { MonacoSourceEditor, sourcePreviewMonacoOptions } from "@io/web/monaco";
import {
  EmptyPreview,
  SourcePreviewFieldEditor,
  sourcePreviewPanelClassName,
} from "@io/web/source-preview";
import { useDeferredValue, useEffect, useState } from "react";

import {
  normalizeTextValue,
  setPredicateValue,
  useFieldMutationCallbacks,
  validatePredicateValue,
  type AnyFieldProps,
} from "./shared.js";

function MarkdownFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  const content = normalizeTextValue(value);

  return (
    <div data-web-field-kind="markdown">
      <MarkdownRenderer className="graph-markdown" content={content} />
    </div>
  );
}

export const markdownFieldViewCapability = {
  kind: "markdown",
  Component: MarkdownFieldView,
} satisfies PredicateFieldViewCapability<any, any>;

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
            <MarkdownRenderer className="graph-markdown" content={deferredDraft} />
          </div>
        ) : (
          <EmptyPreview attribute="markdown">
            Start writing to preview rendered markdown.
          </EmptyPreview>
        )
      }
      source={
        <div aria-invalid={isInvalid || undefined}>
          <MonacoSourceEditor
            language="markdown"
            onChange={applyDraft}
            options={sourcePreviewMonacoOptions}
            placeholder={placeholder}
            sourceKind="markdown"
            value={draft}
          />
        </div>
      }
    />
  );
}
