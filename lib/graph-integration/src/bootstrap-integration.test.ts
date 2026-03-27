import { describe, expect, it } from "bun:test";

import { bootstrap, createBootstrappedSnapshot } from "@io/graph-bootstrap";
import { createGraphStore, typeId, type GraphStoreSnapshot } from "@io/graph-kernel";
import { defineType } from "@io/graph-module";
import {
  core,
  coreGraphBootstrapOptions,
  resolveDefinitionIconId,
  stringTypeModule,
} from "@io/graph-module-core";
import { createGraphClient } from "@io/graph-client";

const bootstrapTimestampIso = "2000-01-01T00:00:00.000Z";
const item = defineType({
  values: { key: "test:item", name: "Item" },
  fields: {
    ...core.node.fields,
    title: stringTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Title",
      },
    }),
  },
});
const testGraph = { item } as const;
const testDefs = { ...core, ...testGraph } as const;
const stringIconId = resolveDefinitionIconId(stringTypeModule.type.values.icon);

function canonicalizeSnapshot(snapshot: GraphStoreSnapshot) {
  return {
    edges: snapshot.edges
      .map((edge) => `${edge.id}\0${edge.s}\0${edge.p}\0${edge.o}`)
      .sort((left, right) => left.localeCompare(right)),
    retracted: [...snapshot.retracted].sort((left, right) => left.localeCompare(right)),
  };
}

describe("graph-client bootstrap integration", () => {
  it("keeps schema-authored and runtime-created entities stable across restart bootstrap", () => {
    const store = createGraphStore();
    bootstrap(store, core, coreGraphBootstrapOptions);
    bootstrap(store, testGraph, coreGraphBootstrapOptions);

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

    const restartedStore = createGraphStore(store.snapshot());
    const versionBeforeBootstrap = restartedStore.version();
    bootstrap(restartedStore, core, coreGraphBootstrapOptions);
    bootstrap(restartedStore, testGraph, coreGraphBootstrapOptions);

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

  it("builds graph clients from bootstrapped live stores", () => {
    const store = createGraphStore();

    bootstrap(store, core, coreGraphBootstrapOptions);
    bootstrap(store, testGraph, coreGraphBootstrapOptions);

    const graph = createGraphClient(store, testDefs);
    const runtimeId = graph.item.create({ name: "Example Item", title: "One" });

    expect(graph.type.get(typeId(testGraph.item)).createdAt?.toISOString()).toBe(
      bootstrapTimestampIso,
    );
    expect(graph.item.get(runtimeId).title).toBe("One");
  });

  it("builds graph clients from bootstrapped snapshots with caller-supplied options", () => {
    const snapshot = createBootstrappedSnapshot(testDefs, coreGraphBootstrapOptions);
    const store = createGraphStore(snapshot);
    const graph = createGraphClient(store, testDefs);

    expect(graph.type.get(typeId(testGraph.item)).createdAt?.toISOString()).toBe(
      bootstrapTimestampIso,
    );
    expect(graph.icon.get(stringIconId).svg).toContain("<svg");
  });
});
