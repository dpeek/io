import { describe, expect, it } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { SvgPreview } from "./svg-preview.js";

describe("SvgPreview", () => {
  it("keeps the graph-specific SVG preview states intact", () => {
    const blankMarkup = renderToStaticMarkup(<SvgPreview content="" />);
    const invalidMarkup = renderToStaticMarkup(<SvgPreview content="<svg><script /></svg>" />);
    const validMarkup = renderToStaticMarkup(
      <SvgPreview content={'<svg viewBox="0 0 24 24"><path d="M4 12h16" /></svg>'} />,
    );

    expect(blankMarkup).toContain('data-web-source-preview-empty="svg"');
    expect(blankMarkup).toContain("Paste SVG markup to preview it.");
    expect(invalidMarkup).toContain('data-web-source-preview-empty="svg"');
    expect(invalidMarkup).not.toContain('data-web-svg-preview="ready"');
    expect(validMarkup).toContain('data-web-svg-preview="ready"');
    expect(validMarkup).toContain('data-graph-svg-state="ready"');
  });
});
