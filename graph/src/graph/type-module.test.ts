import { describe, expect, it } from "bun:test";
import { app } from "./app";
import { core } from "./core";
import { booleanTypeModule } from "../type/boolean.js";
import { stringTypeModule } from "../type/string.js";

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
  });

  it("attaches boolean defaults through the migrated scalar module", () => {
    expect(app.block.fields.collapsed.range as string).toBe(core.boolean.values.id);
    expect(app.block.fields.collapsed.meta.display.kind).toBe("boolean");
    expect(app.block.fields.collapsed.meta.editor.kind).toBe("checkbox");
    expect(app.block.fields.collapsed.filter.defaultOperator).toBe("is");
    expect(Object.keys(app.block.fields.collapsed.filter.operators)).toEqual(["is"]);
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
