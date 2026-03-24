import { describe, expect, it } from "bun:test";

import {
  createShareGrantConstraints,
  defineShareGrant,
  defineShareSurface,
  validateShareGrant,
  validateShareSurface,
  type ShareGrantCapabilityProjection,
  type ShareSurfacePolicy,
} from "./contracts.js";

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
