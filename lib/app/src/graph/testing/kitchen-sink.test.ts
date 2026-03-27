import { describe, expect, it } from "bun:test";

import { bootstrap } from "@io/graph-bootstrap";
import { createGraphClient } from "@io/graph-client";
import { core, coreGraphBootstrapOptions, defaultMoneyCurrencyKey } from "@io/graph-module-core";

import {
  createStore,
  edgeId,
  fieldTreeId,
  fieldVisibility,
  fieldWritePolicy,
  isSecretBackedField,
} from "../index.js";
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
} from "./kitchen-sink.js";

const kitchenSinkDefs = { ...core, ...kitchenSink } as const;

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
    expect(kitchenSink.record.fields.completion.range as string).toBe(core.percent.values.id);
    expect(kitchenSink.record.fields.duration.range as string).toBe(core.duration.values.id);
    expect(kitchenSink.record.fields.quantity.range as string).toBe(core.quantity.values.id);
    expect(kitchenSink.record.fields.budget.range as string).toBe(core.money.values.id);
    expect(kitchenSink.record.fields.burnRate.range as string).toBe(core.rate.values.id);
    expect(kitchenSink.record.fields.completionBand.range as string).toBe(core.range.values.id);
    expect(kitchenSink.record.fields.quantityBand.range as string).toBe(core.range.values.id);
    expect(kitchenSink.record.fields.estimate.range as string).toBe(core.duration.values.id);
    expect(kitchenSink.record.fields.status.range as string).toBe(kitchenSink.status.values.id);
    expect(kitchenSink.record.fields.secret.range as string).toBe(kitchenSink.secret.values.id);
    expect(kitchenSink.record.fields.budgetBand.range as string).toBe(core.range.values.id);
    expect(kitchenSink.status.values.inReview.key).toBe("kitchen:status.in_review");
    expect(typeof kitchenSink.status.values.inReview.id).toBe("string");
    expect(fieldTreeId(kitchenSink.record.fields.review)).toBeTruthy();
    expect(fieldTreeId(kitchenSink.record.fields.contact)).toBeTruthy();
    expect(edgeId(kitchenSink.record.fields.review.reviewer)).toBeTruthy();
    expect(edgeId(kitchenSink.record.fields.contact.email)).toBeTruthy();
  });

  it("captures metadata, validators, lifecycle hooks, and authority policies", () => {
    expect(kitchenSink.record.fields.status.meta.display.kind).toBe("badge");
    expect(kitchenSink.record.fields.completion.meta.display.kind).toBe("number/percent");
    expect(kitchenSink.record.fields.completion.meta.editor.kind).toBe("number/percent");
    expect(kitchenSink.record.fields.duration.meta.display.kind).toBe("number/duration");
    expect(kitchenSink.record.fields.duration.meta.editor.kind).toBe("number/duration");
    expect(kitchenSink.record.fields.estimate.meta.display.kind).toBe("number/duration");
    expect(kitchenSink.record.fields.estimate.meta.editor.kind).toBe("number/duration");
    expect(kitchenSink.record.fields.quantity.meta.display.kind).toBe("number/quantity");
    expect(kitchenSink.record.fields.quantity.meta.editor.kind).toBe("number/quantity");
    expect(kitchenSink.record.fields.budget.meta.display.kind).toBe("money/amount");
    expect(kitchenSink.record.fields.budget.meta.editor.kind).toBe("money/amount");
    expect(kitchenSink.record.fields.burnRate.meta.display.kind).toBe("number/rate");
    expect(kitchenSink.record.fields.burnRate.meta.editor.kind).toBe("number/rate");
    expect(kitchenSink.record.fields.completionBand.meta.display.kind).toBe("number/range");
    expect(kitchenSink.record.fields.completionBand.meta.editor.kind).toBe("number/range");
    expect(kitchenSink.record.fields.quantityBand.meta.display.kind).toBe("number/range");
    expect(kitchenSink.record.fields.quantityBand.meta.editor.kind).toBe("number/range");
    expect(kitchenSink.record.fields.budgetBand.meta.display.kind).toBe("number/range");
    expect(kitchenSink.record.fields.budgetBand.meta.editor.kind).toBe("number/range");
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
    bootstrap(store, core, coreGraphBootstrapOptions);
    bootstrap(store, kitchenSink, coreGraphBootstrapOptions);
    const graph = createGraphClient(store, kitchenSink, kitchenSinkDefs);

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
      completion: 72.5,
      duration: 90_000,
      estimate: 1_800_000,
      quantity: { amount: 12.5, unit: "kg" },
      budget: { amount: 1250, currency: defaultMoneyCurrencyKey },
      burnRate: {
        numerator: {
          kind: "money",
          value: { amount: 1250, currency: defaultMoneyCurrencyKey },
        },
        denominator: {
          kind: "duration",
          value: 86_400_000,
        },
      },
      completionBand: {
        kind: "percent",
        min: 10,
        max: 80,
      },
      quantityBand: {
        kind: "quantity",
        min: { amount: 10, unit: "kg" },
        max: { amount: 25, unit: "kg" },
      },
      budgetBand: {
        kind: "money",
        min: { amount: 1500, currency: defaultMoneyCurrencyKey },
        max: { amount: 3000, currency: defaultMoneyCurrencyKey },
      },
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
      completion: 72.5,
      duration: 90_000,
      estimate: 1_800_000,
      quantity: { amount: 12.5, unit: "kg" },
      budget: { amount: 1250, currency: defaultMoneyCurrencyKey },
      burnRate: {
        numerator: {
          kind: "money",
          value: { amount: 1250, currency: defaultMoneyCurrencyKey },
        },
        denominator: {
          kind: "duration",
          value: 86_400_000,
        },
      },
      completionBand: {
        kind: "percent",
        min: 10,
        max: 80,
      },
      quantityBand: {
        kind: "quantity",
        min: { amount: 10, unit: "kg" },
        max: { amount: 25, unit: "kg" },
      },
      budgetBand: {
        kind: "money",
        min: { amount: 1500, currency: defaultMoneyCurrencyKey },
        max: { amount: 3000, currency: defaultMoneyCurrencyKey },
      },
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
