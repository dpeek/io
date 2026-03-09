import { describe, expect, it } from "bun:test";
import { app } from "./app";
import { bootstrap } from "./bootstrap";
import { createTypeClient } from "./client";
import { core } from "./core";
import { edgeId } from "./schema";
import { createStore } from "./store";

function setupCompanyGraph() {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, app);
  const graph = createTypeClient(store, app);

  const companyId = graph.company.create({
    name: "Acme",
    website: new URL("https://acme.com"),
    status: app.status.values.active.id,
    tags: ["enterprise", "saas"],
  });

  return { store, graph, companyId };
}

describe("predicate slot subscriptions", () => {
  it("supports subscribing to and unsubscribing from one predicate slot", () => {
    const { store, graph, companyId } = setupCompanyGraph();
    const namePredicateId = edgeId(app.company.fields.name);
    let notifications = 0;

    const unsubscribe = store.subscribePredicateSlot(companyId, namePredicateId, () => {
      notifications += 1;
    });

    graph.company.update(companyId, { name: "Acme 2" });
    expect(notifications).toBe(1);

    unsubscribe();
    graph.company.update(companyId, { name: "Acme 3" });
    expect(notifications).toBe(1);
  });

  it("does not notify a slot for unrelated predicate writes", () => {
    const { store, graph, companyId } = setupCompanyGraph();
    const namePredicateId = edgeId(app.company.fields.name);
    let notifications = 0;

    store.subscribePredicateSlot(companyId, namePredicateId, () => {
      notifications += 1;
    });

    graph.company.update(companyId, { website: new URL("https://acme-2.com") });
    expect(notifications).toBe(0);
  });

  it("coalesces multi-edge field replacement into one slot notification", () => {
    const { store, graph, companyId } = setupCompanyGraph();
    const tagsPredicateId = edgeId(app.company.fields.tags);
    let notifications = 0;

    store.subscribePredicateSlot(companyId, tagsPredicateId, () => {
      notifications += 1;
    });

    graph.company.update(companyId, { tags: ["enterprise", "ai"] });
    expect(notifications).toBe(1);
  });

  it("ignores unordered tag replacements when membership is unchanged", () => {
    const { store, graph, companyId } = setupCompanyGraph();
    const tagsPredicateId = edgeId(app.company.fields.tags);
    let notifications = 0;

    store.subscribePredicateSlot(companyId, tagsPredicateId, () => {
      notifications += 1;
    });

    graph.company.update(companyId, { tags: ["saas", "enterprise", "enterprise"] });
    expect(notifications).toBe(0);
  });

  it("ignores raw edge churn when the logical slot value is unchanged", () => {
    const { store, companyId } = setupCompanyGraph();
    const namePredicateId = edgeId(app.company.fields.name);
    let notifications = 0;

    store.subscribePredicateSlot(companyId, namePredicateId, () => {
      notifications += 1;
    });

    store.batch(() => {
      for (const edge of store.facts(companyId, namePredicateId)) store.retract(edge.id);
      store.assert(companyId, namePredicateId, "Acme");
    });

    expect(notifications).toBe(0);
  });
});
