import { describe, expect, it } from "bun:test";

import {
  defineAdmissionPolicy,
  createShareGrantConstraints,
  defineShareGrant,
  defineShareSurface,
  validateShareGrant,
  validateShareSurface,
  type ShareGrantCapabilityProjection,
  type ShareSurfacePolicy,
} from "./contracts.js";

describe("admission policy runtime contracts", () => {
  it("defines the minimal graph-owned admission policy for bootstrap and self-signup", () => {
    const policy = defineAdmissionPolicy({
      graphId: "graph:global",
      bootstrapMode: "first-user",
      signupPolicy: "open",
      allowedEmailDomains: ["example.com", "io.test"],
      firstUserProvisioning: {
        roleKeys: ["graph:owner", "graph:authority"],
      },
      signupProvisioning: {
        roleKeys: ["graph:member"],
      },
    });

    expect(policy).toEqual({
      graphId: "graph:global",
      bootstrapMode: "first-user",
      signupPolicy: "open",
      allowedEmailDomains: ["example.com", "io.test"],
      firstUserProvisioning: {
        roleKeys: ["graph:owner", "graph:authority"],
      },
      signupProvisioning: {
        roleKeys: ["graph:member"],
      },
    });
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.allowedEmailDomains)).toBe(true);
    expect(Object.isFrozen(policy.firstUserProvisioning)).toBe(true);
    expect(Object.isFrozen(policy.firstUserProvisioning.roleKeys)).toBe(true);
    expect(Object.isFrozen(policy.signupProvisioning)).toBe(true);
    expect(Object.isFrozen(policy.signupProvisioning.roleKeys)).toBe(true);
  });

  it("rejects malformed admission policy combinations", () => {
    expect(() =>
      defineAdmissionPolicy({
        graphId: "graph:global",
        bootstrapMode: "first-user",
        signupPolicy: "closed",
        allowedEmailDomains: ["Example.com"],
        firstUserProvisioning: {
          roleKeys: ["graph:owner"],
        },
        signupProvisioning: {
          roleKeys: [],
        },
      }),
    ).toThrow("allowedEmailDomains must be lowercase.");

    expect(() =>
      defineAdmissionPolicy({
        graphId: "graph:global",
        bootstrapMode: "first-user",
        signupPolicy: "closed",
        allowedEmailDomains: [],
        firstUserProvisioning: {
          roleKeys: [],
        },
        signupProvisioning: {
          roleKeys: [],
        },
      }),
    ).toThrow(
      'firstUserProvisioning.roleKeys must not be empty when bootstrapMode is "first-user".',
    );

    expect(() =>
      defineAdmissionPolicy({
        graphId: "graph:global",
        bootstrapMode: "manual",
        signupPolicy: "open",
        allowedEmailDomains: [],
        firstUserProvisioning: {
          roleKeys: [],
        },
        signupProvisioning: {
          roleKeys: [],
        },
      }),
    ).toThrow('signupProvisioning.roleKeys must not be empty when signupPolicy is "open".');
  });
});

const topicNamePolicy = {
  predicateId: "pkm:topic.name",
  shareable: true,
} satisfies ShareSurfacePolicy;

const topicSummaryPolicy = {
  predicateId: "pkm:topic.summary",
  shareable: true,
} satisfies ShareSurfacePolicy;

const topicSecretPolicy = {
  predicateId: "pkm:topic.secretNotes",
  shareable: false,
} satisfies ShareSurfacePolicy;

describe("share surface runtime contracts", () => {
  it("defines the minimal entity-predicate share surface and aligned grant constraints", () => {
    const surface = defineShareSurface({
      surfaceId: "share:topic-1:summary",
      kind: "entity-predicate-slice",
      rootEntityId: "topic-1",
      predicateIds: [topicNamePolicy.predicateId, topicSummaryPolicy.predicateId],
    });

    expect(surface).toEqual({
      surfaceId: "share:topic-1:summary",
      kind: "entity-predicate-slice",
      rootEntityId: "topic-1",
      predicateIds: [topicNamePolicy.predicateId, topicSummaryPolicy.predicateId],
    });
    expect(Object.isFrozen(surface)).toBe(true);
    expect(Object.isFrozen(surface.predicateIds)).toBe(true);
    expect(createShareGrantConstraints(surface)).toEqual({
      rootEntityId: "topic-1",
      predicateIds: [topicNamePolicy.predicateId, topicSummaryPolicy.predicateId],
    });

    expect(() =>
      defineShareSurface({
        surfaceId: "share:topic-1:invalid",
        kind: "entity-predicate-slice",
        rootEntityId: "topic-1",
        predicateIds: [topicNamePolicy.predicateId, topicNamePolicy.predicateId],
      }),
    ).toThrow("predicateIds must not contain duplicate values.");
  });

  it("rejects predicates that are not explicitly shareable", () => {
    const result = validateShareSurface(
      {
        surfaceId: "share:topic-1:private",
        kind: "entity-predicate-slice",
        rootEntityId: "topic-1",
        predicateIds: [topicNamePolicy.predicateId, topicSecretPolicy.predicateId],
      },
      new Map<string, ShareSurfacePolicy>([
        [topicNamePolicy.predicateId, topicNamePolicy],
        [topicSecretPolicy.predicateId, topicSecretPolicy],
      ]),
    );

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "share.surface_invalid",
      }),
    });
  });

  it("requires linked capability grants to mirror the durable share surface selector", () => {
    const shareGrant = defineShareGrant({
      id: "share-grant-1",
      surface: {
        surfaceId: "share:topic-1:summary",
        kind: "entity-predicate-slice",
        rootEntityId: "topic-1",
        predicateIds: [topicNamePolicy.predicateId, topicSummaryPolicy.predicateId],
      },
      capabilityGrantId: "grant-share-1",
      status: "active",
    });

    const capabilityGrant: ShareGrantCapabilityProjection = {
      id: shareGrant.capabilityGrantId,
      resource: {
        kind: "share-surface",
        surfaceId: shareGrant.surface.surfaceId,
      },
      constraints: createShareGrantConstraints(shareGrant.surface),
      status: "active",
    };

    expect(validateShareGrant(shareGrant, capabilityGrant)).toEqual({ ok: true });

    expect(
      validateShareGrant(shareGrant, {
        ...capabilityGrant,
        constraints: {
          ...capabilityGrant.constraints,
          predicateIds: [topicNamePolicy.predicateId],
        },
      }),
    ).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "grant.invalid",
      }),
    });
  });
});
