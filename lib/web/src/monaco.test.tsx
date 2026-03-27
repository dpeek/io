import { describe, expect, it } from "bun:test";

import { MonacoSourceEditor, sourcePreviewMonacoOptions } from "@io/web/monaco";
import { renderToStaticMarkup } from "react-dom/server";

describe("MonacoSourceEditor", () => {
  it("renders the textarea fallback before Monaco loads", () => {
    const markup = renderToStaticMarkup(
      <MonacoSourceEditor
        language="markdown"
        placeholder="Write here"
        sourceKind="markdown"
        value="hello"
      />,
    );

    expect(markup).toContain('data-web-markdown-source="textarea"');
    expect(markup).toContain('data-web-field-kind="textarea"');
    expect(markup).toContain('placeholder="Write here"');
    expect(markup).toContain(">hello</textarea>");
  });

  it("supports non-graph source kinds", () => {
    const markup = renderToStaticMarkup(
      <MonacoSourceEditor language="javascript" sourceKind="script" value="console.log('ok');" />,
    );

    expect(markup).toContain('data-web-script-source="textarea"');
  });

  it("exports the shared source-preview Monaco preset", () => {
    expect(sourcePreviewMonacoOptions.lineNumbers).toBe("off");
    expect(sourcePreviewMonacoOptions.minimap).toEqual({ enabled: false });
    expect(sourcePreviewMonacoOptions.wordWrap).toBe("on");
  });
});
