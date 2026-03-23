import { describe, expect, it } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import type { WebAuthViewState } from "../lib/auth-client.js";
import { HomePageStateView } from "./home-page.js";

function createSignedOutAuthState(): WebAuthViewState {
  return {
    status: "signed-out",
    authState: "signed-out",
    session: null,
    sessionId: null,
    userId: null,
    userEmail: null,
    displayName: null,
    errorMessage: null,
    isRefetching: false,
  };
}

describe("home page", () => {
  it("renders the signed-out auth entry flow before graph bootstrap is allowed", () => {
    const html = renderToStaticMarkup(<HomePageStateView auth={createSignedOutAuthState()} />);

    expect(html).toContain("Sign in to bootstrap graph access");
    expect(html).toContain("Create account");
    expect(html).toContain("Protected routes stay in the signed-out shell");
  });
});
