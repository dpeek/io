import { describe, expect, it } from "bun:test";

import { renderWithRouterLocation } from "./test-router.js";
import { ViewsPage } from "./views-page.js";

describe("views page", () => {
  it("renders predicate families and example surfaces", async () => {
    const html = await renderWithRouterLocation(
      "http://io.localhost:8787",
      "/views",
      <ViewsPage />,
    );

    expect(html).toContain("Number");
    expect(html).toContain("String");
    expect(html).toContain("Boolean");
    expect(html).toContain("Display kind");
    expect(html).toContain("Display example");
    expect(html).toContain("Editor kind");
    expect(html).toContain("Editor example");
    expect(html).toContain("Reset");
    expect(html).not.toContain("View Proofs");
    expect(html).not.toContain("Query Renderer Proof");
  });
});
