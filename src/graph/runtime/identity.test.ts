import { describe, expect, it } from "bun:test";

import { core } from "./core";
import { createIdMap, defineNamespace } from "./identity";
import { defineEnum, defineScalar, defineType } from "./schema";

function createItemType(options: { includeSlug?: boolean } = {}) {
  const detailFields = {
    summary: { range: core.string, cardinality: "one?" as const },
  };
  if (options.includeSlug) {
    Object.assign(detailFields, {
      slug: { range: core.slug, cardinality: "one?" as const },
    });
  }

  return defineType({
    values: { key: "test:item", name: "Item" },
    fields: {
      ...core.node.fields,
      title: { range: core.string, cardinality: "one" },
      details: detailFields,
    },
  });
}

function createStatusEnum() {
  return defineEnum({
    values: { key: "test:status", name: "Status" },
    options: {
      draft: { name: "Draft" },
      published: { name: "Published" },
    },
  });
}

function createProbeScalar(key: string) {
  return defineScalar<string>({
    values: { key },
    encode: (value) => value,
    decode: (value) => value,
  });
}

describe("stable identity contracts", () => {
  it("preserves assigned ids and only prunes orphaned schema keys when requested", () => {
    const itemV1 = createItemType();
    const status = createStatusEnum();
    const initial = createIdMap({ item: itemV1, status });

    const itemV2 = createItemType({ includeSlug: true });
    const expanded = createIdMap({ item: itemV2 }, initial.map);

    for (const [key, id] of Object.entries(initial.map.keys)) {
      expect(expanded.map.keys[key]).toBe(id);
    }
    expect(expanded.added).toEqual(["test:item:details:slug"]);
    expect(expanded.removed).toEqual([]);
    expect(expanded.map.keys["test:status"]).toBe(initial.map.keys["test:status"]);

    const pruned = createIdMap({ item: itemV2 }, expanded.map, { pruneOrphans: true });

    expect(pruned.added).toEqual([]);
    expect(pruned.removed).toEqual(["test:status", "test:status.draft", "test:status.published"]);
    expect(pruned.map.keys["test:item:details:slug"]).toBe(
      expanded.map.keys["test:item:details:slug"],
    );
    expect(pruned.map.keys["test:status"]).toBeUndefined();
  });

  it("fails fast when a strict namespace is missing a schema-owned stable id", () => {
    const item = createItemType();
    const { map } = createIdMap({ item });

    delete map.keys["test:item:title"];

    expect(() => defineNamespace(map, { item })).toThrow(
      "Missing stable ids for keys: test:item:title",
    );
  });

  it("rejects duplicate stable ids before bootstrap can resolve an ambiguous namespace", () => {
    const alpha = createProbeScalar("test:alpha");
    const beta = createProbeScalar("test:beta");

    expect(() =>
      defineNamespace(
        {
          "test:alpha": "dup-id",
          "test:beta": "dup-id",
        },
        { alpha, beta },
      ),
    ).toThrow("Duplicate stable ids: dup-id (test:alpha, test:beta)");
  });
});
