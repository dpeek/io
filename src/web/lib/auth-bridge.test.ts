import { describe, expect, it } from "bun:test";

import type { AuthSubjectRef, AuthenticatedSession } from "@io/core/graph";

import { createAnonymousAuthorizationContext, projectSessionToPrincipal } from "./auth-bridge.js";

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
});
