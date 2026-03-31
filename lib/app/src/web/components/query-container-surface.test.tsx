import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { serializedQueryVersion } from "@io/graph-client";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { QueryContainerRuntimeValue, QueryContainerSpec } from "../lib/query-container.js";
import { QueryContainerSurface, QueryContainerSurfaceView } from "./query-container-surface.js";
import { createListRendererBinding, createTableRendererBinding } from "./query-renderers.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const baseSpec = {
  containerId: "query-surface",
  pagination: {
    mode: "paged",
    pageSize: 2,
  },
  query: {
    kind: "inline",
    request: {
      version: serializedQueryVersion,
      query: {
        kind: "collection",
        indexId: "views:query-demo",
      },
    },
  },
  renderer: createListRendererBinding({
    descriptionField: "summary",
    titleField: "title",
  }),
} as const satisfies QueryContainerSpec;

const tableSpec = {
  ...baseSpec,
  renderer: createTableRendererBinding([
    {
      fieldId: "title",
      label: "Title",
    },
    {
      fieldId: "state",
      kind: "enum",
      label: "State",
    },
  ]),
} as const satisfies QueryContainerSpec;

function createValue(
  kind: "ready" | "stale" | "refreshing" | "error" | "paginated",
): QueryContainerRuntimeValue {
  const result = {
    kind: "collection" as const,
    freshness: {
      completeness: "complete" as const,
      freshness: kind === "stale" ? ("stale" as const) : ("current" as const),
    },
    items: [
      {
        key: "row:1",
        entityId: "entity:1",
        payload: {
          summary: "Shared renderer state",
          title: "Workflow shell",
        },
      },
    ],
    ...(kind === "stale" || kind === "refreshing" || kind === "paginated"
      ? { nextCursor: "cursor:2" }
      : {}),
  };

  return {
    cacheKey: "cache:query-surface",
    instanceKey: "instance:query-surface",
    pageKey: "page:first",
    request: baseSpec.query.request,
    snapshot: kind === "error" ? { error: { message: "boom", code: "failed" } } : { result },
    state:
      kind === "error"
        ? { kind: "error", error: { message: "boom", code: "failed" } }
        : kind === "stale"
          ? { kind: "stale", nextCursor: "cursor:2", result }
          : kind === "refreshing"
            ? { kind: "refreshing", nextCursor: "cursor:2", result }
            : kind === "paginated"
              ? { kind: "paginated", nextCursor: "cursor:2", result }
              : { kind: "ready", result },
  };
}

type DomGlobals = {
  readonly HTMLElement?: typeof globalThis.HTMLElement;
  readonly Event?: typeof globalThis.Event;
  readonly MouseEvent?: typeof globalThis.MouseEvent;
  readonly PointerEvent?: typeof globalThis.PointerEvent;
  readonly document?: Document;
  readonly navigator?: Navigator;
  readonly window?: Window & typeof globalThis;
};

function installDom(): {
  readonly cleanup: () => void;
  readonly container: HTMLElement;
} {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://io.localhost:8787/query",
  });
  const previous: DomGlobals = {
    document: globalThis.document,
    Event: globalThis.Event,
    HTMLElement: globalThis.HTMLElement,
    MouseEvent: globalThis.MouseEvent,
    PointerEvent: globalThis.PointerEvent,
    navigator: globalThis.navigator,
    window: globalThis.window,
  };
  const pointerEvent =
    dom.window.PointerEvent ?? class PointerEvent extends dom.window.MouseEvent {};

  Object.assign(globalThis, {
    document: dom.window.document,
    Event: dom.window.Event,
    HTMLElement: dom.window.HTMLElement,
    MouseEvent: dom.window.MouseEvent,
    PointerEvent: pointerEvent,
    navigator: dom.window.navigator,
    window: dom.window as unknown as Window & typeof globalThis,
  });

  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);

  return {
    cleanup() {
      dom.window.close();
      Object.assign(globalThis, previous);
    },
    container,
  };
}

async function waitFor<T>(callback: () => T | Promise<T>, timeoutMs = 5_000): Promise<T> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await callback();
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(String(lastError ?? "Timed out waiting for condition."));
}

describe("query container surface", () => {
  let dom: ReturnType<typeof installDom> | undefined;

  beforeEach(() => {
    dom = installDom();
  });

  afterEach(() => {
    dom?.cleanup();
    dom = undefined;
  });

  it("renders shared stale and refreshing chrome around renderer output", () => {
    const staleHtml = renderToStaticMarkup(
      <QueryContainerSurfaceView
        spec={baseSpec}
        title="Query surface"
        value={createValue("stale")}
      />,
    );
    const refreshingHtml = renderToStaticMarkup(
      <QueryContainerSurfaceView
        spec={baseSpec}
        title="Query surface"
        value={createValue("refreshing")}
      />,
    );

    expect(staleHtml).toContain("Results are stale. Refresh to reload the first page.");
    expect(staleHtml).toContain("Next page");
    expect(staleHtml).toContain('data-query-renderer="core:list"');
    expect(refreshingHtml).toContain("Refreshing from the current query container cache.");
    expect(refreshingHtml).toContain("disabled");
  });

  it("renders shared error chrome instead of invoking the renderer", () => {
    const html = renderToStaticMarkup(
      <QueryContainerSurfaceView
        spec={baseSpec}
        title="Query surface"
        value={createValue("error")}
      />,
    );

    expect(html).toContain('data-query-container-state="error"');
    expect(html).toContain("boom");
    expect(html).not.toContain('data-query-renderer="core:list"');
  });

  it("does not retry failed loads on every rerender", async () => {
    if (!dom) {
      throw new Error("Expected DOM fixture.");
    }

    let root: Root | undefined;
    let executionCount = 0;

    try {
      root = createRoot(dom.container);
      await act(async () => {
        root?.render(
          <QueryContainerSurface
            executePage={async () => {
              executionCount += 1;
              throw Object.assign(new Error("boom"), { code: "failed" as const });
            }}
            spec={baseSpec}
            title="Query surface"
          />,
        );
      });

      await waitFor(() => {
        expect(dom?.container.textContent).toContain("boom");
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(executionCount).toBe(1);
    } finally {
      await act(async () => {
        root?.unmount();
      });
    }
  });

  it("renders table columns as the primary entity fields instead of debug key columns", () => {
    const html = renderToStaticMarkup(
      <QueryContainerSurfaceView
        spec={tableSpec}
        title="Query surface"
        value={createValue("paginated")}
      />,
    );

    expect(html).toContain('data-query-renderer="core:table"');
    expect(html).toContain("Title");
    expect(html).toContain("State");
    expect(html).toContain("Select rows to stage collection actions.");
    expect(html).toContain("More rows available.");
    expect(html).not.toContain(">Key</th>");
    expect(html).not.toContain(">Entity</th>");
  });

  it("updates the page-local table selection state when a row is selected", async () => {
    if (!dom) {
      throw new Error("Expected DOM fixture.");
    }

    let root: Root | undefined;
    try {
      root = createRoot(dom.container);
      await act(async () => {
        root?.render(
          <QueryContainerSurfaceView
            spec={tableSpec}
            title="Query surface"
            value={createValue("paginated")}
          />,
        );
      });

      const rowCheckbox = dom.container.querySelectorAll<HTMLElement>('[role="checkbox"]')[1];
      if (!rowCheckbox) {
        throw new Error("Expected row checkbox.");
      }

      await act(async () => {
        rowCheckbox.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(dom.container.textContent).toContain("1 selected on this page");
      expect(
        dom.container.querySelector('[data-slot="table-row"][data-state="selected"]'),
      ).not.toBeNull();
    } finally {
      await act(async () => {
        root?.unmount();
      });
    }
  });

  it("surfaces active table rows through the shared renderer activation callback", async () => {
    if (!dom) {
      throw new Error("Expected DOM fixture.");
    }

    let activatedKey = "";
    let root: Root | undefined;
    try {
      root = createRoot(dom.container);
      await act(async () => {
        root?.render(
          <QueryContainerSurfaceView
            activeItemKey="row:1"
            onActivateItem={(item) => {
              activatedKey = item.key;
            }}
            spec={tableSpec}
            title="Query surface"
            value={createValue("paginated")}
          />,
        );
      });

      const row = dom.container.querySelector<HTMLElement>('[data-query-result-item="row:1"]');
      if (!row) {
        throw new Error("Expected query result row.");
      }

      expect(row.getAttribute("data-query-result-state")).toBe("active");

      await act(async () => {
        row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(activatedKey).toBe("row:1");
    } finally {
      await act(async () => {
        root?.unmount();
      });
    }
  });

  it("renders row and selection affordances without treating action clicks as row activation", async () => {
    if (!dom) {
      throw new Error("Expected DOM fixture.");
    }

    let activatedKey = "";
    let root: Root | undefined;
    try {
      root = createRoot(dom.container);
      await act(async () => {
        root?.render(
          <QueryContainerSurfaceView
            affordances={{
              renderRowActions: (item) => (
                <button data-row-command={item.key} type="button">
                  Mark blocked
                </button>
              ),
              renderSelectionActions: (selection) => (
                <button data-selection-command={selection.keys.join(",")} type="button">
                  Archive selected
                </button>
              ),
            }}
            onActivateItem={(item) => {
              activatedKey = item.key;
            }}
            spec={tableSpec}
            title="Query surface"
            value={createValue("paginated")}
          />,
        );
      });

      const rowAction = dom.container.querySelector<HTMLElement>('[data-row-command="row:1"]');
      if (!rowAction) {
        throw new Error("Expected row command affordance.");
      }

      await act(async () => {
        rowAction.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(activatedKey).toBe("");

      const rowCheckbox = dom.container.querySelectorAll<HTMLElement>('[role="checkbox"]')[1];
      if (!rowCheckbox) {
        throw new Error("Expected row checkbox.");
      }

      await act(async () => {
        rowCheckbox.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(dom.container.querySelector('[data-selection-command="row:1"]')).not.toBeNull();
    } finally {
      await act(async () => {
        root?.unmount();
      });
    }
  });
});
