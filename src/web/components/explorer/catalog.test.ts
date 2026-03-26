import { describe, expect, it } from "bun:test";

import { bootstrap, createStore, isEntityType } from "@io/core/graph";
import { core } from "@io/core/graph/modules";
import { ops } from "@io/core/graph/modules/ops";
import { pkm } from "@io/core/graph/modules/pkm";
import { createGraphClient } from "@io/graph-client";

import { seedExampleGraph } from "../../lib/example-data.js";
import { buildEntityCatalog, buildTypeCatalog } from "./catalog.js";
import { explorerNamespace } from "./model.js";

function byKey<T extends { key: string }>(entries: readonly T[]) {
  return new Map(entries.map((entry) => [entry.key, entry]));
}

function createCatalogFixture() {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, pkm);
  bootstrap(store, ops);

  const graph = createGraphClient(store, { ...core, ...pkm, ...ops });
  seedExampleGraph(graph);

  return { graph, store };
}

describe("explorer catalog", () => {
  it("builds explorer type entries with representative counts and definitions", () => {
    const { store } = createCatalogFixture();
    const entries = buildTypeCatalog(store);
    const catalog = byKey(entries);

    expect(entries).toHaveLength(Object.values(explorerNamespace).length);
    expect(catalog.get("pkm:document")).toMatchObject({
      key: "pkm:document",
      kind: "entity",
      dataCount: 4,
    });
    expect(catalog.get("pkm:document")?.fieldDefs.map((field) => field.pathLabel)).toEqual(
      expect.arrayContaining(["description", "isArchived", "slug", "tags"]),
    );
    expect(catalog.get("core:tag")).toMatchObject({
      key: "core:tag",
      kind: "entity",
      dataCount: 2,
    });
    expect(catalog.get("pkm:documentBlock")).toMatchObject({
      key: "pkm:documentBlock",
      kind: "entity",
      dataCount: 3,
    });
    expect(catalog.get("pkm:documentPlacement")).toMatchObject({
      key: "pkm:documentPlacement",
      kind: "entity",
      dataCount: 3,
    });
    expect(catalog.get("pkm:documentBlockKind")).toMatchObject({
      key: "pkm:documentBlockKind",
      kind: "enum",
      dataCount: 0,
    });
    expect(catalog.get("pkm:documentBlockKind")?.optionDefs.length).toBeGreaterThan(0);
    expect(catalog.get("core:string")).toMatchObject({
      key: "core:string",
      kind: "scalar",
      dataCount: 0,
    });
  });

  it("builds entity entries with handles for every explorer entity type", () => {
    const { graph, store } = createCatalogFixture();
    const entries = buildEntityCatalog(graph, store);
    const catalog = byKey(entries);

    expect(entries).toHaveLength(Object.values(explorerNamespace).filter(isEntityType).length);
    expect(entries.every((entry) => entry.typeDef.kind === "entity")).toBe(true);
    expect(catalog.get("pkm:document")).toMatchObject({
      key: "pkm:document",
      count: 4,
    });
    expect(typeof catalog.get("pkm:document")?.create).toBe("function");
    expect(typeof catalog.get("pkm:document")?.validateCreate).toBe("function");
    expect(catalog.get("pkm:documentBlock")?.count).toBe(3);
    expect(catalog.get("pkm:documentPlacement")?.count).toBe(3);
    expect(catalog.get("ops:envVar")?.count).toBe(0);
    expect(catalog.get("core:icon")?.count).toBeGreaterThan(0);
    expect(catalog.get("core:tag")?.count).toBe(2);
    expect(catalog.get("core:type")?.count).toBeGreaterThan(0);
    expect(catalog.get("core:predicate")?.count).toBeGreaterThan(0);
    expect(catalog.get("core:secretHandle")?.count).toBe(0);

    const coreTypeEntry = catalog.get("core:type");
    const coreTypeId = coreTypeEntry?.ids[0];
    if (!coreTypeEntry || !coreTypeId) {
      throw new Error('Expected the catalog to expose at least one "core:type" entity.');
    }
    expect(coreTypeEntry.getRef(coreTypeId).id).toBe(coreTypeId);
  });
});
