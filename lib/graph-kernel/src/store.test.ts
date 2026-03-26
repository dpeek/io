import { describe, expect, it } from "bun:test";

import { createStore } from "./store.js";

function replaceSlotValues(
  store: ReturnType<typeof createStore>,
  subjectId: string,
  predicateId: string,
  values: readonly string[],
) {
  store.batch(() => {
    for (const edge of store.facts(subjectId, predicateId)) store.retract(edge.id);
    for (const value of values) store.assert(subjectId, predicateId, value);
  });
}

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

  it("treats identical assertEdge calls as a no-op and rejects conflicting edge reuse", () => {
    const store = createStore();
    const edge = {
      id: "edge:1",
      s: "node:a",
      p: "pred:name",
      o: "Ada",
    } as const;

    expect(store.version()).toBe(0);
    expect(store.assertEdge(edge)).toEqual(edge);
    expect(store.version()).toBe(1);
    expect(store.assertEdge(edge)).toEqual(edge);
    expect(store.version()).toBe(1);
    expect(() => store.assertEdge({ ...edge, o: "Grace" })).toThrow(
      'Edge id "edge:1" already exists with different contents.',
    );
  });

  it("advances version only for the first retract and full snapshot replacement", () => {
    const store = createStore();
    const edge = store.assert("node:a", "pred:name", "Ada");

    expect(store.version()).toBe(1);
    store.retract(edge.id);
    expect(store.version()).toBe(2);
    store.retract(edge.id);
    expect(store.version()).toBe(2);
    store.replace(store.snapshot());
    expect(store.version()).toBe(3);
  });
});

describe("predicate slot subscriptions", () => {
  it("supports subscribing to and unsubscribing from one predicate slot", () => {
    const store = createStore();
    const recordId = "node:record";
    const namePredicateId = "pred:name";
    store.assert(recordId, namePredicateId, "Acme");
    let notifications = 0;

    const unsubscribe = store.subscribePredicateSlot(recordId, namePredicateId, () => {
      notifications += 1;
    });

    replaceSlotValues(store, recordId, namePredicateId, ["Acme 2"]);
    expect(notifications).toBe(1);

    unsubscribe();
    replaceSlotValues(store, recordId, namePredicateId, ["Acme 3"]);
    expect(notifications).toBe(1);
  });

  it("does not notify a slot for unrelated predicate writes", () => {
    const store = createStore();
    const recordId = "node:record";
    const namePredicateId = "pred:name";
    store.assert(recordId, namePredicateId, "Acme");
    let notifications = 0;

    store.subscribePredicateSlot(recordId, namePredicateId, () => {
      notifications += 1;
    });

    store.assert(recordId, "pred:website", "https://acme.test");
    expect(notifications).toBe(0);
  });

  it("coalesces multi-edge field replacement into one slot notification", () => {
    const store = createStore();
    const recordId = "node:record";
    const tagsPredicateId = "pred:tags";
    store.assert(recordId, tagsPredicateId, "tag:enterprise");
    store.assert(recordId, tagsPredicateId, "tag:saas");
    let notifications = 0;

    store.subscribePredicateSlot(recordId, tagsPredicateId, () => {
      notifications += 1;
    });

    replaceSlotValues(store, recordId, tagsPredicateId, ["tag:enterprise", "tag:ai"]);
    expect(notifications).toBe(1);
  });

  it("ignores raw edge churn when the logical slot value is unchanged", () => {
    const store = createStore();
    const recordId = "node:record";
    const namePredicateId = "pred:name";
    store.assert(recordId, namePredicateId, "Acme");
    let notifications = 0;

    store.subscribePredicateSlot(recordId, namePredicateId, () => {
      notifications += 1;
    });

    replaceSlotValues(store, recordId, namePredicateId, ["Acme"]);
    expect(notifications).toBe(0);
  });
});
