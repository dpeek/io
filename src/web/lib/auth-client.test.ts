import { describe, expect, it } from "bun:test";

import {
  getWebAuthDisplayName,
  readWebAuthState,
  type BetterAuthClientSession,
} from "./auth-client.js";

function createSession(overrides?: Partial<BetterAuthClientSession>): BetterAuthClientSession {
  return {
    session: {
      id: "session-1",
    },
    user: {
      id: "user-1",
      email: "operator@example.com",
      name: "Operator",
    },
    ...overrides,
  } as BetterAuthClientSession;
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
      session: null,
      sessionId: null,
      userId: null,
      userEmail: null,
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
      session: null,
      sessionId: null,
      userId: null,
      userEmail: null,
      displayName: null,
      errorMessage: null,
      isRefetching: false,
    });
  });

  it("projects the resolved Better Auth session into the signed-in shell view", () => {
    const session = createSession();

    expect(
      readWebAuthState({
        data: session,
        error: null,
        isPending: false,
        isRefetching: true,
      }),
    ).toEqual({
      status: "ready",
      authState: "ready",
      session,
      sessionId: "session-1",
      userId: "user-1",
      userEmail: "operator@example.com",
      displayName: "Operator",
      errorMessage: null,
      isRefetching: true,
    });
  });

  it("falls back from user name to email or user id for shell display labels", () => {
    expect(getWebAuthDisplayName(createSession())).toBe("Operator");
    expect(
      getWebAuthDisplayName(
        createSession({
          user: {
            id: "user-1",
            email: "operator@example.com",
            name: "   ",
          } as BetterAuthClientSession["user"],
        }),
      ),
    ).toBe("operator@example.com");
    expect(
      getWebAuthDisplayName(
        createSession({
          user: {
            id: "user-1",
            email: "   ",
            name: "   ",
          } as BetterAuthClientSession["user"],
        }),
      ),
    ).toBe("user-1");
  });

  it("surfaces failed session reads without pretending the shell is ready", () => {
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
      authState: "signed-out",
      session: null,
      sessionId: null,
      userId: null,
      userEmail: null,
      displayName: null,
      errorMessage: "AUTH_DB unavailable",
      isRefetching: false,
    });
  });
});
