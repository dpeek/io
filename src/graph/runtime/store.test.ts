import { describe, expect, it } from "bun:test";

import { createStore } from "./store";

describe("store indexes", () => {
  it("supports indexed find and facts lookups across query shapes", () => {
    const store = createStore();
    const firstName = store.assert("node:a", "pred:name", "Ada");
    const secondName = store.assert("node:a", "pred:name", "Grace");
    const role = store.assert("node:a", "pred:role", "Engineer");
    const peerName = store.assert("node:b", "pred:name", "Ada");

    store.retract(secondName.id);

    expect(store.find("node:a", "pred:name").map((edge) => edge.id)).toEqual([
      firstName.id,
      secondName.id,
    ]);
    expect(store.facts("node:a", "pred:name").map((edge) => edge.id)).toEqual([firstName.id]);
    expect(store.find(undefined, "pred:name", "Ada").map((edge) => edge.id)).toEqual([
      firstName.id,
      peerName.id,
    ]);
    expect(store.find("node:a", undefined, "Engineer").map((edge) => edge.id)).toEqual([role.id]);
    expect(store.facts(undefined, undefined, "Ada").map((edge) => edge.id)).toEqual([
      firstName.id,
      peerName.id,
    ]);
  });

  it("rebuilds indexes from snapshot initialization and replace", () => {
    const source = createStore();
    const sourceEdge = source.assert("node:a", "pred:type", "type:person");
    const cloned = createStore(source.snapshot());

    expect(cloned.facts("node:a", "pred:type").map((edge) => edge.id)).toEqual([sourceEdge.id]);

    const replacement = createStore();
    const replacementEdge = replacement.assert("node:z", "pred:type", "type:company");
    cloned.replace(replacement.snapshot());

    expect(cloned.find("node:a")).toEqual([]);
    expect(cloned.facts(undefined, "pred:type", "type:company").map((edge) => edge.id)).toEqual([
      replacementEdge.id,
    ]);
  });
});
