import { describe, expect, it } from "bun:test";

import { createStore, isEntityType } from "@io/core/graph";
import { bootstrap } from "@io/graph-bootstrap";
import { createGraphClient } from "@io/graph-client";
import { core, coreGraphBootstrapOptions } from "@io/graph-module-core";
import { workflow } from "@io/graph-module-workflow";

import { seedExampleGraph } from "../../lib/example-data.js";
import { buildEntityCatalog, buildTypeCatalog } from "./catalog.js";
import { explorerNamespace } from "./model.js";

function byKey<T extends { key: string }>(entries: readonly T[]) {
  return new Map(entries.map((entry) => [entry.key, entry]));
}

function createCatalogFixture() {
  const store = createStore();
  bootstrap(store, core, coreGraphBootstrapOptions);
  bootstrap(store, workflow, coreGraphBootstrapOptions);

  const graph = createGraphClient(store, { ...core, ...workflow });
  seedExampleGraph(graph);

  return { graph, store };
}

describe("explorer catalog", () => {
  it("builds explorer type entries with representative counts and definitions", () => {
    const { store } = createCatalogFixture();
    const entries = buildTypeCatalog(store);
    const catalog = byKey(entries);

    expect(entries).toHaveLength(Object.values(explorerNamespace).length);
    expect(catalog.get("workflow:document")).toMatchObject({
      key: "workflow:document",
      kind: "entity",
      dataCount: 4,
    });
    expect(catalog.get("workflow:document")?.fieldDefs.map((field) => field.pathLabel)).toEqual(
      expect.arrayContaining(["description", "isArchived", "slug", "tags"]),
    );
    expect(catalog.get("core:tag")).toMatchObject({
      key: "core:tag",
      kind: "entity",
      dataCount: 2,
    });
    expect(catalog.get("workflow:documentBlock")).toMatchObject({
      key: "workflow:documentBlock",
      kind: "entity",
      dataCount: 3,
    });
    expect(catalog.get("workflow:documentPlacement")).toMatchObject({
      key: "workflow:documentPlacement",
      kind: "entity",
      dataCount: 3,
    });
    expect(catalog.get("workflow:documentBlockKind")).toMatchObject({
      key: "workflow:documentBlockKind",
      kind: "enum",
      dataCount: 0,
    });
    expect(catalog.get("workflow:documentBlockKind")?.optionDefs.length).toBeGreaterThan(0);
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
    expect(catalog.get("workflow:document")).toMatchObject({
      key: "workflow:document",
      count: 4,
    });
    expect(typeof catalog.get("workflow:document")?.create).toBe("function");
    expect(typeof catalog.get("workflow:document")?.validateCreate).toBe("function");
    expect(catalog.get("workflow:documentBlock")?.count).toBe(3);
    expect(catalog.get("workflow:documentPlacement")?.count).toBe(3);
    expect(catalog.get("workflow:envVar")?.count).toBe(0);
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
