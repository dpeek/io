import { describe, expect, it } from "bun:test";

import {
  createShareGrantConstraints,
  defineAdmissionPolicy,
  defineShareGrant,
  defineShareSurface,
  defineWebPrincipalBootstrapPayload,
  defineWebPrincipalSession,
  defineWebPrincipalSummary,
  validateShareGrant,
  validateShareSurface,
  type ShareGrantCapabilityProjection,
} from "./index.js";

describe("authority contracts", () => {
  it("freezes and validates admission policy domains and role keys", () => {
    const policy = defineAdmissionPolicy({
      graphId: "graph:global",
      bootstrapMode: "first-user",
      signupPolicy: "open",
      allowedEmailDomains: ["example.com"],
      firstUserProvisioning: {
        roleKeys: ["graph:owner", "graph:authority"],
      },
      signupProvisioning: {
        roleKeys: ["graph:member"],
      },
    });

    expect(policy.allowedEmailDomains).toEqual(["example.com"]);
    expect(() =>
      defineAdmissionPolicy({
        ...policy,
        allowedEmailDomains: ["Example.com"],
      }),
    ).toThrow("allowedEmailDomains must be lowercase.");
  });

  it("validates share surfaces against shareable predicate policy", () => {
    const surface = defineShareSurface({
      surfaceId: "share:topic-summary",
      kind: "entity-predicate-slice",
      rootEntityId: "topic:1",
      predicateIds: ["topic.name", "topic.summary"],
    });

    expect(
      validateShareSurface(surface, {
        "topic.name": {
          predicateId: "topic.name",
          shareable: true,
        },
        "topic.summary": {
          predicateId: "topic.summary",
          shareable: true,
        },
      }),
    ).toEqual({ ok: true });

    expect(
      validateShareSurface(surface, {
        "topic.name": {
          predicateId: "topic.name",
          shareable: true,
        },
        "topic.summary": {
          predicateId: "topic.summary",
          shareable: false,
        },
      }),
    ).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "share.surface_invalid",
      }),
    });
  });

  it("keeps share grants aligned with their capability-grant projection", () => {
    const shareGrant = defineShareGrant({
      id: "share-grant:1",
      surface: {
        surfaceId: "share:topic-summary",
        kind: "entity-predicate-slice",
        rootEntityId: "topic:1",
        predicateIds: ["topic.name", "topic.summary"],
      },
      capabilityGrantId: "grant:1",
      status: "active",
    });

    const capabilityGrant = {
      id: "grant:1",
      resource: {
        kind: "share-surface",
        surfaceId: shareGrant.surface.surfaceId,
      },
      constraints: createShareGrantConstraints(shareGrant.surface),
      status: "active",
    } satisfies ShareGrantCapabilityProjection;

    expect(validateShareGrant(shareGrant, capabilityGrant)).toEqual({ ok: true });

    expect(
      validateShareGrant(shareGrant, {
        ...capabilityGrant,
        constraints: {
          ...capabilityGrant.constraints,
          predicateIds: ["topic.name"],
        },
      }),
    ).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "grant.invalid",
      }),
    });
  });

  it("defines the minimal ready-session bootstrap payload for an authenticated principal", () => {
    const payload = defineWebPrincipalBootstrapPayload({
      session: {
        authState: "ready",
        sessionId: "session-1",
        principalId: "principal-1",
        capabilityVersion: 3,
        displayName: "Operator",
      },
      principal: {
        graphId: "graph:global",
        principalId: "principal-1",
        principalKind: "human",
        roleKeys: ["graph:member"],
        capabilityGrantIds: ["grant-1"],
        access: {
          authority: false,
          graphMember: true,
          sharedRead: false,
        },
        capabilityVersion: 3,
        policyVersion: 5,
      },
    });

    expect(payload).toEqual({
      session: {
        authState: "ready",
        sessionId: "session-1",
        principalId: "principal-1",
        capabilityVersion: 3,
        displayName: "Operator",
      },
      principal: {
        graphId: "graph:global",
        principalId: "principal-1",
        principalKind: "human",
        roleKeys: ["graph:member"],
        capabilityGrantIds: ["grant-1"],
        access: {
          authority: false,
          graphMember: true,
          sharedRead: false,
        },
        capabilityVersion: 3,
        policyVersion: 5,
      },
    });
    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload.session)).toBe(true);
    expect(Object.isFrozen(payload.principal)).toBe(true);
    expect(Object.isFrozen(payload.principal?.access)).toBe(true);
    expect(Object.isFrozen(payload.principal?.roleKeys)).toBe(true);
    expect(Object.isFrozen(payload.principal?.capabilityGrantIds)).toBe(true);
  });

  it("rejects malformed session and summary combinations", () => {
    expect(() =>
      defineWebPrincipalSession({
        authState: "signed-out",
        sessionId: "session-1",
        principalId: null,
        capabilityVersion: null,
      }),
    ).toThrow('sessionId must be null when authState is "signed-out".');

    expect(() =>
      defineWebPrincipalSummary({
        graphId: "graph:global",
        principalId: "principal-1",
        principalKind: "anonymous",
        roleKeys: [],
        capabilityGrantIds: [],
        access: {
          authority: false,
          graphMember: false,
          sharedRead: false,
        },
        capabilityVersion: 0,
        policyVersion: 0,
      }),
    ).toThrow('principalKind must not be "anonymous" in a web principal summary.');

    expect(() =>
      defineWebPrincipalBootstrapPayload({
        session: {
          authState: "ready",
          sessionId: "session-1",
          principalId: "principal-1",
          capabilityVersion: 2,
        },
        principal: {
          graphId: "graph:global",
          principalId: "principal-2",
          principalKind: "human",
          roleKeys: [],
          capabilityGrantIds: [],
          access: {
            authority: false,
            graphMember: false,
            sharedRead: false,
          },
          capabilityVersion: 2,
          policyVersion: 0,
        },
      }),
    ).toThrow("session.principalId must match principal.principalId.");
  });
});
