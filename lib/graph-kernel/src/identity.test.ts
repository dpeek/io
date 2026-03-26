import { describe, expect, it } from "bun:test";

import { applyIdMap, createIdMap, extractSchemaKeys } from "./identity.js";
import { defineEnum, defineScalar, defineType, edgeId, typeId } from "./schema.js";

const sharedString = defineScalar<string>({
  values: { key: "shared:string" },
  encode: (value) => value,
  decode: (value) => value,
});

const sharedSlug = defineScalar<string>({
  values: { key: "shared:slug" },
  encode: (value) => value,
  decode: (value) => value,
});

function createItemType(options: { includeSlug?: boolean } = {}) {
  const detailFields = {
    summary: { range: sharedString, cardinality: "one?" as const },
  };
  if (options.includeSlug) {
    Object.assign(detailFields, {
      slug: { range: sharedSlug, cardinality: "one?" as const },
    });
  }

  return defineType({
    values: { key: "test:item", name: "Item" },
    fields: {
      title: { range: sharedString, cardinality: "one" },
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

    expect(() => applyIdMap(map, { item })).toThrow("Missing stable ids for keys: test:item:title");
  });

  it("rejects duplicate stable ids before bootstrap can resolve an ambiguous namespace", () => {
    const alpha = createProbeScalar("test:alpha");
    const beta = createProbeScalar("test:beta");

    expect(() =>
      applyIdMap(
        {
          "test:alpha": "dup-id",
          "test:beta": "dup-id",
        },
        { alpha, beta },
      ),
    ).toThrow("Duplicate stable ids: dup-id (test:alpha, test:beta)");
  });

  it("filters foreign range keys out of the owned schema key set", () => {
    const item = createItemType({ includeSlug: true });

    expect(extractSchemaKeys({ item })).toEqual([
      "test:item",
      "test:item:details",
      "test:item:details:slug",
      "test:item:details:summary",
      "test:item:title",
    ]);
  });

  it("mutates the provided namespace in place and can tolerate missing ids when strict is disabled", () => {
    const item = createItemType();
    const namespace = { item };
    const { map } = createIdMap(namespace);

    delete map.keys["test:item:title"];

    const resolved = applyIdMap(map, namespace, { strict: false });

    expect(resolved as unknown).toBe(namespace);
    expect(resolved.item as unknown).toBe(item);
    expect(typeId(item)).toBe(map.keys["test:item"]!);
    expect(edgeId(item.fields.title)).toBe("test:item:title");
  });
});
