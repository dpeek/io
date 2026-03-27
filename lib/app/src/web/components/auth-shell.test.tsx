import { describe, expect, it } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import type { WebAuthViewState } from "../lib/auth-client.js";
import { GraphAccessGateView } from "./auth-shell.js";

function createReadyAuthState(): WebAuthViewState {
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
        roleKeys: ["graph:member"],
        capabilityGrantIds: ["grant-1"],
        access: {
          authority: false,
          graphMember: true,
          sharedRead: false,
        },
        capabilityVersion: 4,
        policyVersion: 7,
      },
    },
    principal: {
      graphId: "graph-1",
      principalId: "principal-1",
      principalKind: "human",
      roleKeys: ["graph:member"],
      capabilityGrantIds: ["grant-1"],
      access: {
        authority: false,
        graphMember: true,
        sharedRead: false,
      },
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
