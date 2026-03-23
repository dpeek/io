import { describe, expect, it } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import type { BetterAuthClientSession, WebAuthViewState } from "../lib/auth-client.js";
import { GraphAccessGateView } from "./auth-shell.js";

function createReadyAuthState(): WebAuthViewState {
  const session = {
    session: {
      id: "session-1",
    },
    user: {
      id: "user-1",
      email: "operator@example.com",
      name: "Operator",
    },
  } as BetterAuthClientSession;

  return {
    status: "ready",
    authState: "ready",
    session,
    sessionId: "session-1",
    userId: "user-1",
    userEmail: "operator@example.com",
    displayName: "Operator",
    errorMessage: null,
    isRefetching: false,
  };
}

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

describe("auth shell", () => {
  it("keeps graph bootstrap in the signed-out shell until a session exists", () => {
    const html = renderToStaticMarkup(
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
});
