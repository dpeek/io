import { describe, expect, it } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import type { WebAuthViewState } from "../lib/auth-client.js";
import { HomePageStateView } from "./home-page.js";

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

describe("home page", () => {
  it("renders the signed-out auth entry flow before graph bootstrap is allowed", () => {
    const html = renderWithLocation(
      "http://io.localhost:8787",
      <HomePageStateView auth={createSignedOutAuthState()} />,
    );

    expect(html).toContain("Start locally or sign in to bootstrap graph access");
    expect(html).toContain("Start locally");
    expect(html).toContain("Localhost only");
    expect(html).toContain("Create account");
    expect(html).toContain("Protected routes stay in the signed-out shell");
  });
});
