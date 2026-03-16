import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import { act } from "react";

import { createExampleRuntime } from "../graph/runtime.js";
import { getAllByData, getByData, textContent } from "../test-dom.js";

import { AppRuntimeBootstrap, type AppRuntime, useAppRuntime } from "./runtime.js";

function createDeferred<TValue>() {
  let resolve!: (value: TValue) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<TValue>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return {
    promise,
    reject,
    resolve,
  };
}

function RuntimeProbe() {
  const runtime = useAppRuntime();
  return (
    <div data-app-bootstrap="ready">
      {runtime.graph.company.list().map((company) => company.name).join(", ")}
    </div>
  );
}

describe("app runtime bootstrap", () => {
  it("shows loading until the shared runtime has completed its initial sync", async () => {
    const deferred = createDeferred<AppRuntime>();
    let rendered!: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <AppRuntimeBootstrap
          loadRuntime={() => deferred.promise}
          renderApp={() => <RuntimeProbe />}
        />,
      );
    });
    const { container, unmount } = rendered;

    expect(getByData(container, "data-app-bootstrap", "loading")).toBeDefined();
    expect(getAllByData(container, "data-app-bootstrap").filter((node) => node.dataset.appBootstrap === "ready")).toHaveLength(0);

    await act(async () => {
      deferred.resolve(createExampleRuntime() as AppRuntime);
      await deferred.promise;
    });

    expect(textContent(getByData(container, "data-app-bootstrap", "ready"))).toContain("Acme Corp");

    unmount();
  });

  it("renders an error state when the initial sync fails", async () => {
    const deferred = createDeferred<AppRuntime>();
    let rendered!: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(
        <AppRuntimeBootstrap
          loadRuntime={() => deferred.promise}
          renderApp={() => <RuntimeProbe />}
        />,
      );
    });
    const { container, unmount } = rendered;

    await act(async () => {
      deferred.reject(new Error("authority offline"));
      try {
        await deferred.promise;
      } catch {
        // The component owns the visible error state.
      }
    });

    const errorState = getByData(container, "data-app-bootstrap", "error");
    expect(errorState).toBeDefined();
    expect(textContent(errorState)).toContain("authority offline");

    unmount();
  });
});
