import { describe, expect, it } from "bun:test";

import type { AuthSubjectRef, AuthenticatedSession } from "@io/core/graph";

import {
  createBearerShareAuthorizationContext,
  createAnonymousAuthorizationContext,
  createWorkerAuthorizationContext,
  hashBearerShareToken,
  issueBearerShareToken,
  isBearerShareToken,
  isBearerShareTokenHash,
  projectBearerShareToken,
  projectSessionToPrincipal,
  reduceBetterAuthSession,
} from "./auth-bridge.js";

const subject = {
  issuer: "better-auth",
  provider: "github",
  providerAccountId: "acct-1",
  authUserId: "auth-user-1",
} satisfies AuthSubjectRef;

function createSession(sessionId: string): AuthenticatedSession {
  return {
    sessionId,
    subject,
  };
}

describe("web auth bridge", () => {
  it("reduces a Better Auth session result into the stable authenticated-session contract", () => {
    expect(
      reduceBetterAuthSession({
        session: { id: "session-better-auth" },
        user: { id: "user-better-auth", email: "Operator@Example.com " },
      }),
    ).toEqual({
      sessionId: "session-better-auth",
      subject: {
        issuer: "better-auth",
        provider: "user",
        providerAccountId: "user-better-auth",
        authUserId: "user-better-auth",
      },
      email: "operator@example.com",
    });
  });

  it("fails closed when Better Auth returns a malformed session payload", () => {
    expect(() =>
      reduceBetterAuthSession({
        session: { id: "" },
        user: { id: "user-better-auth" },
      }),
    ).toThrow('Better Auth session payload must include a non-empty "session.id" string.');
  });

  it("returns an anonymous authorization context when no authenticated session is present", async () => {
    const context = await projectSessionToPrincipal({
      graphId: "graph-1",
      policyVersion: 2,
      session: null,
      lookupPrincipal() {
        throw new Error("lookupPrincipal should not run without a session");
      },
    });

    expect(context).toEqual(
      createAnonymousAuthorizationContext({
        graphId: "graph-1",
        policyVersion: 2,
      }),
    );
  });

  it("maps authenticated sessions to the same graph principal by auth subject", async () => {
    const lookups: Array<{ graphId: string; subject: AuthSubjectRef }> = [];
    const lookupPrincipal = ({
      graphId,
      subject: lookupSubject,
    }: {
      graphId: string;
      subject: AuthSubjectRef;
    }) => {
      lookups.push({ graphId, subject: lookupSubject });
      return {
        principalId: "principal-1",
        principalKind: "human" as const,
        roleKeys: ["graph:member"],
        capabilityGrantIds: ["grant-1"],
        capabilityVersion: 4,
      };
    };

    const first = await projectSessionToPrincipal({
      graphId: "graph-1",
      policyVersion: 7,
      session: createSession("session-1"),
      lookupPrincipal,
    });
    const second = await projectSessionToPrincipal({
      graphId: "graph-1",
      policyVersion: 7,
      session: createSession("session-2"),
      lookupPrincipal,
    });

    expect(first).toMatchObject({
      graphId: "graph-1",
      principalId: "principal-1",
      principalKind: "human",
      sessionId: "session-1",
      roleKeys: ["graph:member"],
      capabilityGrantIds: ["grant-1"],
      capabilityVersion: 4,
      policyVersion: 7,
    });
    expect(second).toMatchObject({
      graphId: "graph-1",
      principalId: "principal-1",
      principalKind: "human",
      sessionId: "session-2",
      roleKeys: ["graph:member"],
      capabilityGrantIds: ["grant-1"],
      capabilityVersion: 4,
      policyVersion: 7,
    });
    expect(first.principalId).toBe(second.principalId);
    expect(first.principalKind).toBe(second.principalKind);
    expect(first.roleKeys).toEqual(second.roleKeys);
    expect(first.capabilityGrantIds).toEqual(second.capabilityGrantIds);
    expect(lookups).toEqual([
      { graphId: "graph-1", subject },
      { graphId: "graph-1", subject },
    ]);
  });

  it("creates a worker authorization context from Better Auth session state", async () => {
    const context = await createWorkerAuthorizationContext({
      graphId: "graph-1",
      policyVersion: 5,
      betterAuthSession: {
        session: { id: "session-better-auth" },
        user: { id: "user-better-auth", email: "operator@example.com" },
      },
      lookupPrincipal({ graphId, subject, email }) {
        expect(graphId).toBe("graph-1");
        expect(subject).toEqual({
          issuer: "better-auth",
          provider: "user",
          providerAccountId: "user-better-auth",
          authUserId: "user-better-auth",
        });
        expect(email).toBe("operator@example.com");

        return {
          principalId: "principal-1",
          principalKind: "human",
          roleKeys: ["graph:member"],
        };
      },
    });

    expect(context).toEqual({
      graphId: "graph-1",
      principalId: "principal-1",
      principalKind: "human",
      sessionId: "session-better-auth",
      roleKeys: ["graph:member"],
      capabilityGrantIds: [],
      capabilityVersion: 0,
      policyVersion: 5,
    });
  });

  it("issues opaque bearer share tokens and stores only their hashes durably", async () => {
    const issued = await issueBearerShareToken();

    expect(isBearerShareToken(issued.token)).toBe(true);
    expect(isBearerShareTokenHash(issued.tokenHash)).toBe(true);
    expect(await hashBearerShareToken(issued.token)).toBe(issued.tokenHash);
    expect(issued.tokenHash).not.toContain(issued.token);
  });

  it("projects verified bearer share tokens into anonymous shared-read authorization contexts", async () => {
    const issued = await issueBearerShareToken();
    const context = await projectBearerShareToken({
      graphId: "graph-1",
      policyVersion: 9,
      token: issued.token,
      lookupBearerShare({ graphId, tokenHash }) {
        expect(graphId).toBe("graph-1");
        expect(tokenHash).toBe(issued.tokenHash);

        return {
          capabilityGrantIds: ["grant:bearer-share"],
        };
      },
    });

    expect(context).toEqual(
      createBearerShareAuthorizationContext({
        graphId: "graph-1",
        policyVersion: 9,
        capabilityGrantIds: ["grant:bearer-share"],
      }),
    );
  });

  it("fails closed when an authenticated subject has no graph principal projection", async () => {
    await expect(
      projectSessionToPrincipal({
        graphId: "graph-1",
        policyVersion: 2,
        session: createSession("session-missing"),
        lookupPrincipal() {
          return null;
        },
      }),
    ).rejects.toMatchObject({
      name: "SessionPrincipalProjectionError",
      code: "auth.principal_missing",
      graphId: "graph-1",
      subject,
    });
  });

  it("fails closed when a bearer share token has no active delegated grant", async () => {
    const issued = await issueBearerShareToken();

    await expect(
      projectBearerShareToken({
        graphId: "graph-1",
        policyVersion: 2,
        token: issued.token,
        lookupBearerShare() {
          return null;
        },
      }),
    ).rejects.toMatchObject({
      name: "BearerShareTokenProjectionError",
      code: "grant.invalid",
      graphId: "graph-1",
    });
  });
});
