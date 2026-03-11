import { describe, expect, it } from "bun:test";
import { address } from "../type/address/index.js";
import { booleanTypeModule } from "../type/boolean/index.js";
import { stringTypeModule } from "../type/string/index.js";
import { app } from "./app";
import { core } from "./core";

describe("type-module authoring contract", () => {
  it("composes scalar defaults with field-level overrides", () => {
    expect(core.node.fields.description.range as string).toBe(core.string.values.id);
    expect(core.node.fields.description.meta.display.kind).toBe("text");
    expect(core.node.fields.description.meta.editor.kind).toBe("textarea");
    expect(core.node.fields.description.meta.editor.multiline).toBe(true);
    expect(core.node.fields.description.meta.editor.placeholder).toBe("Enter text");
    expect(core.node.fields.description.filter.defaultOperator).toBe("contains");
    expect(Object.keys(core.node.fields.description.filter.operators)).toEqual([
      "contains",
      "equals",
    ]);
  });

  it("keeps authored enum and scalar capabilities attached to resolved app fields", () => {
    expect(app.company.fields.status.range as string).toBe(app.status.values.id);
    expect(app.company.fields.status.meta.display.kind).toBe("badge");
    expect(app.company.fields.status.filter.defaultOperator).toBe("is");
    expect(Object.keys(app.company.fields.status.filter.operators)).toEqual(["is"]);
    expect(app.company.fields.tags.meta.collection?.kind).toBe("unordered");
    expect(app.company.fields.tags.meta.editor.kind).toBe("token-list");
    expect(app.company.fields.tags.meta.editor.placeholder).toBe("Enter text");
    expect(app.company.fields.website.meta.display.kind).toBe("external-link");
    expect(app.company.fields.contactEmail.range as string).toBe(core.email.values.id);
    expect(app.company.fields.contactEmail.meta.editor.kind).toBe("text");
    expect(app.company.fields.contactEmail.meta.editor.inputType).toBe("email");
    expect(app.company.fields.contactEmail.meta.editor.parse?.("TEAM@ACME.COM")).toBe(
      "team@acme.com",
    );
    expect(app.company.fields.contactEmail.filter.defaultOperator).toBe("domain");
    expect(Object.keys(app.company.fields.contactEmail.filter.operators)).toEqual([
      "equals",
      "domain",
    ]);
    expect(app.company.fields.slug.range as string).toBe(core.slug.values.id);
    expect(app.company.fields.slug.meta.editor.placeholder).toBe("company-slug");
    expect(app.company.fields.slug.meta.editor.parse?.("Acme Labs")).toBe("acme-labs");
    expect(app.company.fields.slug.filter.defaultOperator).toBe("prefix");
    expect(Object.keys(app.company.fields.slug.filter.operators)).toEqual(["equals", "prefix"]);
  });

  it("attaches boolean defaults through the migrated scalar module", () => {
    expect(app.block.fields.collapsed.range as string).toBe(core.boolean.values.id);
    expect(app.block.fields.collapsed.meta.display.kind).toBe("boolean");
    expect(app.block.fields.collapsed.meta.editor.kind).toBe("checkbox");
    expect(app.block.fields.collapsed.filter.defaultOperator).toBe("is");
    expect(Object.keys(app.block.fields.collapsed.filter.operators)).toEqual(["is"]);
  });

  it("attaches date and enum defaults to the remaining built-in fields", () => {
    expect(core.node.fields.createdAt.range as string).toBe(core.date.values.id);
    expect(core.node.fields.createdAt.meta.display.kind).toBe("date");
    expect(core.node.fields.createdAt.meta.editor.kind).toBe("date");
    expect(core.node.fields.createdAt.filter.defaultOperator).toBe("on");
    expect(Object.keys(core.node.fields.createdAt.filter.operators)).toEqual([
      "on",
      "before",
      "after",
    ]);

    expect(core.predicate.fields.cardinality.range as string).toBe(core.cardinality.values.id);
    expect(core.predicate.fields.cardinality.meta.editor.kind).toBe("select");
    expect(core.predicate.fields.cardinality.filter.defaultOperator).toBe("is");
    expect(Object.keys(core.predicate.fields.cardinality.filter.operators)).toEqual(["is"]);
  });

  it("uses the reference-field helpers for entity relationships", () => {
    expect(app.person.fields.worksAt.range as string).toBe(app.company.values.id);
    expect(app.person.fields.worksAt.meta.reference.selection).toBe("existing-only");
    expect(app.block.fields.parent.range as string).toBe(app.block.values.id);

    expect(address.fields.country.range as string).toBe("core:country");
    expect(address.fields.country.meta.display.kind).toBe("text");
    expect(address.fields.country.meta.editor.kind).toBe("select");
    expect(address.fields.country.filter.defaultOperator).toBe("is");
  });

  it("falls back to the first allowed operator when a narrowed field omits a default", () => {
    const narrowed = stringTypeModule.field({
      cardinality: "one",
      filter: {
        operators: ["equals"] as const,
      },
    });

    expect(narrowed.filter.defaultOperator).toBe("equals");
    expect(Object.keys(narrowed.filter.operators)).toEqual(["equals"]);
  });

  it("keeps boolean filter defaults typed when field operators are narrowed", () => {
    const narrowed = booleanTypeModule.field({
      cardinality: "one?",
      filter: {
        operators: ["isNot"] as const,
      },
    });

    expect(narrowed.filter.defaultOperator).toBe("isNot");
    expect(Object.keys(narrowed.filter.operators)).toEqual(["isNot"]);
  });
});
