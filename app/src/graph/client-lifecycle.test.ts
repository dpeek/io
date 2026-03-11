import { describe, expect, it } from "bun:test";
import { bootstrap } from "./bootstrap";
import { createTypeClient } from "./client";
import { app } from "./app";
import { core } from "./core";
import { createStore } from "./store";

describe("predicate lifecycle hooks", () => {
  it("sets createdAt/updatedAt defaults on create", () => {
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, app);
    const graph = createTypeClient(store, app);
    const explicitCreatedAt = new Date("2024-01-01T00:00:00.000Z");

    const id = graph.company.create({
      name: "Acme",
      website: new URL("https://acme.com"),
      status: app.status.values.active.id,
      createdAt: explicitCreatedAt,
    });

    const company = graph.company.get(id);
    expect(company.createdAt).toBeDefined();
    expect(company.createdAt?.toISOString()).toBe(explicitCreatedAt.toISOString());
    expect(company.updatedAt).toBeInstanceOf(Date);
  });

  it("refreshes updatedAt only when non-timestamp fields change", async () => {
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, app);
    const graph = createTypeClient(store, app);

    const id = graph.company.create({
      name: "Acme",
      website: new URL("https://acme.com"),
      status: app.status.values.active.id,
    });
    const firstRead = graph.company.get(id);
    expect(firstRead.updatedAt).toBeDefined();
    const initialUpdatedAt = firstRead.updatedAt?.getTime() ?? 0;

    await new Promise((resolve) => setTimeout(resolve, 5));
    const changed = graph.company.update(id, { name: "Acme 2" });
    expect(changed.updatedAt).toBeDefined();
    const changedUpdatedAt = changed.updatedAt?.getTime() ?? 0;
    expect(changedUpdatedAt).toBeGreaterThan(initialUpdatedAt);

    const afterChangeUpdatedAt = changedUpdatedAt;
    const noOp = graph.company.update(id, {});
    expect(noOp.updatedAt?.getTime()).toBe(afterChangeUpdatedAt);
  });
});
