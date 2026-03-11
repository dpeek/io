import { describe, expect, it } from "bun:test";
import { country } from "../type/country/index.js";
import { app, company, status } from "./app";
import { core } from "./core";
import { rangeOf, typeId } from "./schema";

describe("rangeOf typing and namespace resolution", () => {
  it("keeps key-literal typing while normalizing resolved refs to ids", () => {
    const scalarRangeLiteral: "core:number" = rangeOf(core.number);
    const entityRangeLiteral: "app:company" = rangeOf(company);
    const enumRangeLiteral: "app:status" = rangeOf(status);
    const literalRange: "core:url" = rangeOf("core:url");
    const scalarRange = scalarRangeLiteral as string;
    const entityRange = entityRangeLiteral as string;
    const enumRange = enumRangeLiteral as string;

    expect(scalarRange).toBe(core.number.values.id);
    expect(entityRange).toBe(app.company.values.id);
    expect(enumRange).toBe(app.status.values.id);
    expect(literalRange).toBe("core:url");
  });

  it("resolves app field ranges to stable ids", () => {
    expect(core.predicate.fields.cardinality.range as string).toBe(core.cardinality.values.id);
    expect(app.company.fields.contactEmail.range as string).toBe(core.email.values.id);
    expect(app.company.fields.status.range as string).toBe(app.status.values.id);
    expect(app.company.fields.foundedYear.range as string).toBe(core.number.values.id);
    expect(app.company.fields.slug.range as string).toBe(core.slug.values.id);
    expect(app.company.fields.tags.range as string).toBe(core.string.values.id);
    expect(app.company.fields.website.range as string).toBe(core.url.values.id);
    expect(app.person.fields.worksAt.range as string).toBe(app.company.values.id);
  });

  it("resolves enum option ids from namespace id map", () => {
    expect(app.status.values.active.key).toBe("app:status.active");
    expect(app.status.values.paused.key).toBe("app:status.paused");
    expect(app.status.values.active.id).toBeTruthy();
    expect(app.status.values.paused.id).toBeTruthy();
    expect(app.status.values.active.id).not.toBe(app.status.values.paused.id);
  });

  it("does not confuse enum option aliases named id with resolved type ids", () => {
    expect(typeId(country)).toBe("core:country");
    expect(rangeOf(country)).toBe("core:country");
    expect(country.values.id.key).toBe("core:country.id");
  });
});
