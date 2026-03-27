import { describe, expect, it } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { GraphRuntimeBootstrap } from "./graph-runtime-bootstrap.js";

describe("graph runtime bootstrap", () => {
  it("renders custom workflow loading copy before the scoped runtime resolves", () => {
    const html = renderToStaticMarkup(
      <GraphRuntimeBootstrap
        loadingDescription="Boot the workflow review scope before reading workflow projections."
        loadingTitle="Loading workflow review"
      >
        <div>ready</div>
      </GraphRuntimeBootstrap>,
    );

    expect(html).toContain("Loading workflow review");
    expect(html).toContain("Boot the workflow review scope before reading workflow projections.");
    expect(html).not.toContain("ready");
  });
});
