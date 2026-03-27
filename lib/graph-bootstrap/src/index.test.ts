import { describe, expect, it } from "bun:test";

import { createGraphClient } from "@io/graph-client";
import { createGraphStore, typeId } from "@io/graph-kernel";

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
  it("bootstraps a live store for a graph client", () => {
    const store = createGraphStore();
    const coreSchema = requireGraphBootstrapCoreSchema(core);

    bootstrap(store, core, coreGraphBootstrapOptions);
    bootstrap(store, testGraph, { ...coreGraphBootstrapOptions, coreSchema });

    const graph = createGraphClient(store, testDefs);
    const runtimeId = graph.item.create({ name: "Example Item", title: "One" });

    expect(graph.type.get(typeId(testGraph.item)).createdAt?.toISOString()).toBe(
      bootstrapTimestampIso,
    );
    expect(graph.item.get(runtimeId).title).toBe("One");
  });

  it("creates client-safe snapshots with caller-supplied bootstrap options", () => {
    const snapshot = createBootstrappedSnapshot(testDefs, coreGraphBootstrapOptions);
    const store = createGraphStore(snapshot);
    const graph = createGraphClient(store, testDefs);

    expect(graph.type.get(typeId(testGraph.item)).createdAt?.toISOString()).toBe(
      bootstrapTimestampIso,
    );
    expect(graph.icon.get(graphIconSeeds.string.id).svg).toContain("<svg");
  });
});
