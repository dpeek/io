import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  serializedQueryVersion,
  type QueryResultPage,
  type SerializedQueryRequest,
} from "@io/graph-client";
import { createSavedQueryRepositoryFromGraph } from "@io/graph-query";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { act, useState } from "react";

import { encodeQueryWorkbenchDraft } from "../lib/query-workbench.js";
import type { QueryRouteSearch } from "../lib/query-route-state.js";
import { createExampleRuntime } from "../lib/example-runtime.js";
import { GraphRuntimeProvider, type GraphRuntime } from "./graph-runtime-bootstrap.js";
import { QueryPageSurface } from "./query-page.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type DomGlobals = {
  readonly HTMLElement?: typeof globalThis.HTMLElement;
  readonly Event?: typeof globalThis.Event;
  readonly MouseEvent?: typeof globalThis.MouseEvent;
  readonly Node?: typeof globalThis.Node;
  readonly document?: Document;
  readonly navigator?: Navigator;
  readonly window?: Window & typeof globalThis;
};

type QueryPageHarnessProps = {
  readonly executePreviewPage?: (request: SerializedQueryRequest) => Promise<QueryResultPage>;
  readonly initialSearch?: QueryRouteSearch;
  readonly principalId: string;
  readonly runtime: GraphRuntime;
};

function QueryPageHarness({
  executePreviewPage,
  initialSearch = {},
  principalId,
  runtime,
}: QueryPageHarnessProps) {
  const [search, setSearch] = useState<QueryRouteSearch>(initialSearch);

  return (
    <GraphRuntimeProvider runtime={runtime}>
      <QueryPageSurface
        executePreviewPage={executePreviewPage}
        onSearchChange={(nextSearch) => {
          setSearch(nextSearch);
        }}
        principalId={principalId}
        search={search}
      />
      <pre data-query-route-state="">{JSON.stringify(search)}</pre>
    </GraphRuntimeProvider>
  );
}

function createPreviewPage(request: SerializedQueryRequest): QueryResultPage {
  const limit =
    request.query.kind === "collection" || request.query.kind === "scope"
      ? (request.query.window?.limit ?? 1)
      : 1;

  return {
    freshness: {
      completeness: "complete",
      freshness: "current",
    },
    items: Array.from({ length: limit }, (_, index) => ({
      entityId: `entity:${limit}:${index + 1}`,
      key: `preview:${limit}:${index + 1}`,
      payload: {
        id: `preview:${limit}:${index + 1}`,
        kind: request.query.kind,
        name: `Preview ${limit} #${index + 1}`,
        state: `limit-${limit}`,
        title: `Preview ${limit} #${index + 1}`,
        updatedAt: "2026-03-31T00:00:00.000Z",
      },
    })),
    kind: request.query.kind,
  };
}

function readRouteState(container: HTMLElement): QueryRouteSearch {
  const state = container.querySelector("[data-query-route-state]");
  if (!state?.textContent) {
    throw new Error("Expected query route state to be rendered.");
  }
  return JSON.parse(state.textContent) as QueryRouteSearch;
}

function queryByText(container: HTMLElement, selector: string, text: string): HTMLElement | null {
  return (
    [...container.querySelectorAll<HTMLElement>(selector)].find((element) =>
      element.textContent?.includes(text),
    ) ?? null
  );
}

function requireButton(container: HTMLElement, text: string): HTMLButtonElement {
  const element = queryByText(container, "button", text);
  const view = container.ownerDocument.defaultView;
  if (!view || !(element instanceof view.HTMLButtonElement)) {
    throw new Error(`Expected button containing "${text}".`);
  }
  return element;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
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
    navigator: globalThis.navigator,
    Node: globalThis.Node,
    window: globalThis.window,
  };

  Object.assign(globalThis, {
    document: dom.window.document,
    Event: dom.window.Event,
    HTMLElement: dom.window.HTMLElement,
    MouseEvent: dom.window.MouseEvent,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
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

describe("query page", () => {
  let dom: ReturnType<typeof installDom> | undefined;

  beforeEach(() => {
    dom = installDom();
  });

  afterEach(() => {
    dom?.cleanup();
    dom = undefined;
  });

  it(
    "persists graph-backed save, reopen, edit, and preview flow across remounts",
    async () => {
      const runtime = createExampleRuntime();
      const principalId = "principal:query-authoring";
      const repository = createSavedQueryRepositoryFromGraph(runtime.graph, principalId);
      const previewRequests: SerializedQueryRequest[] = [];
      const executePreviewPage = async (request: SerializedQueryRequest) => {
        previewRequests.push(request);
        return createPreviewPage(request);
      };

      if (!dom) {
        throw new Error("Expected DOM fixture.");
      }
      const domFixture = dom;

      let root: Root | undefined;

      async function render(initialSearch: QueryRouteSearch = {}): Promise<void> {
        root = createRoot(domFixture.container);
        await act(async () => {
          root?.render(
            <QueryPageHarness
              executePreviewPage={executePreviewPage}
              initialSearch={initialSearch}
              principalId={principalId}
              runtime={runtime as unknown as GraphRuntime}
            />,
          );
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      }

      try {
        await render();

        await waitFor(() => {
          expect(domFixture.container.textContent).toContain("Results Panel");
          expect(domFixture.container.textContent).toContain("Preview pending");
        });

        await waitFor(() => {
          expect(domFixture.container.querySelector("[data-query-editor]")).not.toBeNull();
          expect(domFixture.container.textContent).toContain(
            "does not issue an implicit preview on first load.",
          );
        });

        await act(async () => {
          root?.unmount();
        });
        root = undefined;

        await render({
          draft: encodeQueryWorkbenchDraft({
            query: {
              filter: {
                fieldId: "projectId",
                op: "eq",
                value: {
                  kind: "literal",
                  value: "project:io",
                },
              },
              indexId: "workflow:project-branch-board",
              kind: "collection",
              window: {
                limit: 25,
              },
            },
            version: serializedQueryVersion,
          }),
        });

        await waitFor(() => {
          expect(readRouteState(domFixture.container).draft).toBeString();
        });

        await waitFor(() => {
          expect(
            domFixture.container.querySelector('[data-query-renderer="default:list"]'),
          ).not.toBeNull();
          expect(domFixture.container.textContent).toContain("Preview 25 #1");
        });

        await click(requireButton(domFixture.container, "Save query"));

        const savedQuery = await waitFor(async () => {
          const queries = await repository.listSavedQueries();
          expect(queries).toHaveLength(1);
          return queries[0]!;
        });
        await waitFor(() => {
          expect(readRouteState(domFixture.container).queryId).toBe(savedQuery.id);
          expect(domFixture.container.textContent).toContain("Open query: Branch board query");
          expect(domFixture.container.textContent).toContain("Update query");
        });

        expect(savedQuery.ownerId).toBe(principalId);
        expect(savedQuery.request.query.kind).toBe("collection");
        if (savedQuery.request.query.kind !== "collection") {
          throw new Error("Expected saved collection query.");
        }

        await click(requireButton(domFixture.container, "Save view"));

        const savedView = await waitFor(async () => {
          const views = await repository.listSavedViews();
          expect(views).toHaveLength(1);
          return views[0]!;
        });
        await waitFor(() => {
          expect(readRouteState(domFixture.container).viewId).toBe(savedView.id);
          expect(domFixture.container.textContent).toContain("Open view: Branch board view");
          expect(domFixture.container.textContent).toContain("Update view");
        });

        expect(savedView.ownerId).toBe(principalId);
        expect(savedView.queryId).toBe(savedQuery.id);
        expect(savedView.rendererId).toBe("default:list");
        expect(savedView.containerDefaults?.pagination?.pageSize).toBe(25);
        expect(previewRequests.length).toBeGreaterThan(0);

        await act(async () => {
          root?.unmount();
        });
        root = undefined;

        await render({ viewId: savedView.id });

        await waitFor(() => {
          expect(
            domFixture.container.querySelector('[data-query-renderer="default:list"]'),
          ).not.toBeNull();
          expect(domFixture.container.textContent).toContain("Open view: Branch board view");
          expect(domFixture.container.textContent).toContain("Update view");
          expect(readRouteState(domFixture.container).viewId).toBe(savedView.id);
        });

        await click(requireButton(domFixture.container, "Open query: Branch board query"));

        await waitFor(() => {
          expect(readRouteState(domFixture.container).queryId).toBe(savedQuery.id);
          expect(domFixture.container.textContent).toContain("Update query");
        });

        await click(requireButton(domFixture.container, "Update query"));

        const updatedQuery = await waitFor(async () => {
          const query = await repository.getSavedQuery(savedQuery.id);
          expect(query?.updatedAt.toISOString()).not.toBe(savedQuery.updatedAt.toISOString());
          return query;
        });

        expect(updatedQuery?.id).toBe(savedQuery.id);
        expect((await repository.listSavedQueries()).map((query) => query.id)).toEqual([
          savedQuery.id,
        ]);
      } finally {
        await act(async () => {
          root?.unmount();
        });
      }
    },
    { timeout: 20_000 },
  );
});
