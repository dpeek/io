import { describe, expect, it } from "bun:test";

import { createGraphStore, defineType, edgeId, typeId } from "@io/graph-kernel";

import { bootstrap } from "./bootstrap.js";
import { core, coreGraphBootstrapOptions, graphIconSeeds, workflow } from "./test-fixtures.js";

describe("bootstrap", () => {
  it("seeds domain-owned icons and reuses them across additive bootstrap passes", () => {
    const store = createGraphStore();
    bootstrap(store, core, coreGraphBootstrapOptions);
    bootstrap(store, workflow, coreGraphBootstrapOptions);

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

  it("can materialize domain-owned icon seeds through a pluggable per-id provider", () => {
    const domainIconSeed = Object.freeze({
      id: "seed:icon:test-item",
      key: "test-item",
      name: "Test Item",
      svg: '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>',
    });
    const customItem = defineType({
      values: { key: "test:customItem", name: "Custom Item", icon: domainIconSeed.id },
      fields: {
        ...core.node.fields,
        title: { range: core.string, cardinality: "one", icon: domainIconSeed.id },
      },
    });
    const customGraph = { customItem } as const;
    const store = createGraphStore();

    bootstrap(store, core, coreGraphBootstrapOptions);
    bootstrap(store, customGraph, {
      ...coreGraphBootstrapOptions,
      resolveIconSeed(iconId) {
        return iconId === domainIconSeed.id ? domainIconSeed : undefined;
      },
    });

    const iconTypePredicateId = edgeId(core.node.fields.type);
    const iconSvgPredicateId = edgeId(core.icon.fields.svg);
    const typeIconPredicateId = edgeId(core.type.fields.icon);
    const predicateIconPredicateId = edgeId(core.predicate.fields.icon);

    expect(store.facts(domainIconSeed.id, iconTypePredicateId)[0]?.o).toBe(typeId(core.icon));
    expect(store.facts(domainIconSeed.id, iconSvgPredicateId)[0]?.o).toBe(domainIconSeed.svg);
    expect(store.facts(typeId(customGraph.customItem), typeIconPredicateId)[0]?.o).toBe(
      domainIconSeed.id,
    );
    expect(
      store.facts(edgeId(customGraph.customItem.fields.title), predicateIconPredicateId)[0]?.o,
    ).toBe(domainIconSeed.id);
  });
});
