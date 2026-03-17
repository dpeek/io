import { describe, expect, it } from "bun:test";

import { bootstrap, createEntityWithId, core, createStore, createTypeClient } from "@io/core/graph";

import { createTestGraph, testDefs, testNamespace } from "./test-graph.js";

describe("predicate lifecycle hooks", () => {
  it("sets createdAt/updatedAt defaults on create", () => {
    const { graph } = createTestGraph();
    const explicitCreatedAt = new Date("2024-01-01T00:00:00.000Z");
    const explicitUpdatedAt = new Date("2024-01-02T00:00:00.000Z");

    const id = graph.record.create({
      name: "Acme",
      headline: "KS-1",
      status: testNamespace.status.values.draft.id,
      score: 5,
      createdAt: explicitCreatedAt,
      updatedAt: explicitUpdatedAt,
    });

    const record = graph.record.get(id);
    expect(record.createdAt).toBeDefined();
    expect(record.createdAt?.toISOString()).toBe(explicitCreatedAt.toISOString());
    expect(record.updatedAt?.toISOString()).toBe(explicitUpdatedAt.toISOString());
  });

  it("refreshes updatedAt only when non-timestamp fields change", async () => {
    const { graph } = createTestGraph();

    const id = graph.record.create({
      name: "Acme",
      headline: "KS-2",
      status: testNamespace.status.values.inReview.id,
      score: 7,
    });
    const firstRead = graph.record.get(id);
    expect(firstRead.updatedAt).toBeDefined();
    const initialUpdatedAt = firstRead.updatedAt?.getTime() ?? 0;

    await new Promise((resolve) => setTimeout(resolve, 5));
    const changed = graph.record.update(id, { name: "Acme 2" });
    expect(changed.updatedAt).toBeDefined();
    const changedUpdatedAt = changed.updatedAt?.getTime() ?? 0;
    expect(changedUpdatedAt).toBeGreaterThan(initialUpdatedAt);

    const afterChangeUpdatedAt = changedUpdatedAt;
    const noOp = graph.record.update(id, {});
    expect(noOp.updatedAt?.getTime()).toBe(afterChangeUpdatedAt);
  });

  it("allows explicit ids that were only used as scalar payloads", () => {
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, testNamespace);
    const graph = createTypeClient(store, testNamespace);
    const coreGraph = createTypeClient(store, core);
    const explicitId = "bootstrap-compatible-id";

    graph.record.create({
      name: "Acme",
      headline: "KS-3",
      status: testNamespace.status.values.draft.id,
      score: 3,
      externalId: explicitId,
    });

    createEntityWithId(store, testDefs, core.icon, explicitId, {
      key: "bootstrap-compatible",
      name: "Bootstrap Compatible",
      svg: '<svg viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg>',
    });

    const icon = coreGraph.icon.get(explicitId);
    expect(icon.createdAt).toBeInstanceOf(Date);
    expect(icon.updatedAt).toBeInstanceOf(Date);
  });
});
