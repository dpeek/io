import { describe, expect, it } from "bun:test";

import {
  bootstrap,
  core,
  createStore,
  createTypeClient,
  edgeId,
  fieldTreeId,
  fieldVisibility,
  fieldWritePolicy,
  isSecretBackedField,
} from "../graph/index.js";
import {
  kitchenSink,
  kitchenSinkBlock,
  kitchenSinkCompany,
  kitchenSinkPerson,
  kitchenSinkRecord,
  kitchenSinkSchema,
  kitchenSinkScore,
  kitchenSinkSecret,
  kitchenSinkSeverity,
  kitchenSinkStatus,
} from "./test.js";

describe("kitchen sink schema namespace", () => {
  it("resolves ids across types, enum members, and nested field trees", () => {
    expect(kitchenSinkSchema).toEqual({
      status: kitchenSinkStatus,
      severity: kitchenSinkSeverity,
      score: kitchenSinkScore,
      company: kitchenSinkCompany,
      block: kitchenSinkBlock,
      secret: kitchenSinkSecret,
      person: kitchenSinkPerson,
      record: kitchenSinkRecord,
    });

    expect(kitchenSink.record.values.key).toBe(kitchenSinkRecord.values.key);
    expect(typeof kitchenSink.record.values.id).toBe("string");
    expect(kitchenSink.record.fields.score.range as string).toBe(kitchenSink.score.values.id);
    expect(kitchenSink.record.fields.status.range as string).toBe(kitchenSink.status.values.id);
    expect(kitchenSink.record.fields.secret.range as string).toBe(kitchenSink.secret.values.id);
    expect(kitchenSink.status.values.inReview.key).toBe("kitchen:status.in_review");
    expect(typeof kitchenSink.status.values.inReview.id).toBe("string");
    expect(fieldTreeId(kitchenSink.record.fields.review)).toBeTruthy();
    expect(fieldTreeId(kitchenSink.record.fields.contact)).toBeTruthy();
    expect(edgeId(kitchenSink.record.fields.review.reviewer)).toBeTruthy();
    expect(edgeId(kitchenSink.record.fields.contact.email)).toBeTruthy();
  });

  it("captures metadata, validators, lifecycle hooks, and authority policies", () => {
    expect(kitchenSink.record.fields.status.meta.display.kind).toBe("badge");
    expect(kitchenSink.record.fields.reviewers.meta.collection?.kind).toBe("ordered");
    expect(kitchenSink.record.fields.tags.meta.reference.selection).toBe("existing-only");
    expect(kitchenSink.record.fields.tags.meta.reference.create).toBe(true);
    expect(kitchenSink.record.fields.tags.meta.editor?.kind).toBe("entity-reference-combobox");
    expect(kitchenSink.person.fields.confidentialNotes.meta.group).toBe("Internal");
    expect(fieldVisibility(kitchenSink.person.fields.confidentialNotes)).toBe("authority-only");
    expect(fieldWritePolicy(kitchenSink.secret.fields.version)).toBe("server-command");
    expect(isSecretBackedField(kitchenSink.record.fields.secret)).toBe(true);
    expect(typeof kitchenSink.record.fields.externalId.onCreate).toBe("function");
    expect(typeof kitchenSink.record.fields.syncedAt.onUpdate).toBe("function");

    expect(
      kitchenSinkScore.validate?.({
        event: "create",
        phase: "local",
        nodeId: "record-1",
        now: new Date("2026-01-01T00:00:00.000Z"),
        path: [],
        predicateKey: kitchenSink.record.fields.score.key,
        range: kitchenSink.record.fields.score.range,
        value: 101,
        previous: undefined,
        changedPredicateKeys: new Set<string>([kitchenSink.record.fields.score.key]),
      }),
    ).toEqual({
      code: "score.range",
      message: "Score must be between 0 and 100.",
    });

    expect(
      kitchenSinkRecord.fields.headline.validate?.({
        event: "create",
        phase: "local",
        nodeId: "record-1",
        now: new Date("2026-01-01T00:00:00.000Z"),
        path: [],
        field: "headline",
        predicateKey: kitchenSinkRecord.fields.headline.key,
        range: kitchenSinkRecord.fields.headline.range,
        cardinality: kitchenSinkRecord.fields.headline.cardinality,
        value: "missing-prefix",
        previous: undefined,
        changedPredicateKeys: new Set<string>([kitchenSinkRecord.fields.headline.key]),
      }),
    ).toEqual({
      code: "headline.prefix",
      message: "Headline must start with KS-.",
    });
  });

  it("boots cleanly through the graph client for unit tests", () => {
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, kitchenSink);
    const graph = createTypeClient(store, kitchenSink);

    const personId = graph.person.create({
      name: "Ada Lovelace",
      status: kitchenSink.status.values.inReview.id,
      email: "ada@example.com",
    });

    const secretId = graph.secret.create({
      name: "Primary API secret",
      version: 1,
    });

    const recordId = graph.record.create({
      name: "Kitchen sink fixture",
      headline: "KS-1",
      status: kitchenSink.status.values.draft.id,
      statusHistory: [kitchenSink.status.values.draft.id],
      score: 84,
      owner: personId,
      reviewers: [personId],
      secret: secretId,
      slug: "test-fixture",
      website: new URL("https://example.com"),
      contactEmail: "owner@example.com",
      published: true,
      details: "# Fixture",
    });

    const record = graph.record.get(recordId);

    expect(record).toMatchObject({
      headline: "KS-1",
      status: kitchenSink.status.values.draft.id,
      statusHistory: [kitchenSink.status.values.draft.id],
      score: 84,
      owner: personId,
      reviewers: [personId],
      secret: secretId,
      slug: "test-fixture",
      contactEmail: "owner@example.com",
      published: true,
      details: "# Fixture",
    });
    expect(record.externalId).toBe(recordId);
    expect(record.syncedAt).toBeInstanceOf(Date);
    expect(record.website).toBeInstanceOf(URL);
  });
});
