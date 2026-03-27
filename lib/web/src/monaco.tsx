import {
  sourcePreviewEditorFrameClassName,
  sourcePreviewTextareaClassName,
} from "@io/web/source-preview";
import type { editor as MonacoEditorNamespace } from "monaco-editor";
import { startTransition, useEffect, useState, type ComponentType, type ReactNode } from "react";

export const sourcePreviewMonacoOptions = {
  automaticLayout: true,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
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
} satisfies MonacoEditorNamespace.IStandaloneEditorConstructionOptions;

type MonacoEditorComponent = ComponentType<{
  defaultLanguage?: string;
  height?: number | string;
  loading?: ReactNode;
  onChange?: (value: string | undefined) => void;
  options?: MonacoEditorNamespace.IStandaloneEditorConstructionOptions;
  theme?: string;
  value?: string;
}>;

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

export function MonacoSourceEditor(props: {
  height?: number | string;
  language?: string;
  onChange?(nextValue: string): void;
  options?: MonacoEditorNamespace.IStandaloneEditorConstructionOptions;
  placeholder?: string;
  sourceKind: string;
  theme?: string;
  value: string;
}) {
  const { height = 360, language, options, placeholder, sourceKind, theme = "vs", value } = props;
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
        onChange={props.onChange}
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
          onChange={props.onChange}
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
        onChange={(nextValue) => props.onChange?.(nextValue ?? "")}
        options={options}
        theme={theme}
        value={value}
      />
    </div>
  );
}
