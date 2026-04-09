import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { WebAuthViewState } from "../lib/auth-client.js";
import { GraphAccessGate, GraphAccessGateView } from "./auth-shell.js";

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

type FetchMock = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

function installDom(): {
  readonly cleanup: () => void;
  readonly container: HTMLElement;
} {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://web.local/app",
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

function readFetchPath(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return new URL(input, "https://web.local").pathname;
  }
  if (input instanceof URL) {
    return input.pathname;
  }
  if (input instanceof Request) {
    return new URL(input.url).pathname;
  }
  return new URL(String(input), "https://web.local").pathname;
}

function createReadyAuthState(
  input: {
    readonly access?: {
      readonly authority: boolean;
      readonly graphMember: boolean;
      readonly sharedRead: boolean;
    };
    readonly capabilityGrantIds?: readonly string[];
    readonly roleKeys?: readonly string[];
  } = {},
): WebAuthViewState {
  const access = input.access ?? {
    authority: false,
    graphMember: true,
    sharedRead: false,
  };
  const capabilityGrantIds = [...(input.capabilityGrantIds ?? ["grant-1"])];
  const roleKeys = [...(input.roleKeys ?? ["graph:member"])];

  return {
    status: "ready",
    authState: "ready",
    bootstrap: {
      session: {
        authState: "ready",
        sessionId: "session-1",
        principalId: "principal-1",
        capabilityVersion: 4,
        displayName: "Operator",
      },
      principal: {
        graphId: "graph-1",
        principalId: "principal-1",
        principalKind: "human",
        roleKeys,
        capabilityGrantIds,
        access,
        capabilityVersion: 4,
        policyVersion: 7,
      },
    },
    principal: {
      graphId: "graph-1",
      principalId: "principal-1",
      principalKind: "human",
      roleKeys,
      capabilityGrantIds,
      access,
      capabilityVersion: 4,
      policyVersion: 7,
    },
    sessionId: "session-1",
    principalId: "principal-1",
    capabilityVersion: 4,
    displayName: "Operator",
    errorMessage: null,
    isRefetching: false,
  };
}

function createSignedOutAuthState(): WebAuthViewState {
  return {
    status: "signed-out",
    authState: "signed-out",
    bootstrap: {
      session: {
        authState: "signed-out",
        sessionId: null,
        principalId: null,
        capabilityVersion: null,
      },
      principal: null,
    },
    principal: null,
    sessionId: null,
    principalId: null,
    capabilityVersion: null,
    displayName: null,
    errorMessage: null,
    isRefetching: false,
  };
}

function renderWithLocation(
  origin: string,
  input: Parameters<typeof renderToStaticMarkup>[0],
): string {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { origin } as Location,
  });

  try {
    return renderToStaticMarkup(input);
  } finally {
    if (previous) {
      Object.defineProperty(globalThis, "location", previous);
    } else {
      Reflect.deleteProperty(globalThis, "location");
    }
  }
}

describe("auth shell", () => {
  it("keeps graph bootstrap in the signed-out shell and exposes the localhost entry action", () => {
    const html = renderWithLocation(
      "http://io.localhost:8787",
      <GraphAccessGateView
        auth={createSignedOutAuthState()}
        description="Resolve a session before mounting graph access."
        title="Sign in to open the graph"
      >
        <div data-protected-surface="">protected graph surface</div>
      </GraphAccessGateView>,
    );

    expect(html).toContain("Sign in to open the graph");
    expect(html).toContain('data-auth-entry-card=""');
    expect(html).toContain("Start locally");
    expect(html).toContain("Localhost only");
    expect(html).not.toContain("protected graph surface");
  });

  it("renders protected graph surfaces after the session is ready", () => {
    const html = renderToStaticMarkup(
      <GraphAccessGateView
        auth={createReadyAuthState()}
        description="Resolve a session before mounting graph access."
        title="Sign in to open the graph"
      >
        <div data-protected-surface="">protected graph surface</div>
      </GraphAccessGateView>,
    );

    expect(html).toContain('data-protected-surface=""');
    expect(html).toContain("protected graph surface");
    expect(html).not.toContain("Sign in to open the graph");
  });

  it("surfaces expired bootstrap state as a reauthentication flow", () => {
    const html = renderToStaticMarkup(
      <GraphAccessGateView
        auth={{
          status: "expired",
          authState: "expired",
          bootstrap: {
            session: {
              authState: "expired",
              sessionId: null,
              principalId: null,
              capabilityVersion: null,
            },
            principal: null,
          },
          principal: null,
          sessionId: null,
          principalId: null,
          capabilityVersion: null,
          displayName: null,
          errorMessage: null,
          isRefetching: false,
        }}
        description="Resolve a session before mounting graph access."
        title="Sign in to open the graph"
      >
        <div data-protected-surface="">protected graph surface</div>
      </GraphAccessGateView>,
    );

    expect(html).toContain("Session expired");
    expect(html).not.toContain("protected graph surface");
  });

  it("holds graph routes behind an explicit retry card when bootstrap reads fail", () => {
    const html = renderToStaticMarkup(
      <GraphAccessGateView
        auth={{
          status: "error",
          authState: "booting",
          bootstrap: null,
          principal: null,
          sessionId: null,
          principalId: null,
          capabilityVersion: null,
          displayName: null,
          errorMessage: "Better Auth session verification is unavailable.",
          isRefetching: false,
        }}
        description="Resolve a session before mounting graph access."
        onRetry={() => {}}
        title="Sign in to open the graph"
      >
        <div data-protected-surface="">protected graph surface</div>
      </GraphAccessGateView>,
    );

    expect(html).toContain("Graph bootstrap is waiting on principal bootstrap");
    expect(html).toContain("Retry session check");
    expect(html).toContain("Better Auth session verification is unavailable.");
    expect(html).not.toContain("protected graph surface");
  });
});

describe("graph access gate", () => {
  let dom: ReturnType<typeof installDom> | undefined;

  beforeEach(() => {
    dom = installDom();
  });

  afterEach(() => {
    dom?.cleanup();
    dom = undefined;
  });

  it("mounts protected graph routes only after activation yields writable access", async () => {
    if (!dom) {
      throw new Error("Expected DOM fixture.");
    }

    const calls: string[] = [];
    const previousFetch = globalThis.fetch;
    const mockFetch: FetchMock = async (input, init) => {
      const path = readFetchPath(input);
      calls.push(path);

      if (path === "/api/bootstrap") {
        return new Response(JSON.stringify(createReadyAuthState({ roleKeys: [] }).bootstrap), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      }

      if (path === "/api/access/activate") {
        expect(init).toMatchObject({
          method: "POST",
          credentials: "same-origin",
        });
        return new Response(
          JSON.stringify({
            summary: createReadyAuthState().principal,
            principalId: "principal-1",
            principalKind: "human",
            roleKeys: ["graph:member"],
            capabilityGrantIds: ["grant-1"],
            capabilityVersion: 4,
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }

      throw new Error(`Unexpected fetch path ${path}`);
    };
    Object.assign(globalThis, { fetch: mockFetch });
    Object.assign(window, { fetch: mockFetch });

    let root: Root | undefined;
    try {
      root = createRoot(dom.container);
      await act(async () => {
        root?.render(
          <GraphAccessGate
            description="Resolve a session before mounting graph access."
            title="Sign in to open the graph"
          >
            <div data-protected-surface="">protected graph surface</div>
          </GraphAccessGate>,
        );
      });

      await waitFor(() => {
        const protectedSurface = dom?.container.querySelector("[data-protected-surface]");
        if (!protectedSurface) {
          throw new Error("Expected protected graph surface after writable activation.");
        }
        return protectedSurface;
      });

      expect(calls).toEqual(["/api/bootstrap", "/api/access/activate"]);
    } finally {
      await act(async () => {
        root?.unmount();
      });
      Object.assign(globalThis, { fetch: previousFetch });
      Object.assign(window, { fetch: previousFetch });
    }
  });

  it("keeps graph routes blocked when activation returns an unwritable principal", async () => {
    if (!dom) {
      throw new Error("Expected DOM fixture.");
    }

    const unwritableAuth = createReadyAuthState({
      access: {
        authority: false,
        graphMember: false,
        sharedRead: false,
      },
      capabilityGrantIds: [],
      roleKeys: [],
    });
    const previousFetch = globalThis.fetch;
    const mockFetch: FetchMock = async (input) => {
      const path = readFetchPath(input);

      if (path === "/api/bootstrap") {
        return new Response(JSON.stringify(unwritableAuth.bootstrap), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      }

      if (path === "/api/access/activate") {
        return new Response(
          JSON.stringify({
            summary: unwritableAuth.principal,
            principalId: "principal-1",
            principalKind: "human",
            roleKeys: [],
            capabilityGrantIds: [],
            capabilityVersion: 4,
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }

      throw new Error(`Unexpected fetch path ${path}`);
    };
    Object.assign(globalThis, { fetch: mockFetch });
    Object.assign(window, { fetch: mockFetch });

    let root: Root | undefined;
    try {
      root = createRoot(dom.container);
      await act(async () => {
        root?.render(
          <GraphAccessGate
            description="Resolve a session before mounting graph access."
            title="Sign in to open the graph"
          >
            <div data-protected-surface="">protected graph surface</div>
          </GraphAccessGate>,
        );
      });

      await waitFor(() => {
        if (!dom?.container.textContent?.includes("does not have graph-member write access")) {
          throw new Error("Expected unwritable activation error message.");
        }
        return true;
      });

      expect(dom.container.querySelector("[data-protected-surface]")).toBeNull();
      expect(dom.container.textContent).toContain("Graph access activation failed");
    } finally {
      await act(async () => {
        root?.unmount();
      });
      Object.assign(globalThis, { fetch: previousFetch });
      Object.assign(window, { fetch: previousFetch });
    }
  });
});
