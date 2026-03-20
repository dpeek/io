import { describe, expect, it } from "bun:test";

import { app } from "../modules/app.js";
import { graphIconSeeds } from "../modules/core/icon/seed.js";
import { bootstrap } from "./bootstrap";
import { createTypeClient } from "./client";
import { core } from "./core";
import { edgeId, typeId } from "./schema";
import { createStore } from "./store";

describe("bootstrap cardinality metadata", () => {
  it("materializes predicate cardinality as enum value ids", () => {
    const store = createStore();
    bootstrap(store, core);

    const cardinalityPredicateId = edgeId(core.predicate.fields.cardinality);
    const keyPredicateNodeId = edgeId(core.predicate.fields.key);
    const value = store.facts(keyPredicateNodeId, cardinalityPredicateId)[0]?.o;

    expect(value).toBe(core.cardinality.values.one.id);
  });

  it("does not duplicate single-value schema facts across repeated bootstrap calls", () => {
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, core);

    const predicateId = edgeId(core.predicate.fields.key);
    const keyPredicateId = edgeId(core.predicate.fields.key);
    const namePredicateId = edgeId(core.node.fields.name);
    const rangePredicateId = edgeId(core.predicate.fields.range);
    const cardinalityPredicateId = edgeId(core.predicate.fields.cardinality);
    const nodeTypePredicateId = edgeId(core.node.fields.type);

    expect(store.facts(predicateId, keyPredicateId)).toHaveLength(1);
    expect(store.facts(predicateId, namePredicateId)).toHaveLength(1);
    expect(store.facts(predicateId, rangePredicateId)).toHaveLength(1);
    expect(store.facts(predicateId, cardinalityPredicateId)).toHaveLength(1);
    expect(store.facts(predicateId, nodeTypePredicateId)).toHaveLength(1);
    expect(store.facts(typeId(core.predicate), keyPredicateId)).toHaveLength(1);
    expect(store.facts(typeId(core.predicate), namePredicateId)).toHaveLength(1);
  });

  it("seeds icon entities and links schema metadata icons with inferred enum and edge fallbacks", () => {
    const store = createStore();
    bootstrap(store, core);

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
  });

  it("keeps shared predicate icon metadata single-valued across core and app bootstrap passes", () => {
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, app);

    const predicateIconPredicateId = edgeId(core.predicate.fields.icon);
    expect(store.facts(edgeId(core.node.fields.type), predicateIconPredicateId)).toHaveLength(1);
    expect(store.facts(edgeId(core.node.fields.type), predicateIconPredicateId)[0]?.o).toBe(
      graphIconSeeds.edge.id,
    );
  });

  it("materializes bootstrap-owned timestamps for icon, type, predicate, and enum-member queries", async () => {
    const store = createStore();
    bootstrap(store, core);
    const graph = createTypeClient(store, core);
    const expectedIso = "2000-01-01T00:00:00.000Z";

    const icon = await graph.icon.query({
      where: { id: graphIconSeeds.string.id },
      select: {
        createdAt: true,
        updatedAt: true,
      },
    });
    const typeEntry = await graph.type.query({
      where: { id: typeId(core.string) },
      select: {
        createdAt: true,
        updatedAt: true,
      },
    });
    const predicateEntry = await graph.predicate.query({
      where: { id: edgeId(core.node.fields.type) },
      select: {
        createdAt: true,
        updatedAt: true,
      },
    });
    const enumMember = await graph.type.query({
      where: { id: core.cardinality.values.one.id },
      select: {
        createdAt: true,
        updatedAt: true,
      },
    });

    expect(icon?.createdAt).toBeInstanceOf(Date);
    expect(icon?.updatedAt).toBeInstanceOf(Date);
    expect(typeEntry?.createdAt).toBeInstanceOf(Date);
    expect(typeEntry?.updatedAt).toBeInstanceOf(Date);
    expect(predicateEntry?.createdAt).toBeInstanceOf(Date);
    expect(predicateEntry?.updatedAt).toBeInstanceOf(Date);
    expect(enumMember?.createdAt).toBeInstanceOf(Date);
    expect(enumMember?.updatedAt).toBeInstanceOf(Date);
    expect(icon?.createdAt.toISOString()).toBe(expectedIso);
    expect(icon?.updatedAt.toISOString()).toBe(expectedIso);
    expect(typeEntry?.createdAt.toISOString()).toBe(expectedIso);
    expect(typeEntry?.updatedAt.toISOString()).toBe(expectedIso);
    expect(predicateEntry?.createdAt.toISOString()).toBe(expectedIso);
    expect(predicateEntry?.updatedAt.toISOString()).toBe(expectedIso);
    expect(enumMember?.createdAt.toISOString()).toBe(expectedIso);
    expect(enumMember?.updatedAt.toISOString()).toBe(expectedIso);
  });
});
