import { describe, expect, it } from "bun:test";

import type { WebPrincipalBootstrapPayload } from "@io/graph-authority";

import {
  fetchWebPrincipalBootstrap,
  readWebAuthState,
  readWebPrincipalDisplayName,
} from "./auth-client.js";

function createBootstrapPayload(
  overrides: Partial<WebPrincipalBootstrapPayload> = {},
): WebPrincipalBootstrapPayload {
  return {
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
    ...overrides,
  };
}

describe("web auth client helpers", () => {
  it("treats a pending empty session query as booting", () => {
    expect(
      readWebAuthState({
        data: null,
        error: null,
        isPending: true,
        isRefetching: false,
      }),
    ).toEqual({
      status: "booting",
      authState: "booting",
      bootstrap: null,
      principal: null,
      sessionId: null,
      principalId: null,
      capabilityVersion: null,
      displayName: null,
      errorMessage: null,
      isRefetching: false,
    });
  });

  it("treats a settled empty session query as signed out", () => {
    expect(
      readWebAuthState({
        data: null,
        error: null,
        isPending: false,
        isRefetching: false,
      }),
    ).toEqual({
      status: "signed-out",
      authState: "signed-out",
      bootstrap: expect.objectContaining({
        session: expect.objectContaining({
          authState: "signed-out",
        }),
      }),
      principal: null,
      sessionId: null,
      principalId: null,
      capabilityVersion: null,
      displayName: null,
      errorMessage: null,
      isRefetching: false,
    });
  });

  it("projects the resolved principal bootstrap into the signed-in shell view", () => {
    const payload = createBootstrapPayload();

    expect(
      readWebAuthState({
        data: payload,
        error: null,
        isPending: false,
        isRefetching: true,
      }),
    ).toEqual({
      status: "ready",
      authState: "ready",
      bootstrap: payload,
      principal: payload.principal!,
      sessionId: "session-1",
      principalId: "principal-1",
      capabilityVersion: 4,
      displayName: "Operator",
      errorMessage: null,
      isRefetching: true,
    });
  });

  it("keeps the last signed-in bootstrap visible while a retry is in flight", () => {
    const payload = createBootstrapPayload();

    expect(
      readWebAuthState({
        data: payload,
        error: null,
        isPending: false,
        isRefetching: true,
      }),
    ).toEqual({
      status: "ready",
      authState: "ready",
      bootstrap: payload,
      principal: payload.principal!,
      sessionId: "session-1",
      principalId: "principal-1",
      capabilityVersion: 4,
      displayName: "Operator",
      errorMessage: null,
      isRefetching: true,
    });
  });

  it("preserves explicit expired bootstrap state for reauthentication flows", () => {
    const payload = createBootstrapPayload({
      session: {
        authState: "expired",
        sessionId: null,
        principalId: null,
        capabilityVersion: null,
      },
      principal: null,
    });

    expect(
      readWebAuthState({
        data: payload,
        error: null,
        isPending: false,
        isRefetching: false,
      }),
    ).toEqual({
      status: "expired",
      authState: "expired",
      bootstrap: payload,
      principal: null,
      sessionId: null,
      principalId: null,
      capabilityVersion: null,
      displayName: null,
      errorMessage: null,
      isRefetching: false,
    });
  });

  it("reads display labels from the shared bootstrap contract without inventing new fields", () => {
    expect(readWebPrincipalDisplayName(createBootstrapPayload())).toBe("Operator");
    expect(
      readWebPrincipalDisplayName(
        createBootstrapPayload({
          session: {
            authState: "ready",
            sessionId: "session-1",
            principalId: "principal-1",
            capabilityVersion: 4,
            displayName: "   ",
          },
        }),
      ),
    ).toBeNull();
  });

  it("surfaces failed bootstrap reads without pretending the shell is ready", () => {
    expect(
      readWebAuthState({
        data: null,
        error: {
          message: "AUTH_DB unavailable",
        },
        isPending: false,
        isRefetching: false,
      }),
    ).toEqual({
      status: "error",
      authState: "booting",
      bootstrap: null,
      principal: null,
      sessionId: null,
      principalId: null,
      capabilityVersion: null,
      displayName: null,
      errorMessage: "AUTH_DB unavailable",
      isRefetching: false,
    });
  });

  it("keeps bootstrap failures in an explicit error state during retry", () => {
    expect(
      readWebAuthState({
        data: null,
        error: {
          message: "principal lookup unavailable",
        },
        isPending: false,
        isRefetching: true,
      }),
    ).toEqual({
      status: "error",
      authState: "booting",
      bootstrap: null,
      principal: null,
      sessionId: null,
      principalId: null,
      capabilityVersion: null,
      displayName: null,
      errorMessage: "principal lookup unavailable",
      isRefetching: true,
    });
  });

  it("fetches and validates the shared principal bootstrap payload", async () => {
    const payload = createBootstrapPayload();

    await expect(
      fetchWebPrincipalBootstrap({
        fetcher: async () =>
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          }),
      }),
    ).resolves.toEqual(payload);
  });

  it("surfaces worker-provided bootstrap error messages for retry UI", async () => {
    await expect(
      fetchWebPrincipalBootstrap({
        fetcher: async () =>
          new Response(
            JSON.stringify({
              error: "Better Auth session verification is unavailable.",
            }),
            {
              status: 503,
              statusText: "Service Unavailable",
              headers: {
                "content-type": "application/json",
              },
            },
          ),
      }),
    ).rejects.toThrow("Better Auth session verification is unavailable.");
  });

  it("falls back to an HTTP summary when bootstrap failures do not return JSON", async () => {
    await expect(
      fetchWebPrincipalBootstrap({
        fetcher: async () =>
          new Response("down", {
            status: 503,
            statusText: "Service Unavailable",
          }),
      }),
    ).rejects.toThrow("Unable to load the principal bootstrap (503 Service Unavailable).");
  });

  it("rejects malformed authenticated bootstrap payloads instead of guessing session state", () => {
    expect(() =>
      readWebAuthState({
        data: createBootstrapPayload({
          session: {
            authState: "ready",
            sessionId: "session-1",
            principalId: "principal-1",
            capabilityVersion: 4,
            displayName: "Operator",
          },
          principal: null,
        }),
        error: null,
        isPending: false,
        isRefetching: false,
      }),
    ).toThrow(
      'Authenticated bootstrap payloads must include both "session.sessionId" and "principal".',
    );
  });
});
