import { describe, expect, it } from "bun:test";

import {
  EmptyPreview,
  SourcePreviewFieldEditor,
  sourcePreviewEditorFrameClassName,
  sourcePreviewPanelClassName,
  sourcePreviewTextareaClassName,
} from "@io/web/source-preview";
import { renderToStaticMarkup } from "react-dom/server";

describe("SourcePreviewFieldEditor", () => {
  it("renders source mode by default", () => {
    const markup = renderToStaticMarkup(
      <SourcePreviewFieldEditor
        kind="markdown"
        preview={<div data-preview="ready">Preview</div>}
        source={<div data-source="ready">Source</div>}
      />,
    );

    expect(markup).toContain('data-web-source-preview-mode="source"');
    expect(markup).toContain('data-web-source-preview-panel="source"');
    expect(markup).toContain('data-web-source-preview-toggle-state="inactive"');
    expect(markup).toContain('aria-label="Show preview"');
    expect(markup).toContain('data-source="ready"');
    expect(markup).not.toContain('data-preview="ready"');
  });

  it("renders preview mode when requested", () => {
    const markup = renderToStaticMarkup(
      <SourcePreviewFieldEditor
        defaultMode="preview"
        kind="svg"
        preview={<div data-preview="ready">Preview</div>}
        source={<div data-source="ready">Source</div>}
      />,
    );

    expect(markup).toContain('data-web-source-preview-mode="preview"');
    expect(markup).toContain('data-web-source-preview-panel="preview"');
    expect(markup).toContain('data-web-source-preview-toggle-state="active"');
    expect(markup).toContain('aria-label="Hide preview"');
    expect(markup).toContain('data-preview="ready"');
    expect(markup).not.toContain('data-source="ready"');
  });

  it("keeps the shared panel styles available to browser editors", () => {
    const emptyMarkup = renderToStaticMarkup(
      <EmptyPreview attribute="markdown">Start writing to preview rendered markdown.</EmptyPreview>,
    );

    expect(sourcePreviewPanelClassName).toContain("min-h-[22rem]");
    expect(sourcePreviewEditorFrameClassName).toContain("overflow-hidden");
    expect(sourcePreviewTextareaClassName).toContain("min-h-[22rem]");
    expect(emptyMarkup).toContain('data-web-source-preview-empty="markdown"');
    expect(emptyMarkup).toContain("border-dashed");
  });
});
