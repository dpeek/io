import { afterEach, beforeEach, describe, it } from "bun:test";

import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { act } from "react";

import { CollectionBrowserProof } from "./collection-browser-proof.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type DomGlobals = {
  readonly HTMLElement?: typeof globalThis.HTMLElement;
  readonly Element?: typeof globalThis.Element;
  readonly Event?: typeof globalThis.Event;
  readonly MouseEvent?: typeof globalThis.MouseEvent;
  readonly Node?: typeof globalThis.Node;
  readonly PointerEvent?: typeof globalThis.PointerEvent;
  readonly document?: Document;
  readonly navigator?: Navigator;
  readonly window?: Window & typeof globalThis;
};

function queryByText(container: ParentNode, selector: string, text: string): HTMLElement | null {
  return (
    [...container.querySelectorAll<HTMLElement>(selector)].find((element) =>
      element.textContent?.includes(text),
    ) ?? null
  );
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
    element.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    element.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
}

async function waitFor<T>(callback: () => T | Promise<T>, timeoutMs = 5_000): Promise<T> {
  const start = Date.now();
  let lastError: unknown;

  while (Date.now() - start < timeoutMs) {
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

function getEntityIdFromRow(row: HTMLElement): string {
  const itemKey = row.getAttribute("data-query-result-item");
  if (!itemKey?.startsWith("row:")) {
    throw new Error("Expected query row item key.");
  }
  return itemKey.slice("row:".length);
}

function installDom(): {
  readonly cleanup: () => void;
  readonly container: HTMLElement;
} {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://io.localhost:8787/views",
  });
  const previous: DomGlobals = {
    document: globalThis.document,
    Element: globalThis.Element,
    Event: globalThis.Event,
    HTMLElement: globalThis.HTMLElement,
    MouseEvent: globalThis.MouseEvent,
    Node: globalThis.Node,
    PointerEvent: globalThis.PointerEvent,
    navigator: globalThis.navigator,
    window: globalThis.window,
  };
  const pointerEvent =
    dom.window.PointerEvent ?? class PointerEvent extends dom.window.MouseEvent {};

  Object.assign(globalThis, {
    document: dom.window.document,
    Element: dom.window.Element,
    Event: dom.window.Event,
    HTMLElement: dom.window.HTMLElement,
    MouseEvent: dom.window.MouseEvent,
    Node: dom.window.Node,
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

describe("collection browser proof", () => {
  let dom: ReturnType<typeof installDom> | undefined;

  beforeEach(() => {
    dom = installDom();
  });

  afterEach(() => {
    dom?.cleanup();
    dom = undefined;
  });

  it("drives branch detail, row actions, and selection actions from the generic collection surface", async () => {
    if (!dom) {
      throw new Error("Expected DOM fixture.");
    }

    let root: Root | undefined;
    try {
      root = createRoot(dom.container);
      await act(async () => {
        root?.render(<CollectionBrowserProof />);
      });

      const shellRow = await waitFor(() => {
        const row = queryByText(dom!.container, "[data-query-result-item]", "Workflow shell");
        if (!row) {
          throw new Error("Expected workflow shell row.");
        }
        return row;
      });

      await waitFor(() => {
        const surface = dom?.container.querySelector<HTMLElement>('[data-entity-surface="entity"]');
        if (surface?.getAttribute("data-entity-surface-entity") !== getEntityIdFromRow(shellRow)) {
          throw new Error("Expected the first branch detail to render.");
        }
        return surface;
      });

      await waitFor(() => {
        const toggle = dom?.container.querySelector<HTMLElement>(
          '[data-entity-surface-mode-toggle="true"]',
        );
        if (!toggle) {
          throw new Error("Expected the shared entity-surface mode toggle.");
        }
        return toggle;
      });

      if (dom.container.querySelector('[data-explorer-debug-toggle="entity"]')) {
        throw new Error("Expected shared entity detail to replace the old explorer debug panel.");
      }

      const backlogRow = await waitFor(() => {
        const row = queryByText(dom!.container, "[data-query-result-item]", "Workflow backlog");
        if (!row) {
          throw new Error("Expected workflow backlog row.");
        }
        return row;
      });

      const rowAction = backlogRow.querySelector<HTMLElement>(
        '[data-collection-command-trigger="views:workflow-branch-board:mark-blocked"]',
      );
      if (!rowAction) {
        throw new Error("Expected row command affordance.");
      }

      await click(backlogRow);

      await waitFor(() => {
        const surface = dom?.container.querySelector<HTMLElement>('[data-entity-surface="entity"]');
        if (
          surface?.getAttribute("data-entity-surface-entity") !== getEntityIdFromRow(backlogRow)
        ) {
          throw new Error("Expected branch detail selection to update before the row command.");
        }
        return surface;
      });

      await click(rowAction);

      await waitFor(() => {
        const updatedBacklogRow = queryByText(
          dom!.container,
          "[data-query-result-item]",
          "Workflow backlog",
        );
        if (!updatedBacklogRow?.textContent?.includes("Blocked")) {
          throw new Error("Expected backlog row state to refresh after the row command.");
        }
        return updatedBacklogRow;
      });

      const headerCheckbox = dom.container.querySelectorAll<HTMLElement>('[role="checkbox"]')[0];
      if (!headerCheckbox) {
        throw new Error("Expected table header checkbox.");
      }

      await click(headerCheckbox);

      await waitFor(() => {
        if (!dom?.container.textContent?.includes("2 selected on this page")) {
          throw new Error("Expected page selection summary.");
        }
        return true;
      });

      const selectionAction = await waitFor(() => {
        const trigger = dom?.container.querySelector<HTMLElement>(
          '[data-collection-command-trigger="views:workflow-branch-board:archive-selection"]',
        );
        if (!trigger) {
          throw new Error("Expected selection command affordance.");
        }
        return trigger;
      });

      await click(selectionAction);

      const confirmButton = await waitFor(() => {
        const button = queryByText(dom!.container.ownerDocument, "button", "Archive branches");
        if (!button) {
          throw new Error("Expected confirm action.");
        }
        return button;
      });

      await click(confirmButton);

      await waitFor(() => {
        const rows = [
          queryByText(dom!.container, "[data-query-result-item]", "Workflow shell"),
          queryByText(dom!.container, "[data-query-result-item]", "Workflow backlog"),
        ];
        if (rows.some((row) => !row?.textContent?.includes("Archived"))) {
          throw new Error("Expected selection command to update both branch rows.");
        }
        return rows;
      });

      const createButton = queryByText(dom.container, "button", "Create Branch");
      if (!createButton) {
        throw new Error("Expected collection create button.");
      }
    } finally {
      await act(async () => {
        root?.unmount();
      });
    }
  }, 15_000);
});
