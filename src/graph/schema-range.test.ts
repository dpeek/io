import { describe, expect, it } from "bun:test";

import { core, country, rangeOf, typeId } from "@io/core/graph";
import { kitchenSinkRecord, kitchenSinkStatus } from "@io/core/graph/schema/test";

import { testNamespace } from "./test-graph.js";

describe("rangeOf typing and namespace resolution", () => {
  it("keeps key-literal typing while normalizing resolved refs to ids", () => {
    const scalarRangeLiteral: "core:number" = rangeOf(core.number);
    const entityRangeLiteral: "kitchen:record" = rangeOf(kitchenSinkRecord);
    const enumRangeLiteral: "kitchen:status" = rangeOf(kitchenSinkStatus);
    const literalRange: "core:url" = rangeOf("core:url");
    const scalarRange = scalarRangeLiteral as string;
    const entityRange = entityRangeLiteral as string;
    const enumRange = enumRangeLiteral as string;

    expect(scalarRange).toBe(core.number.values.id);
    expect(entityRange).toBe(testNamespace.record.values.id);
    expect(enumRange).toBe(testNamespace.status.values.id);
    expect(literalRange).toBe("core:url");
  });

  it("resolves test namespace field ranges to stable ids", () => {
    expect(core.predicate.fields.cardinality.range as string).toBe(core.cardinality.values.id);
    expect(testNamespace.record.fields.contactEmail.range as string).toBe(core.email.values.id);
    expect(testNamespace.record.fields.status.range as string).toBe(testNamespace.status.values.id);
    expect(testNamespace.record.fields.estimate.range as string).toBe(core.number.values.id);
    expect(testNamespace.record.fields.slug.range as string).toBe(core.slug.values.id);
    expect(testNamespace.record.fields.tags.range as string).toBe(core.tag.values.id);
    expect(testNamespace.record.fields.website.range as string).toBe(core.url.values.id);
    expect(testNamespace.record.fields.owner.range as string).toBe(testNamespace.person.values.id);
  });

  it("resolves enum option ids from namespace id map", () => {
    expect(testNamespace.status.values.draft.key).toBe("kitchen:status.draft");
    expect(testNamespace.status.values.inReview.key).toBe("kitchen:status.in_review");
    expect(testNamespace.status.values.draft.id).toBeTruthy();
    expect(testNamespace.status.values.inReview.id).toBeTruthy();
    expect(testNamespace.status.values.draft.id).not.toBe(testNamespace.status.values.inReview.id);
  });

  it("does not confuse enum option aliases named id with resolved type ids", () => {
    expect(typeId(country)).toBe("core:country");
    expect(rangeOf(country)).toBe("core:country");
    expect(country.values.id.key).toBe("core:country.id");
  });
});
