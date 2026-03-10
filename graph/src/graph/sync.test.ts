import { describe, expect, it } from "bun:test";
import { app } from "./app";
import { bootstrap } from "./bootstrap";
import { createTypeClient } from "./client";
import { core } from "./core";
import { createStore } from "./store";
import { createSyncedTypeClient, createTotalSyncPayload } from "./sync";

function createServerGraph() {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, app);

  return {
    store,
    graph: createTypeClient(store, app),
  };
}

describe("total sync", () => {
  it("hydrates the local store and typed list/get path from a total snapshot", async () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      foundedYear: 1987,
      website: new URL("https://acme.com"),
    });
    const estiiId = server.graph.company.create({
      name: "Estii",
      status: app.status.values.paused.id,
      website: new URL("https://estii.com"),
    });

    const client = createSyncedTypeClient(app, {
      pull: () => createTotalSyncPayload(server.store, { cursor: "server:1" }),
    });
    const syncStatuses: string[] = [];

    expect(client.graph.company.list()).toEqual([]);
    expect(client.sync.getState()).toMatchObject({
      status: "idle",
      completeness: "incomplete",
      freshness: "stale",
      scope: { kind: "graph" },
    });

    const unsubscribe = client.sync.subscribe((state) => {
      syncStatuses.push(state.status);
    });

    const payload = await client.sync.sync();

    expect(payload).toMatchObject({
      mode: "total",
      cursor: "server:1",
      completeness: "complete",
      freshness: "current",
      scope: { kind: "graph" },
    });
    expect(syncStatuses).toEqual(["syncing", "ready"]);

    const companies = client.graph.company.list();
    expect(companies.map((company) => company.id)).toEqual([acmeId, estiiId]);
    expect(companies.map((company) => company.name)).toEqual(["Acme Corp", "Estii"]);
    expect(client.graph.company.get(acmeId)).toMatchObject({
      id: acmeId,
      name: "Acme Corp",
      status: app.status.values.active.id,
      foundedYear: 1987,
    });
    expect(client.graph.company.get(acmeId).website.toString()).toBe("https://acme.com/");

    const state = client.sync.getState();
    expect(state).toMatchObject({
      status: "ready",
      completeness: "complete",
      freshness: "current",
      cursor: "server:1",
      scope: { kind: "graph" },
    });
    expect(state.lastSyncedAt).toBeInstanceOf(Date);

    unsubscribe();
  });

  it("keeps predicate subscriptions local and replays only changed slots through later total syncs", async () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
      tags: ["enterprise", "ai"],
    });
    let cursor = 0;

    const client = createSyncedTypeClient(app, {
      pull: () =>
        createTotalSyncPayload(server.store, {
          cursor: `server:${(cursor += 1)}`,
        }),
    });

    await client.sync.sync();

    const acme = client.graph.company.ref(acmeId);
    let nameNotifications = 0;
    let tagNotifications = 0;
    const unsubscribeName = acme.fields.name.subscribe(() => {
      nameNotifications += 1;
    });
    const unsubscribeTags = acme.fields.tags.subscribe(() => {
      tagNotifications += 1;
    });

    await client.sync.sync();
    expect(nameNotifications).toBe(0);
    expect(tagNotifications).toBe(0);

    server.graph.company.update(acmeId, {
      name: "Acme Platform",
      tags: ["ai", "enterprise"],
    });
    await client.sync.sync();

    expect(nameNotifications).toBe(1);
    expect(tagNotifications).toBe(0);
    expect(client.graph.company.get(acmeId).name).toBe("Acme Platform");
    expect(client.graph.company.get(acmeId).tags).toEqual(["enterprise", "ai"]);
    expect(client.graph.company.list().map((company) => company.name)).toEqual(["Acme Platform"]);

    unsubscribeName();
    unsubscribeTags();
  });

  it("preserves the last ready cursor and marks sync state stale when a pull fails", async () => {
    const server = createServerGraph();
    server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
    });

    const error = new Error("sync failed");
    const client = createSyncedTypeClient(app, {
      pull: async () => {
        throw error;
      },
    });

    client.sync.apply(createTotalSyncPayload(server.store, { cursor: "server:1" }));

    const statuses: string[] = [];
    client.sync.subscribe((state) => {
      statuses.push(state.status);
    });

    await expect(client.sync.sync()).rejects.toThrow("sync failed");

    expect(statuses).toEqual(["syncing", "error"]);
    expect(client.sync.getState()).toMatchObject({
      status: "error",
      cursor: "server:1",
      completeness: "complete",
      freshness: "stale",
    });
    expect(client.sync.getState().error).toBe(error);
  });
});
