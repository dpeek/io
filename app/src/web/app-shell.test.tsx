import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import { act } from "react";

import { createExampleRuntime } from "../graph/runtime.js";
import { getByData, getReactProps } from "../test-dom.js";
import { AppShell, createTestAppBrowser } from "./app-shell.js";
import { AppRuntimeBootstrap, type AppRuntime } from "./runtime.js";

async function renderShell(url: string) {
  const browser = createTestAppBrowser(url);
  let rendered!: ReturnType<typeof render>;
  await act(async () => {
    rendered = render(
      <AppRuntimeBootstrap
        loadRuntime={() => Promise.resolve(createExampleRuntime() as AppRuntime)}
        renderApp={() => <AppShell browser={browser} />}
      />,
    );
    await Promise.resolve();
  });

  return {
    browser,
    ...rendered,
  };
}

describe("app shell", () => {
  it("canonicalizes the legacy env-var surface URL onto the route path", async () => {
    const { browser, container, unmount } = await renderShell("/?surface=env-vars&mode=demo#details");

    expect(browser.url()).toBe("/settings/env-vars?mode=demo#details");
    expect(getByData(container, "data-app-shell-route", "envVars")).toBeDefined();

    unmount();
  });

  it("strips stale surface params from explicit proof routes", async () => {
    const { browser, container, unmount } = await renderShell("/query?surface=query&mode=demo#details");

    expect(browser.url()).toBe("/query?mode=demo#details");
    expect(getByData(container, "data-app-shell-route", "query")).toBeDefined();

    unmount();
  });

  it("navigates between registered routes from the shared shell", async () => {
    const { browser, container, unmount } = await renderShell("/settings/env-vars");

    await act(async () => {
      getReactProps<{
        onClick(event: {
          altKey: boolean;
          button: number;
          ctrlKey: boolean;
          defaultPrevented: boolean;
          metaKey: boolean;
          preventDefault(): void;
          shiftKey: boolean;
        }): void;
      }>(getByData(container, "data-app-shell-link", "query")).onClick({
        altKey: false,
        button: 0,
        ctrlKey: false,
        defaultPrevented: false,
        metaKey: false,
        preventDefault() {},
        shiftKey: false,
      });
      await Promise.resolve();
    });

    expect(browser.url()).toBe("/query");
    expect(getByData(container, "data-app-shell-route", "query")).toBeDefined();
    expect(getByData(container, "data-company-query-match-count", "")).toBeDefined();

    unmount();
  });
});
