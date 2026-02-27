import { describe, expect, it } from "bun:test";
import { core } from "../schema/core";
import { bootstrap } from "./bootstrap";
import { edgeId } from "./schema";
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
});
