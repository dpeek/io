import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { createGraphleShellRegistry, GraphleShell } from "./index.js";

describe("graphle web shell registry", () => {
  it("sorts feature contributions deterministically", () => {
    const registry = createGraphleShellRegistry([
      {
        id: "beta",
        label: "Beta",
        order: 20,
        navigation: [{ id: "beta.nav", label: "Beta nav", href: "/beta", order: 20 }],
        pages: [{ id: "beta.page", label: "Beta page", path: "/beta", render: () => "Beta" }],
      },
      {
        id: "alpha",
        label: "Alpha",
        order: 10,
        navigation: [{ id: "alpha.nav", label: "Alpha nav", href: "/", order: 10 }],
        pages: [{ id: "alpha.page", label: "Alpha page", path: "/", render: () => "Alpha" }],
      },
    ]);

    expect(registry.features.map((feature) => feature.id)).toEqual(["alpha", "beta"]);
    expect(registry.navigation.map((item) => item.id)).toEqual(["alpha.nav", "beta.nav"]);
    expect(registry.pages.map((page) => page.id)).toEqual(["alpha.page", "beta.page"]);
  });
});

describe("GraphleShell", () => {
  it("renders without installed features", () => {
    const html = renderToStaticMarkup(<GraphleShell title="Graphle test" />);

    expect(html).toContain("Graphle test");
    expect(html).toContain("No feature areas installed");
    expect(html).toContain("Auth unknown");
    expect(html).toContain("Graph unknown");
  });

  it("renders a registered feature page", () => {
    const html = renderToStaticMarkup(
      <GraphleShell
        path="/site"
        features={[
          {
            id: "site",
            label: "Site",
            navigation: [{ id: "site.nav", label: "Site", href: "/site" }],
            pages: [
              {
                id: "site.page",
                label: "Site overview",
                path: "/site",
                render: () => <p>Site feature mounted</p>,
              },
            ],
          },
        ]}
        status={{
          auth: { label: "Admin active", state: "ready" },
          graph: { label: "Graph ready", state: "ready" },
        }}
      />,
    );

    expect(html).toContain("Site overview");
    expect(html).toContain("Site feature mounted");
    expect(html).toContain("Admin active");
    expect(html).toContain("Graph ready");
  });
});
