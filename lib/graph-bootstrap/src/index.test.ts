import { describe, expect, it } from "bun:test";

import { createGraphClient } from "@io/graph-client";
import { createGraphStore, edgeId, typeId, type GraphStoreSnapshot } from "@io/graph-kernel";
import { applyGraphIdMap as applyIdMap, createGraphIdMap as createIdMap } from "@io/graph-kernel";
import { defineType } from "@io/graph-kernel";

import {
  core,
  coreGraphBootstrapOptions,
  graphIconSeeds,
  pkm,
} from "../../../src/graph/modules/index.js";
import * as graphBootstrap from "./index.js";

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

describe("graph-bootstrap package surface", () => {
  it("publishes canonical bootstrap factories and contracts", () => {
    expect(Object.keys(graphBootstrap)).toEqual(
      expect.arrayContaining([
        "bootstrap",
        "createBootstrappedSnapshot",
        "requireGraphBootstrapCoreSchema",
      ]),
    );
  });
});

describe("graph-bootstrap contract", () => {
  it("keeps schema-authored and runtime-created entities stable across restart bootstrap", () => {
    const store = createGraphStore();
    graphBootstrap.bootstrap(store, core, coreGraphBootstrapOptions);
    graphBootstrap.bootstrap(store, testGraph, coreGraphBootstrapOptions);

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
    graphBootstrap.bootstrap(restartedStore, core, coreGraphBootstrapOptions);
    graphBootstrap.bootstrap(restartedStore, testGraph, coreGraphBootstrapOptions);

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

  it("seeds domain-owned icons and reuses them across additive bootstrap passes", () => {
    const store = createGraphStore();
    graphBootstrap.bootstrap(store, core, coreGraphBootstrapOptions);
    graphBootstrap.bootstrap(store, pkm, coreGraphBootstrapOptions);

    const iconTypePredicateId = edgeId(core.node.fields.type);
    const iconSvgPredicateId = edgeId(core.icon.fields.svg);
    const typeIconPredicateId = edgeId(core.type.fields.icon);
    const predicateIconPredicateId = edgeId(core.predicate.fields.icon);

    expect(store.facts(graphIconSeeds.string.id, iconTypePredicateId)[0]?.o).toBe(
      typeId(core.icon),
    );
    expect(store.facts(graphIconSeeds.string.id, iconSvgPredicateId)[0]?.o).toContain("<svg");
    expect(store.facts(typeId(core.string), typeIconPredicateId)[0]?.o).toBe(
      graphIconSeeds.string.id,
    );
    expect(store.facts(typeId(core.cardinality), typeIconPredicateId)[0]?.o).toBe(
      graphIconSeeds.tag.id,
    );
    expect(store.facts(typeId(core.svg), typeIconPredicateId)[0]?.o).toBe(graphIconSeeds.svg.id);
    expect(store.facts(edgeId(core.node.fields.createdAt), predicateIconPredicateId)[0]?.o).toBe(
      graphIconSeeds.date.id,
    );
    expect(store.facts(edgeId(core.node.fields.type), predicateIconPredicateId)[0]?.o).toBe(
      graphIconSeeds.edge.id,
    );
    expect(store.facts(edgeId(core.node.fields.type), predicateIconPredicateId)).toHaveLength(1);
  });

  it("creates client-safe snapshots with caller-supplied bootstrap options", () => {
    const snapshot = graphBootstrap.createBootstrappedSnapshot(testDefs, coreGraphBootstrapOptions);
    const store = createGraphStore(snapshot);
    const graph = createGraphClient(store, testDefs);

    expect(graph.type.get(typeId(testGraph.item)).createdAt?.toISOString()).toBe(
      bootstrapTimestampIso,
    );
    expect(graph.icon.get(graphIconSeeds.string.id).svg).toContain("<svg");
  });
});
