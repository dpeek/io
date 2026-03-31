import { describe, expect, it } from "bun:test";

import { renderWithRouterLocation } from "./test-router.js";
import { ViewsPage } from "./views-page.js";

describe("views page", () => {
  it("keeps /views as a proof route and points authoring back to /query", async () => {
    const html = await renderWithRouterLocation(
      "http://io.localhost:8787",
      "/views",
      <ViewsPage />,
    );

    expect(html).toContain("Proof-only review surface");
    expect(html).toContain("View Proofs");
    expect(html).toContain("Use `/query` to author, reopen, and save queries or views.");
    expect(html).toContain('href="/query"');
    expect(html).toContain("Open query authoring");
    expect(html).toContain("Reset proof fixture");
    expect(html).toContain("Query Renderer Proof");
    expect(html).toContain("Generic Collection Browser Proof");
    expect(html).toContain("Proof Fixture");
  });
});
