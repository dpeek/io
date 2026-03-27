import { describe, expect, it } from "bun:test";

import { createGraphStore, edgeId, typeId } from "@io/graph-kernel";

import { bootstrap, createBootstrappedSnapshot, requireGraphBootstrapCoreSchema } from "./index.js";
import * as graphBootstrap from "./index.js";
import {
  bootstrapTimestampIso,
  core,
  coreGraphBootstrapOptions,
  graphIconSeeds,
  testDefs,
  testGraph,
} from "./test-fixtures.js";

describe("graph-bootstrap package surface", () => {
  it("publishes only the curated runtime api", () => {
    expect(Object.keys(graphBootstrap).sort()).toEqual([
      "bootstrap",
      "createBootstrappedSnapshot",
      "requireGraphBootstrapCoreSchema",
    ]);
  });
});

describe("graph-bootstrap examples", () => {
  it("bootstraps core and domain schema facts into a live store", () => {
    const store = createGraphStore();
    const coreSchema = requireGraphBootstrapCoreSchema(core);
    const nodeCreatedAtPredicateId = edgeId(core.node.fields.createdAt);
    const nodeNamePredicateId = edgeId(core.node.fields.name);
    const nodeTypePredicateId = edgeId(core.node.fields.type);

    bootstrap(store, core, coreGraphBootstrapOptions);
    bootstrap(store, testGraph, { ...coreGraphBootstrapOptions, coreSchema });

    expect(store.facts(typeId(testGraph.item), nodeTypePredicateId)[0]?.o).toBe(typeId(core.type));
    expect(store.facts(typeId(testGraph.item), nodeNamePredicateId)[0]?.o).toBe(
      testGraph.item.values.name,
    );
    expect(store.facts(typeId(testGraph.item), nodeCreatedAtPredicateId)[0]?.o).toBe(
      bootstrapTimestampIso,
    );
  });

  it("creates bootstrapped snapshots with caller-supplied bootstrap options", () => {
    const snapshot = createBootstrappedSnapshot(testDefs, coreGraphBootstrapOptions);
    const store = createGraphStore(snapshot);
    const iconSvgPredicateId = edgeId(core.icon.fields.svg);
    const nodeCreatedAtPredicateId = edgeId(core.node.fields.createdAt);

    expect(store.facts(typeId(testGraph.item), nodeCreatedAtPredicateId)[0]?.o).toBe(
      bootstrapTimestampIso,
    );
    expect(store.facts(graphIconSeeds.string.id, iconSvgPredicateId)[0]?.o).toContain("<svg");
  });
});
