import { describe, expect, it } from "bun:test";

import type { WebAuthViewState } from "../lib/auth-client.js";
import { HomePageStateView } from "./home-page.js";
import { renderWithRouterLocation } from "./test-router.js";

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

describe("home page", () => {
  it("renders the signed-out auth entry flow before graph bootstrap is allowed", async () => {
    const html = await renderWithRouterLocation(
      "http://io.localhost:8787",
      "/",
      <HomePageStateView auth={createSignedOutAuthState()} />,
    );

    expect(html).toContain("Start locally or sign in to bootstrap graph access");
    expect(html).toContain("Start locally");
    expect(html).toContain("Localhost only");
    expect(html).toContain("Create account");
    expect(html).toContain("Protected routes stay in the signed-out shell");
  });

  it("promotes query authoring as the primary signed-in home-page entry point", async () => {
    const html = await renderWithRouterLocation(
      "http://io.localhost:8787",
      "/",
      <HomePageStateView auth={createReadyAuthState()} />,
    );

    expect(html).toContain("Open query");
    expect(html).toContain('href="/query"');
    expect(html).toContain("Use Query to author or reopen saved queries and views");
    expect(html).toContain("Open workflow");
    expect(html).toContain("Open views");
  });
});
