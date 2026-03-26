import { describe, expect, it } from "bun:test";

import { createStore, edgeId } from "@io/core/graph";
import { core, coreGraphBootstrapOptions } from "@io/core/graph/modules";
import { bootstrap } from "@io/graph-bootstrap";
import { createGraphClient } from "@io/graph-client";

import { testDefs, testNamespace } from "./test-graph.js";

function setupRecordGraph() {
  const store = createStore();
  bootstrap(store, core, coreGraphBootstrapOptions);
  bootstrap(store, testNamespace, coreGraphBootstrapOptions);
  const graph = createGraphClient(store, testNamespace, testDefs);
  const coreGraph = createGraphClient(store, core);

  const enterpriseTagId = coreGraph.tag.create({
    name: "Enterprise",
    key: "enterprise",
    color: "#6366f1",
  });
  const saasTagId = coreGraph.tag.create({
    name: "SaaS",
    key: "saas",
    color: "#10b981",
  });
  const aiTagId = coreGraph.tag.create({
    name: "AI",
    key: "ai",
    color: "#f59e0b",
  });

  const recordId = graph.record.create({
    name: "Acme",
    headline: "KS-1",
    status: testNamespace.status.values.draft.id,
    score: 8,
    tags: [enterpriseTagId, saasTagId],
  });

  return {
    store,
    graph,
    recordId,
    tagIds: {
      aiTagId,
      enterpriseTagId,
      saasTagId,
    },
  };
}

describe("predicate slot subscriptions", () => {
  it("supports subscribing to and unsubscribing from one predicate slot", () => {
    const { store, graph, recordId } = setupRecordGraph();
    const namePredicateId = edgeId(testNamespace.record.fields.name);
    let notifications = 0;

    const unsubscribe = store.subscribePredicateSlot(recordId, namePredicateId, () => {
      notifications += 1;
    });

    graph.record.update(recordId, { name: "Acme 2" });
    expect(notifications).toBe(1);

    unsubscribe();
    graph.record.update(recordId, { name: "Acme 3" });
    expect(notifications).toBe(1);
  });

  it("does not notify a slot for unrelated predicate writes", () => {
    const { store, graph, recordId } = setupRecordGraph();
    const namePredicateId = edgeId(testNamespace.record.fields.name);
    let notifications = 0;

    store.subscribePredicateSlot(recordId, namePredicateId, () => {
      notifications += 1;
    });

    graph.record.update(recordId, { website: new URL("https://acme-2.com") });
    expect(notifications).toBe(0);
  });

  it("coalesces multi-edge field replacement into one slot notification", () => {
    const { store, graph, recordId, tagIds } = setupRecordGraph();
    const tagsPredicateId = edgeId(testNamespace.record.fields.tags);
    let notifications = 0;

    store.subscribePredicateSlot(recordId, tagsPredicateId, () => {
      notifications += 1;
    });

    graph.record.update(recordId, { tags: [tagIds.enterpriseTagId, tagIds.aiTagId] });
    expect(notifications).toBe(1);
  });

  it("ignores unordered tag replacements when membership is unchanged", () => {
    const { store, graph, recordId, tagIds } = setupRecordGraph();
    const tagsPredicateId = edgeId(testNamespace.record.fields.tags);
    let notifications = 0;

    store.subscribePredicateSlot(recordId, tagsPredicateId, () => {
      notifications += 1;
    });

    graph.record.update(recordId, {
      tags: [tagIds.saasTagId, tagIds.enterpriseTagId, tagIds.enterpriseTagId],
    });
    expect(notifications).toBe(0);
  });

  it("ignores raw edge churn when the logical slot value is unchanged", () => {
    const { store, recordId } = setupRecordGraph();
    const namePredicateId = edgeId(testNamespace.record.fields.name);
    let notifications = 0;

    store.subscribePredicateSlot(recordId, namePredicateId, () => {
      notifications += 1;
    });

    store.batch(() => {
      for (const edge of store.facts(recordId, namePredicateId)) store.retract(edge.id);
      store.assert(recordId, namePredicateId, "Acme");
    });

    expect(notifications).toBe(0);
  });
});
