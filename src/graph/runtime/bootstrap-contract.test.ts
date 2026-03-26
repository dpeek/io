import { describe, expect, it } from "bun:test";

import { createGraphClient } from "@io/graph-client";

import { bootstrap } from "./bootstrap";
import { core } from "./core";
import { createIdMap, applyIdMap } from "./identity";
import { defineType, typeId } from "./schema";
import { createStore, type GraphStoreSnapshot } from "./store";

const bootstrapTimestampIso = "2000-01-01T00:00:00.000Z";

const item = defineType({
  values: { key: "test:item", name: "Item" },
  fields: {
    ...core.node.fields,
    title: { range: core.string, cardinality: "one" },
  },
});

const testGraph = applyIdMap(createIdMap({ item }).map, { item });
const testDefs = { ...core, ...testGraph } as const;

function canonicalizeSnapshot(snapshot: GraphStoreSnapshot) {
  return {
    edges: snapshot.edges
      .map((edge) => `${edge.id}\0${edge.s}\0${edge.p}\0${edge.o}`)
      .sort((left, right) => left.localeCompare(right)),
    retracted: [...snapshot.retracted].sort((left, right) => left.localeCompare(right)),
  };
}

describe("bootstrap contract", () => {
  it("keeps schema-authored and runtime-created entities stable across restart bootstrap", () => {
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, testGraph);

    const graph = createGraphClient(store, testGraph, testDefs);
    const coreGraph = createGraphClient(store, core);
    const runtimeId = graph.item.create({ name: "Runtime Item", title: "One" });
    const runtimeEntity = graph.item.get(runtimeId);
    const schemaType = coreGraph.type.get(typeId(testGraph.item));
    const snapshotBeforeRestart = canonicalizeSnapshot(store.snapshot());

    expect(schemaType.createdAt?.toISOString()).toBe(bootstrapTimestampIso);
    expect(schemaType.updatedAt?.toISOString()).toBe(bootstrapTimestampIso);
    expect(runtimeEntity.createdAt?.toISOString()).not.toBe(bootstrapTimestampIso);
    expect(runtimeEntity.updatedAt?.toISOString()).not.toBe(bootstrapTimestampIso);

    const restartedStore = createStore(store.snapshot());
    const versionBeforeBootstrap = restartedStore.version();
    bootstrap(restartedStore, core);
    bootstrap(restartedStore, testGraph);

    const restartedGraph = createGraphClient(restartedStore, testGraph, testDefs);
    const restartedCoreGraph = createGraphClient(restartedStore, core);
    const restartedRuntimeEntity = restartedGraph.item.get(runtimeId);
    const restartedSchemaType = restartedCoreGraph.type.get(typeId(testGraph.item));

    expect(restartedStore.version()).toBe(versionBeforeBootstrap);
    expect(canonicalizeSnapshot(restartedStore.snapshot())).toEqual(snapshotBeforeRestart);
    expect(restartedRuntimeEntity.name).toBe("Runtime Item");
    expect(restartedRuntimeEntity.title).toBe("One");
    expect(restartedRuntimeEntity.createdAt?.toISOString()).toBe(
      runtimeEntity.createdAt?.toISOString(),
    );
    expect(restartedRuntimeEntity.updatedAt?.toISOString()).toBe(
      runtimeEntity.updatedAt?.toISOString(),
    );
    expect(restartedSchemaType.createdAt?.toISOString()).toBe(bootstrapTimestampIso);
    expect(restartedSchemaType.updatedAt?.toISOString()).toBe(bootstrapTimestampIso);
  });
});
