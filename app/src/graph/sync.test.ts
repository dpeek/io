import { describe, expect, it } from "bun:test";
import { app } from "./app";
import { bootstrap } from "./bootstrap";
import {
  GraphValidationError,
  createTypeClient,
  formatValidationPath,
} from "./client";
import { core } from "./core";
import { edgeId, typeId } from "./schema";
import { createStore } from "./store";
import {
  createAuthoritativeTotalSyncValidator,
  createSyncedTypeClient,
  createTotalSyncController,
  createTotalSyncPayload,
  createTotalSyncSession,
  validateAuthoritativeTotalSyncPayload,
} from "./sync";

function createServerGraph() {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, app);

  return {
    store,
    graph: createTypeClient(store, app),
  };
}

function createDataOnlyTotalSyncPayload(
  store: ReturnType<typeof createServerGraph>["store"],
  options: Parameters<typeof createTotalSyncPayload>[1] = {},
) {
  const dataOnlyStore = createStore();
  const entityTypeIds = new Set(
    Object.values(app)
      .filter((typeDef) => typeDef.kind === "entity")
      .map((typeDef) => typeId(typeDef)),
  );
  const nodeTypePredicateId = edgeId(core.node.fields.type);
  const dataNodeIds = new Set(
    store
      .facts(undefined, nodeTypePredicateId)
      .filter((edge) => entityTypeIds.has(edge.o))
      .map((edge) => edge.s),
  );

  for (const edge of store.facts()) {
    if (!dataNodeIds.has(edge.s)) continue;
    dataOnlyStore.assert(edge.s, edge.p, edge.o);
  }

  return createTotalSyncPayload(dataOnlyStore, options);
}

describe("total sync", () => {
  it("runs synced-client local edits through the same local validation boundary before sync", () => {
    const server = createServerGraph();
    const client = createSyncedTypeClient(app, {
      pull: () => createTotalSyncPayload(server.store, { cursor: "server:1" }),
    });

    const valid = client.graph.company.validateCreate({
      name: "Local draft",
      status: app.status.values.active.id,
      website: new URL("https://draft.example"),
    });

    expect(valid).toMatchObject({
      ok: true,
      phase: "local",
      event: "create",
    });
    if (!valid.ok) throw new Error("Expected synced-client local validation to pass before sync");

    const invalid = client.graph.company.validateCreate({
      name: "   ",
      status: app.status.values.active.id,
      website: new URL("https://draft.example"),
    });

    expect(invalid).toMatchObject({
      ok: false,
      phase: "local",
      event: "create",
    });
    if (invalid.ok) throw new Error("Expected synced-client local validation to fail");
    expect(invalid.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "field",
          code: "string.blank",
          predicateKey: app.company.fields.name.key,
        }),
      ]),
    );
    expect(client.graph.company.list()).toEqual([]);
    expect(client.sync.getState()).toMatchObject({
      status: "idle",
      completeness: "incomplete",
      freshness: "stale",
    });

    const localId = client.graph.company.create({
      name: "Local draft",
      status: app.status.values.active.id,
      website: new URL("https://draft.example"),
    });

    expect(client.graph.company.get(localId)).toMatchObject({
      id: localId,
      name: "Local draft",
      status: app.status.values.active.id,
    });
    expect(client.graph.company.get(localId).website.toString()).toBe("https://draft.example/");
    expect(client.sync.getState()).toMatchObject({
      status: "idle",
      completeness: "incomplete",
      freshness: "stale",
    });
  });

  it("treats an accepted total snapshot as authoritative over valid local optimistic edits", async () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
    });

    const client = createSyncedTypeClient(app, {
      pull: () => createTotalSyncPayload(server.store, { cursor: "server:1" }),
    });

    const localId = client.graph.company.create({
      name: "Local draft",
      status: app.status.values.active.id,
      website: new URL("https://draft.example"),
    });

    expect(client.graph.company.list().map((company) => company.id)).toEqual([localId]);

    const payload = await client.sync.sync();

    expect(payload.cursor).toBe("server:1");
    expect(client.graph.company.list().map((company) => company.id)).toEqual([acmeId]);
    expect(client.graph.company.get(acmeId)).toMatchObject({
      id: acmeId,
      name: "Acme Corp",
      status: app.status.values.active.id,
    });
    expect(client.graph.company.get(acmeId).website.toString()).toBe("https://acme.com/");
    expect(client.graph.company.get(localId)).toMatchObject({
      id: localId,
      name: undefined,
      status: undefined,
      website: undefined,
    });
    expect(client.sync.getState()).toMatchObject({
      status: "ready",
      completeness: "complete",
      freshness: "current",
      cursor: "server:1",
    });
  });

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

  it("preserves the bootstrapped schema contract when total sync payloads only include data", async () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
    });

    const dataOnlyPayload = createDataOnlyTotalSyncPayload(server.store, {
      cursor: "server:data-only:1",
    });
    const client = createSyncedTypeClient(app, {
      pull: () => dataOnlyPayload,
    });

    const payload = await client.sync.sync();

    expect(payload.cursor).toBe("server:data-only:1");
    expect(dataOnlyPayload.snapshot.edges.some((edge) => edge.s === typeId(app.company))).toBe(false);
    expect(payload.snapshot.edges.some((edge) => edge.s === typeId(app.company))).toBe(true);
    expect(client.graph.company.list().map((company) => company.id)).toEqual([acmeId]);
    expect(client.graph.company.get(acmeId)).toMatchObject({
      id: acmeId,
      name: "Acme Corp",
      status: app.status.values.active.id,
    });

    const validation = client.graph.company.validateUpdate(acmeId, {
      name: "Acme Graph Labs",
    });

    expect(validation).toMatchObject({
      ok: true,
      phase: "local",
      event: "update",
    });
    if (!validation.ok) throw new Error("Expected local validation to stay usable after data-only sync");

    client.graph.company.update(acmeId, {
      name: "Acme Graph Labs",
    });
    expect(client.graph.company.get(acmeId).name).toBe("Acme Graph Labs");
  });

  it("materializes data-only payloads through synced-client sync.apply", () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
    });

    const dataOnlyPayload = createDataOnlyTotalSyncPayload(server.store, {
      cursor: "server:data-only:apply",
    });
    const client = createSyncedTypeClient(app, {
      pull: () => dataOnlyPayload,
    });

    const payload = client.sync.apply(dataOnlyPayload);

    expect(payload.cursor).toBe("server:data-only:apply");
    expect(dataOnlyPayload.snapshot.edges.some((edge) => edge.s === typeId(app.company))).toBe(false);
    expect(payload.snapshot.edges.some((edge) => edge.s === typeId(app.company))).toBe(true);
    expect(payload.snapshot.edges).toEqual(expect.arrayContaining(dataOnlyPayload.snapshot.edges));
    expect(client.graph.company.list().map((company) => company.id)).toEqual([acmeId]);
    expect(client.graph.company.get(acmeId)).toMatchObject({
      id: acmeId,
      name: "Acme Corp",
      status: app.status.values.active.id,
    });
    expect(client.sync.getState()).toMatchObject({
      status: "ready",
      cursor: "server:data-only:apply",
      completeness: "complete",
      freshness: "current",
    });

    const validation = client.graph.company.validateUpdate(acmeId, {
      name: "Acme Apply Labs",
    });

    expect(validation).toMatchObject({
      ok: true,
      phase: "local",
      event: "update",
    });
    if (!validation.ok) throw new Error("Expected local validation to stay usable after sync.apply");
  });

  it("lets non-throwing authoritative validation reuse the preserved schema baseline", () => {
    const server = createServerGraph();
    server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
    });

    const clientStore = createStore();
    bootstrap(clientStore, core);
    bootstrap(clientStore, app);

    const payload = createDataOnlyTotalSyncPayload(server.store, {
      cursor: "server:data-only:1",
    });
    const result = validateAuthoritativeTotalSyncPayload(payload, app, {
      preserveSnapshot: clientStore.snapshot(),
    });

    expect(result).toMatchObject({
      ok: true,
      phase: "authoritative",
      event: "reconcile",
    });
    if (!result.ok) throw new Error("Expected authoritative payload validation to pass");
    expect(result.value.snapshot.edges.length).toBeGreaterThan(payload.snapshot.edges.length);
    expect(result.value.snapshot.edges).toEqual(expect.arrayContaining(payload.snapshot.edges));
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

  it("rejects authoritative snapshots that fail graph validation and preserves local state", async () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
    });
    let cursor = 0;

    const client = createSyncedTypeClient(app, {
      pull: () =>
        createTotalSyncPayload(server.store, {
          cursor: `server:${(cursor += 1)}`,
        }),
    });

    await client.sync.sync();
    expect(client.graph.company.get(acmeId).name).toBe("Acme Corp");

    for (const edge of server.store.facts(acmeId, edgeId(app.company.fields.name))) {
      server.store.retract(edge.id);
    }
    server.store.assert(acmeId, edgeId(app.company.fields.name), "   ");

    let error: unknown;
    try {
      await client.sync.sync();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<void>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
    });
    expect(validationError.result.changedPredicateKeys).toEqual([app.company.fields.name.key]);
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "field",
          code: "string.blank",
          predicateKey: app.company.fields.name.key,
        }),
      ]),
    );
    expect(formatValidationPath(validationError.result.issues[0]?.path ?? [])).toBe("name");
    expect(client.sync.getState()).toMatchObject({
      status: "error",
      cursor: "server:1",
      freshness: "stale",
    });
    expect(client.graph.company.get(acmeId).name).toBe("Acme Corp");
  });

  it("rejects authoritative snapshots with duplicate current single-value facts and preserves local state", async () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
    });
    let cursor = 0;

    const client = createSyncedTypeClient(app, {
      pull: () =>
        createTotalSyncPayload(server.store, {
          cursor: `server:${(cursor += 1)}`,
        }),
    });

    await client.sync.sync();
    expect(client.graph.company.get(acmeId).name).toBe("Acme Corp");

    server.store.assert(acmeId, edgeId(app.company.fields.name), "Acme Corp");

    let error: unknown;
    try {
      await client.sync.sync();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<void>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
    });
    expect(validationError.result.changedPredicateKeys).toEqual([app.company.fields.name.key]);
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "field.cardinality",
          predicateKey: app.company.fields.name.key,
          nodeId: acmeId,
        }),
      ]),
    );
    expect(formatValidationPath(validationError.result.issues[0]?.path ?? [])).toBe("name");
    expect(client.sync.getState()).toMatchObject({
      status: "error",
      cursor: "server:1",
      freshness: "stale",
    });
    expect(client.graph.company.get(acmeId).name).toBe("Acme Corp");
  });

  it("rejects invalid snapshots passed through sync.apply without replacing local state", async () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
    });

    const client = createSyncedTypeClient(app, {
      pull: () => createTotalSyncPayload(server.store, { cursor: "server:1" }),
    });

    await client.sync.sync();
    expect(client.graph.company.get(acmeId).name).toBe("Acme Corp");

    for (const edge of server.store.facts(acmeId, edgeId(app.company.fields.name))) {
      server.store.retract(edge.id);
    }
    server.store.assert(acmeId, edgeId(app.company.fields.name), "   ");

    let error: unknown;
    try {
      client.sync.apply(createTotalSyncPayload(server.store, { cursor: "server:2" }));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<void>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
    });
    expect(client.sync.getState()).toMatchObject({
      status: "ready",
      cursor: "server:1",
      freshness: "current",
    });
    expect(client.graph.company.get(acmeId).name).toBe("Acme Corp");
  });

  it("surfaces authoritative payload validation results without requiring callers to throw", () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
    });

    for (const edge of server.store.facts(acmeId, edgeId(app.company.fields.name))) {
      server.store.retract(edge.id);
    }
    server.store.assert(acmeId, edgeId(app.company.fields.name), "   ");

    const result = validateAuthoritativeTotalSyncPayload(
      createTotalSyncPayload(server.store, { cursor: "server:1" }),
      app,
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
    });
    if (result.ok) throw new Error("Expected authoritative payload validation to fail");
    expect(result.changedPredicateKeys).toEqual([app.company.fields.name.key]);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "field",
          code: "string.blank",
          predicateKey: app.company.fields.name.key,
          nodeId: acmeId,
        }),
      ]),
    );
  });

  it("returns caller-owned authoritative validation payload snapshots", () => {
    const server = createServerGraph();
    server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
    });

    const payload = createTotalSyncPayload(server.store, {
      cursor: "server:owned-result",
    });
    const originalCursor = payload.cursor;
    const originalObject = payload.snapshot.edges[0]?.o;

    const result = validateAuthoritativeTotalSyncPayload(payload, app);

    expect(result).toMatchObject({
      ok: true,
      phase: "authoritative",
      event: "reconcile",
    });
    if (!result.ok) throw new Error("Expected authoritative payload validation to pass");

    const publicValue = result.value as unknown as {
      cursor: string;
      snapshot: { edges: Array<{ o: string }> };
    };
    publicValue.cursor = "server:mutated";
    publicValue.snapshot.edges[0]!.o = "mutated-object";

    expect(payload.cursor).toBe(originalCursor);
    expect(payload.snapshot.edges[0]?.o).toBe(originalObject);
  });

  it("uses the same authoritative validation result for direct checks and sync.apply failures", () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
    });

    for (const edge of server.store.facts(acmeId, edgeId(app.company.fields.name))) {
      server.store.retract(edge.id);
    }
    server.store.assert(acmeId, edgeId(app.company.fields.name), "   ");

    const payload = createTotalSyncPayload(server.store, {
      cursor: "server:invalid:name",
    });
    const result = validateAuthoritativeTotalSyncPayload(payload, app);

    expect(result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
    });
    if (result.ok) throw new Error("Expected authoritative payload validation to fail");

    const client = createSyncedTypeClient(app, {
      pull: () => payload,
    });

    let error: unknown;
    try {
      client.sync.apply(payload);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<typeof payload>;
    expect(validationError.result).toEqual(result);
    expect(formatValidationPath(validationError.result.issues[0]?.path ?? [])).toBe("name");
  });

  it("returns the materialized payload on authoritative validation failure", () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
    });

    for (const edge of server.store.facts(acmeId, edgeId(app.company.fields.name))) {
      server.store.retract(edge.id);
    }
    server.store.assert(acmeId, edgeId(app.company.fields.name), "   ");

    const clientStore = createStore();
    bootstrap(clientStore, core);
    bootstrap(clientStore, app);
    const payload = createDataOnlyTotalSyncPayload(server.store, {
      cursor: "server:data-only:invalid-name",
    });

    const result = validateAuthoritativeTotalSyncPayload(payload, app, {
      preserveSnapshot: clientStore.snapshot(),
    });

    expect(result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
    });
    if (result.ok) throw new Error("Expected authoritative payload validation to fail");
    expect(result.value.snapshot.edges.length).toBeGreaterThan(payload.snapshot.edges.length);
    expect(result.value.snapshot.edges).toEqual(expect.arrayContaining(payload.snapshot.edges));
    expect(result.changedPredicateKeys).toEqual([app.company.fields.name.key]);
  });

  it("lets direct authoritative payload validation preserve bootstrapped schema for data-only payloads", () => {
    const server = createServerGraph();
    server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
    });

    const clientStore = createStore();
    bootstrap(clientStore, core);
    bootstrap(clientStore, app);

    const result = validateAuthoritativeTotalSyncPayload(
      createDataOnlyTotalSyncPayload(server.store, { cursor: "server:data-only:1" }),
      app,
      {
        preserveSnapshot: clientStore.snapshot(),
      },
    );

    expect(result).toMatchObject({
      ok: true,
      phase: "authoritative",
      event: "reconcile",
      changedPredicateKeys: [],
    });
  });

  it("surfaces malformed total-sync envelopes through the authoritative validation result", () => {
    const server = createServerGraph();

    const result = validateAuthoritativeTotalSyncPayload(
      {
        ...createTotalSyncPayload(server.store, { cursor: "server:1" }),
        mode: "delta",
        scope: { kind: "partial" },
        cursor: 1,
        completeness: "incomplete",
        freshness: "future",
        snapshot: {
          edges: [
            { id: "edge-1", s: "node-1", p: "predicate-1", o: "object-1" },
            { id: "edge-1", s: "node-2", p: "predicate-2", o: "object-2" },
          ],
          retracted: ["missing-edge"],
        },
      } as unknown as ReturnType<typeof createTotalSyncPayload>,
      app,
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
      changedPredicateKeys: ["$sync:payload"],
    });
    if (result.ok) throw new Error("Expected malformed total-sync payload validation to fail");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "sync.mode",
          predicateKey: "$sync:payload",
          nodeId: "$sync:payload",
        }),
        expect.objectContaining({
          source: "runtime",
          code: "sync.scope",
          predicateKey: "$sync:payload",
          nodeId: "$sync:payload",
        }),
        expect.objectContaining({
          source: "runtime",
          code: "sync.cursor",
          predicateKey: "$sync:payload",
          nodeId: "$sync:payload",
        }),
        expect.objectContaining({
          source: "runtime",
          code: "sync.completeness",
          predicateKey: "$sync:payload",
          nodeId: "$sync:payload",
        }),
        expect.objectContaining({
          source: "runtime",
          code: "sync.freshness",
          predicateKey: "$sync:payload",
          nodeId: "$sync:payload",
        }),
        expect.objectContaining({
          source: "runtime",
          code: "sync.snapshot.edge.id.duplicate",
          predicateKey: "$sync:payload",
          nodeId: "$sync:payload",
        }),
        expect.objectContaining({
          source: "runtime",
          code: "sync.snapshot.retracted.missing",
          predicateKey: "$sync:payload",
          nodeId: "$sync:payload",
        }),
      ]),
    );
    expect(
      formatValidationPath(
        result.issues.find((issue) => issue.code === "sync.snapshot.edge.id.duplicate")?.path ?? [],
      ),
    ).toBe("snapshot.edges[1].id");
    expect(
      formatValidationPath(
        result.issues.find((issue) => issue.code === "sync.snapshot.retracted.missing")?.path ?? [],
      ),
    ).toBe("snapshot.retracted[0]");
  });

  it("rejects retracted ids that are absent even when snapshot.edges is empty", () => {
    const server = createServerGraph();

    const result = validateAuthoritativeTotalSyncPayload(
      {
        ...createTotalSyncPayload(server.store, { cursor: "server:1" }),
        snapshot: {
          edges: [],
          retracted: ["missing-edge"],
        },
      },
      app,
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
      changedPredicateKeys: ["$sync:payload"],
    });
    if (result.ok) throw new Error("Expected malformed total-sync payload validation to fail");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "sync.snapshot.retracted.missing",
          predicateKey: "$sync:payload",
          nodeId: "$sync:payload",
          path: ["snapshot", "retracted[0]"],
        }),
      ]),
    );
  });

  it("lets lower-level total sync controllers reuse the same authoritative validation hook", () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
    });

    const clientStore = createStore();
    bootstrap(clientStore, core);
    bootstrap(clientStore, app);
    const clientGraph = createTypeClient(clientStore, app);
    const sync = createTotalSyncController(clientStore, {
      pull: () => createTotalSyncPayload(server.store, { cursor: "server:1" }),
      validate: createAuthoritativeTotalSyncValidator(app),
    });

    sync.apply(createTotalSyncPayload(server.store, { cursor: "server:1" }));
    expect(clientGraph.company.get(acmeId).name).toBe("Acme Corp");

    for (const edge of server.store.facts(acmeId, edgeId(app.company.fields.name))) {
      server.store.retract(edge.id);
    }
    server.store.assert(acmeId, edgeId(app.company.fields.name), "   ");

    let error: unknown;
    try {
      sync.apply(createTotalSyncPayload(server.store, { cursor: "server:2" }));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<void>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
    });
    expect(sync.getState()).toMatchObject({
      status: "ready",
      cursor: "server:1",
      freshness: "current",
    });
    expect(clientGraph.company.get(acmeId).name).toBe("Acme Corp");
  });

  it("rejects malformed total-sync envelopes through sync.apply without replacing local state", async () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
    });

    const client = createSyncedTypeClient(app, {
      pull: () => createTotalSyncPayload(server.store, { cursor: "server:1" }),
    });

    await client.sync.sync();
    expect(client.graph.company.get(acmeId).name).toBe("Acme Corp");

    let error: unknown;
    try {
      client.sync.apply({
        ...createTotalSyncPayload(server.store, { cursor: "server:2" }),
        cursor: 2,
      } as unknown as ReturnType<typeof createTotalSyncPayload>);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<void>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
      changedPredicateKeys: ["$sync:payload"],
    });
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "sync.cursor",
          predicateKey: "$sync:payload",
          nodeId: "$sync:payload",
        }),
      ]),
    );
    expect(formatValidationPath(validationError.result.issues[0]?.path ?? [])).toBe("cursor");
    expect(client.sync.getState()).toMatchObject({
      status: "ready",
      cursor: "server:1",
      freshness: "current",
    });
    expect(client.graph.company.get(acmeId).name).toBe("Acme Corp");
  });

  it("rejects malformed total-sync snapshot shapes through sync.apply without replacing local state", async () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
    });

    const client = createSyncedTypeClient(app, {
      pull: () => createTotalSyncPayload(server.store, { cursor: "server:1" }),
    });

    await client.sync.sync();
    expect(client.graph.company.get(acmeId).name).toBe("Acme Corp");

    let error: unknown;
    try {
      client.sync.apply({
        ...createTotalSyncPayload(server.store, { cursor: "server:2" }),
        snapshot: {
          edges: null,
          retracted: [],
        },
      } as unknown as ReturnType<typeof createTotalSyncPayload>);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<void>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
      changedPredicateKeys: ["$sync:payload"],
    });
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "sync.snapshot.edges",
          predicateKey: "$sync:payload",
          nodeId: "$sync:payload",
        }),
      ]),
    );
    expect(
      formatValidationPath(
        validationError.result.issues.find((issue) => issue.code === "sync.snapshot.edges")?.path ??
          [],
      ),
    ).toBe("snapshot.edges");
    expect(client.sync.getState()).toMatchObject({
      status: "ready",
      cursor: "server:1",
      freshness: "current",
    });
    expect(client.graph.company.get(acmeId).name).toBe("Acme Corp");
  });

  it("lets lower-level total sync sessions reuse the same authoritative validation hook across apply and pull", async () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
    });

    const clientStore = createStore();
    bootstrap(clientStore, core);
    bootstrap(clientStore, app);
    const clientGraph = createTypeClient(clientStore, app);
    const session = createTotalSyncSession(clientStore, {
      validate: createAuthoritativeTotalSyncValidator(app),
    });

    session.apply(createTotalSyncPayload(server.store, { cursor: "server:1" }));
    expect(clientGraph.company.get(acmeId).name).toBe("Acme Corp");
    expect(session.getState()).toMatchObject({
      status: "ready",
      cursor: "server:1",
      freshness: "current",
    });

    for (const edge of server.store.facts(acmeId, edgeId(app.company.fields.name))) {
      server.store.retract(edge.id);
    }
    server.store.assert(acmeId, edgeId(app.company.fields.name), "   ");

    let applyError: unknown;
    try {
      session.apply(createTotalSyncPayload(server.store, { cursor: "server:2" }));
    } catch (caught) {
      applyError = caught;
    }

    expect(applyError).toBeInstanceOf(GraphValidationError);
    expect(session.getState()).toMatchObject({
      status: "ready",
      cursor: "server:1",
      freshness: "current",
    });
    expect(clientGraph.company.get(acmeId).name).toBe("Acme Corp");

    let pullError: unknown;
    try {
      await session.pull(() => createTotalSyncPayload(server.store, { cursor: "server:3" }));
    } catch (caught) {
      pullError = caught;
    }

    expect(pullError).toBeInstanceOf(GraphValidationError);
    const validationError = pullError as GraphValidationError<void>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
    });
    expect(session.getState()).toMatchObject({
      status: "error",
      cursor: "server:1",
      freshness: "stale",
    });
    expect(clientGraph.company.get(acmeId).name).toBe("Acme Corp");
  });

  it("lets lower-level total sync sessions preserve bootstrapped schema for data-only payloads", () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
    });

    const clientStore = createStore();
    bootstrap(clientStore, core);
    bootstrap(clientStore, app);
    const preserveSnapshot = clientStore.snapshot();
    const clientGraph = createTypeClient(clientStore, app);
    const session = createTotalSyncSession(clientStore, {
      preserveSnapshot,
      validate: createAuthoritativeTotalSyncValidator(app),
    });

    const dataOnlyPayload = createDataOnlyTotalSyncPayload(server.store, {
      cursor: "server:data-only:1",
    });
    const payload = session.apply(dataOnlyPayload);

    expect(dataOnlyPayload.snapshot.edges.some((edge) => edge.s === typeId(app.company))).toBe(false);
    expect(payload.snapshot.edges.some((edge) => edge.s === typeId(app.company))).toBe(true);
    expect(clientGraph.company.get(acmeId).name).toBe("Acme Corp");
    expect(
      clientGraph.company.validateUpdate(acmeId, {
        name: "Acme Graph Labs",
      }),
    ).toMatchObject({
      ok: true,
      phase: "local",
      event: "update",
    });
  });

  it("rejects authoritative snapshots with non-finite scalar values and preserves local state", async () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
    });
    let cursor = 0;

    const client = createSyncedTypeClient(app, {
      pull: () =>
        createTotalSyncPayload(server.store, {
          cursor: `server:${(cursor += 1)}`,
        }),
    });

    await client.sync.sync();
    expect(client.graph.company.get(acmeId).foundedYear).toBeUndefined();

    server.store.assert(acmeId, edgeId(app.company.fields.foundedYear), "NaN");

    let error: unknown;
    try {
      await client.sync.sync();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<void>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
    });
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "type",
          code: "number.notFinite",
          predicateKey: app.company.fields.foundedYear.key,
          nodeId: acmeId,
        }),
      ]),
    );
    expect(formatValidationPath(validationError.result.issues[0]?.path ?? [])).toBe("foundedYear");
    expect(client.sync.getState()).toMatchObject({
      status: "error",
      cursor: "server:1",
      freshness: "stale",
    });
    expect(client.graph.company.get(acmeId).foundedYear).toBeUndefined();
  });

  it("rejects authoritative snapshots with invalid boolean scalar values and preserves local state", async () => {
    const server = createServerGraph();
    const blockId = server.graph.block.create({
      name: "Outline",
      text: "Plan",
      order: 1,
      collapsed: true,
    });
    let cursor = 0;

    const client = createSyncedTypeClient(app, {
      pull: () =>
        createTotalSyncPayload(server.store, {
          cursor: `server:${(cursor += 1)}`,
        }),
    });

    await client.sync.sync();
    expect(client.graph.block.get(blockId).collapsed).toBe(true);

    for (const edge of server.store.facts(blockId, edgeId(app.block.fields.collapsed))) {
      server.store.retract(edge.id);
    }
    server.store.assert(blockId, edgeId(app.block.fields.collapsed), "0");

    let error: unknown;
    try {
      await client.sync.sync();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<void>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
    });
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "type",
          code: "value.invalid",
          predicateKey: app.block.fields.collapsed.key,
          nodeId: blockId,
        }),
      ]),
    );
    expect(formatValidationPath(validationError.result.issues[0]?.path ?? [])).toBe("collapsed");
    expect(client.sync.getState()).toMatchObject({
      status: "error",
      cursor: "server:1",
      freshness: "stale",
    });
    expect(client.graph.block.get(blockId).collapsed).toBe(true);
  });

  it("rejects authoritative snapshots with invalid enum values and preserves local state", async () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
    });
    let cursor = 0;

    const client = createSyncedTypeClient(app, {
      pull: () =>
        createTotalSyncPayload(server.store, {
          cursor: `server:${(cursor += 1)}`,
        }),
    });

    await client.sync.sync();
    expect(client.graph.company.get(acmeId).status).toBe(app.status.values.active.id);

    for (const edge of server.store.facts(acmeId, edgeId(app.company.fields.status))) {
      server.store.retract(edge.id);
    }
    server.store.assert(acmeId, edgeId(app.company.fields.status), "active");

    let error: unknown;
    try {
      await client.sync.sync();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<void>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
    });
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "type",
          code: "enum.member",
          predicateKey: app.company.fields.status.key,
          nodeId: acmeId,
        }),
      ]),
    );
    expect(formatValidationPath(validationError.result.issues[0]?.path ?? [])).toBe("status");
    expect(client.sync.getState()).toMatchObject({
      status: "error",
      cursor: "server:1",
      freshness: "stale",
    });
    expect(client.graph.company.get(acmeId).status).toBe(app.status.values.active.id);
  });

  it("rejects authoritative snapshots with wrong-type entity references and preserves local state", async () => {
    const server = createServerGraph();
    const companyId = server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
    });
    const personId = server.graph.person.create({
      name: "Alice",
      worksAt: [companyId],
    });
    const otherPersonId = server.graph.person.create({
      name: "Bob",
    });
    let cursor = 0;

    const client = createSyncedTypeClient(app, {
      pull: () =>
        createTotalSyncPayload(server.store, {
          cursor: `server:${(cursor += 1)}`,
        }),
    });

    await client.sync.sync();
    expect(client.graph.person.get(personId).worksAt).toEqual([companyId]);

    for (const edge of server.store.facts(personId, edgeId(app.person.fields.worksAt))) {
      server.store.retract(edge.id);
    }
    server.store.assert(personId, edgeId(app.person.fields.worksAt), otherPersonId);

    let error: unknown;
    try {
      await client.sync.sync();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<void>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
    });
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "reference.type",
          predicateKey: app.person.fields.worksAt.key,
          nodeId: personId,
        }),
      ]),
    );
    expect(formatValidationPath(validationError.result.issues[0]?.path ?? [])).toBe("worksAt");
    expect(client.sync.getState()).toMatchObject({
      status: "error",
      cursor: "server:1",
      freshness: "stale",
    });
    expect(client.graph.person.get(personId).worksAt).toEqual([companyId]);
  });

  it("rejects authoritative snapshots with untyped data-bearing nodes and preserves local state", async () => {
    const server = createServerGraph();
    const companyId = server.graph.company.create({
      name: "Acme Corp",
      status: app.status.values.active.id,
      website: new URL("https://acme.com"),
    });
    let cursor = 0;

    const client = createSyncedTypeClient(app, {
      pull: () =>
        createTotalSyncPayload(server.store, {
          cursor: `server:${(cursor += 1)}`,
        }),
    });

    await client.sync.sync();
    expect(client.graph.company.get(companyId).type).toEqual([app.company.values.id]);

    for (const edge of server.store.facts(companyId, edgeId(core.node.fields.type))) {
      server.store.retract(edge.id);
    }

    let error: unknown;
    try {
      await client.sync.sync();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<void>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
    });
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "type.required",
          predicateKey: core.node.fields.type.key,
          nodeId: companyId,
        }),
      ]),
    );
    expect(formatValidationPath(validationError.result.issues[0]?.path ?? [])).toBe("type");
    expect(client.sync.getState()).toMatchObject({
      status: "error",
      cursor: "server:1",
      freshness: "stale",
    });
    expect(client.graph.company.get(companyId).type).toEqual([app.company.values.id]);
  });
});
