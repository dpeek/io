import type { editor as MonacoEditorNamespace } from "monaco-editor";
import { startTransition, useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import ReactMarkdown from "react-markdown";

import {
  sourcePreviewEditorFrameClassName,
  sourcePreviewTextareaClassName,
} from "./source-preview-styles.js";

type BunMarkdownApi = typeof Bun.markdown;
type MonacoEditorComponent = ComponentType<{
  defaultLanguage?: string;
  height?: number | string;
  loading?: ReactNode;
  onChange?: (value: string | undefined) => void;
  options?: MonacoEditorNamespace.IStandaloneEditorConstructionOptions;
  theme?: string;
  value?: string;
}>;

type GlobalWithOptionalBun = typeof globalThis & {
  Bun?: {
    markdown?: BunMarkdownApi;
  };
};

function getBunMarkdown(): BunMarkdownApi | null {
  return (globalThis as GlobalWithOptionalBun).Bun?.markdown ?? null;
}

function CodeEditorFallback({
  onChange,
  placeholder,
  readOnly = false,
  sourceKind,
  value,
}: {
  onChange?: (nextValue: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  sourceKind: string;
  value: string;
}) {
  const sourceData = {
    [`data-web-${sourceKind}-source`]: "textarea",
  } as Record<`data-${string}`, string>;

  return (
    <textarea
      className={sourcePreviewTextareaClassName}
      data-web-field-kind="textarea"
      {...sourceData}
      onChange={(event) => onChange?.(event.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      spellCheck={false}
      value={value}
    />
  );
}

export function MonacoCodeEditor({
  height = 360,
  language,
  onChange,
  placeholder,
  sourceKind,
  value,
}: {
  height?: number | string;
  language: string;
  onChange(nextValue: string): void;
  placeholder?: string;
  sourceKind: string;
  value: string;
}) {
  const [Editor, setEditor] = useState<MonacoEditorComponent | null>(null);

  useEffect(() => {
    let cancelled = false;

    void import("@monaco-editor/react")
      .then((module) => {
        if (cancelled) return;
        startTransition(() => {
          setEditor(() => module.default as MonacoEditorComponent);
        });
      })
      .catch(() => {
        if (cancelled) return;
        setEditor(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!Editor) {
    return (
      <CodeEditorFallback
        onChange={onChange}
        placeholder={placeholder}
        sourceKind={sourceKind}
        value={value}
      />
    );
  }

  const sourceData = {
    [`data-web-${sourceKind}-source`]: "monaco",
  } as Record<`data-${string}`, string>;

  return (
    <div className={sourcePreviewEditorFrameClassName} {...sourceData}>
      <div hidden>
        <CodeEditorFallback
          onChange={onChange}
          placeholder={placeholder}
          sourceKind={sourceKind}
          value={value}
        />
      </div>
      <Editor
        defaultLanguage={language}
        height={height}
        loading={
          <CodeEditorFallback
            placeholder={placeholder}
            readOnly
            sourceKind={sourceKind}
            value={value}
          />
        }
        onChange={(nextValue) => onChange(nextValue ?? "")}
        options={{
          automaticLayout: true,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
          fontSize: 13,
          folding: false,
          lineDecorationsWidth: 0,
          lineNumbers: "off",
          lineNumbersMinChars: 0,
          minimap: { enabled: false },
          overviewRulerBorder: false,
          overviewRulerLanes: 0,
          padding: { top: 16, bottom: 16 },
          renderWhitespace: "selection",
          roundedSelection: false,
          scrollBeyondLastLine: false,
          tabSize: 2,
          wordWrap: "on",
          wrappingIndent: "indent",
        }}
        theme="vs"
        value={value}
      />
    </div>
  );
}

export function MarkdownRenderer({ className, content }: { className?: string; content: string }) {
  const bunMarkdown = getBunMarkdown();

  return (
    <div className={className} data-web-markdown-renderer={bunMarkdown ? "bun" : "react-markdown"}>
      {bunMarkdown ? (
        bunMarkdown.react(content, undefined, {
          autolinks: true,
          headings: { ids: true },
          reactVersion: 19,
          tagFilter: true,
        })
      ) : (
        <ReactMarkdown>{content}</ReactMarkdown>
      )}
    </div>
  );
}

export function MonacoMarkdownEditor({
  height = 360,
  onChange,
  placeholder,
  value,
}: {
  height?: number | string;
  onChange(nextValue: string): void;
  placeholder?: string;
  value: string;
}) {
  return (
    <MonacoCodeEditor
      height={height}
      language="markdown"
      onChange={onChange}
      placeholder={placeholder}
      sourceKind="markdown"
      value={value}
    />
  );
}
