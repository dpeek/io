import { describe, expect, it } from "bun:test";

import {
  address,
  booleanTypeModule,
  colorTypeModule,
  core,
  stringTypeModule,
} from "@io/graph-module-core";

import { testNamespace } from "./test-graph.js";

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

  it("keeps authored enum and scalar capabilities attached to resolved test fields", () => {
    expect(testNamespace.record.fields.status.range as string).toBe(testNamespace.status.values.id);
    expect(testNamespace.record.fields.status.meta.display.kind).toBe("badge");
    expect(testNamespace.record.fields.status.filter.defaultOperator).toBe("is");
    expect(Object.keys(testNamespace.record.fields.status.filter.operators)).toEqual(["is"]);
    expect(testNamespace.record.fields.tags.meta.collection?.kind).toBe("unordered");
    expect(testNamespace.record.fields.tags.meta.reference.selection).toBe("existing-only");
    expect(testNamespace.record.fields.tags.meta.reference.create).toBe(true);
    expect(testNamespace.record.fields.website.meta.display.kind).toBe("external-link");
    expect(testNamespace.record.fields.contactEmail.range as string).toBe(core.email.values.id);
    expect(testNamespace.record.fields.contactEmail.meta.editor.kind).toBe("text");
    expect(testNamespace.record.fields.contactEmail.meta.editor.inputType).toBe("email");
    expect(testNamespace.record.fields.contactEmail.meta.editor.parse?.("TEAM@ACME.COM")).toBe(
      "team@acme.com",
    );
    expect(testNamespace.record.fields.contactEmail.filter.defaultOperator).toBe("domain");
    expect(Object.keys(testNamespace.record.fields.contactEmail.filter.operators)).toEqual([
      "equals",
      "domain",
    ]);
    expect(testNamespace.record.fields.slug.range as string).toBe(core.slug.values.id);
    expect(testNamespace.record.fields.slug.meta.editor.placeholder).toBe("company-slug");
    expect(testNamespace.record.fields.slug.meta.editor.parse?.("Acme Labs")).toBe("acme-labs");
    expect(testNamespace.record.fields.slug.filter.defaultOperator).toBe("prefix");
    expect(Object.keys(testNamespace.record.fields.slug.filter.operators)).toEqual([
      "equals",
      "prefix",
    ]);
  });

  it("attaches boolean defaults through the migrated scalar module", () => {
    expect(testNamespace.record.fields.archived.range as string).toBe(core.boolean.values.id);
    expect(testNamespace.record.fields.archived.meta.display.kind).toBe("boolean");
    expect(testNamespace.record.fields.archived.meta.editor.kind).toBe("checkbox");
    expect(testNamespace.record.fields.archived.filter.defaultOperator).toBe("is");
    expect(Object.keys(testNamespace.record.fields.archived.filter.operators)).toEqual([
      "is",
      "isNot",
    ]);
  });

  it("attaches date and enum defaults to the remaining built-in fields", () => {
    expect(core.node.fields.createdAt.range as string).toBe(core.date.values.id);
    expect(core.node.fields.createdAt.meta.display.kind).toBe("date");
    expect(core.node.fields.createdAt.meta.editor.kind).toBe("date");
    expect(core.node.fields.createdAt.createOptional).toBe(true);
    expect(core.node.fields.createdAt.filter.defaultOperator).toBe("on");
    expect(Object.keys(core.node.fields.createdAt.filter.operators)).toEqual([
      "on",
      "before",
      "after",
    ]);
    expect(core.node.fields.updatedAt.createOptional).toBe(true);

    expect(core.predicate.fields.cardinality.range as string).toBe(core.cardinality.values.id);
    expect(core.predicate.fields.cardinality.meta.editor.kind).toBe("select");
    expect(core.predicate.fields.cardinality.filter.defaultOperator).toBe("is");
    expect(Object.keys(core.predicate.fields.cardinality.filter.operators)).toEqual(["is"]);
  });

  it("attaches color defaults to migrated schema fields", () => {
    expect(colorTypeModule.type.values.key).toBe(core.color.values.key);
    expect(testNamespace.record.fields.accentColor.range as string).toBe(core.color.values.id);
    expect(testNamespace.record.fields.accentColor.meta.editor.kind).toBe("color");
    expect(testNamespace.record.fields.accentColor.meta.editor.parse?.(" #2563EB ")).toBe(
      "#2563eb",
    );
  });

  it("uses the reference-field helpers for entity relationships", () => {
    expect(testNamespace.person.fields.manager.range as string).toBe(
      testNamespace.person.values.id,
    );
    expect(testNamespace.person.fields.manager.meta.reference.selection).toBe("existing-only");
    expect(testNamespace.record.fields.parent.range as string).toBe(testNamespace.record.values.id);

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
