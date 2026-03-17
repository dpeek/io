import { describe, expect, it } from "bun:test";

import {
  GraphSyncWriteError,
  GraphValidationError,
  bootstrap,
  createAuthoritativeGraphWriteResultValidator,
  createAuthoritativeGraphWriteSession,
  createAuthoritativeTotalSyncValidator,
  createGraphWriteOperationsFromSnapshots,
  createGraphWriteTransactionFromSnapshots,
  createStore,
  createSyncedTypeClient,
  createTotalSyncController,
  createTotalSyncPayload,
  createTotalSyncSession,
  createTypeClient,
  core,
  edgeId,
  formatValidationPath,
  type GraphWriteTransaction,
  typeId,
  validateAuthoritativeGraphWriteResult,
  validateAuthoritativeGraphWriteTransaction,
  validateAuthoritativeTotalSyncPayload,
  validateIncrementalSyncPayload,
  validateIncrementalSyncResult,
} from "@io/core/graph";

import { testNamespace } from "./test-graph.js";

function createServerGraph() {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, testNamespace);

  return {
    coreGraph: createTypeClient(store, core),
    store,
    graph: createTypeClient(store, testNamespace),
  };
}

function createCompanyTagSet(coreGraph: ReturnType<typeof createServerGraph>["coreGraph"]) {
  return {
    enterpriseTagId: coreGraph.tag.create({
      name: "Enterprise",
      key: "enterprise",
      color: "#6366f1",
    }),
    saasTagId: coreGraph.tag.create({
      name: "SaaS",
      key: "saas",
      color: "#10b981",
    }),
    aiTagId: coreGraph.tag.create({
      name: "AI",
      key: "ai",
      color: "#f59e0b",
    }),
    platformTagId: coreGraph.tag.create({
      name: "Platform",
      key: "platform",
      color: "#0ea5e9",
    }),
  };
}

function createDataOnlyTotalSyncPayload(
  store: ReturnType<typeof createServerGraph>["store"],
  options: Parameters<typeof createTotalSyncPayload>[1] = {},
) {
  const dataOnlyStore = createStore();
  const entityTypeIds = new Set(
    Object.values(testNamespace)
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
    dataOnlyStore.assertEdge({ ...edge });
  }

  return createTotalSyncPayload(dataOnlyStore, options);
}

function createCompanyNameWriteTransaction(
  store: ReturnType<typeof createServerGraph>["store"],
  companyId: string,
  name: string,
  txId: string,
  options: {
    assertFirst?: boolean;
    edgeId?: string;
  } = {},
): GraphWriteTransaction {
  const retractOps = store
    .facts(companyId, edgeId(testNamespace.company.fields.name))
    .map((edge) => ({
      op: "retract" as const,
      edgeId: edge.id,
    }));
  const assertOp = {
    op: "assert" as const,
    edge: {
      id: options.edgeId ?? store.newNode(),
      s: companyId,
      p: edgeId(testNamespace.company.fields.name),
      o: name,
    },
  };

  return {
    id: txId,
    ops: options.assertFirst ? [assertOp, ...retractOps] : [...retractOps, assertOp],
  };
}

describe("total sync", () => {
  it("runs synced-client local edits through the same local validation boundary before sync", () => {
    const server = createServerGraph();
    const client = createSyncedTypeClient(testNamespace, {
      pull: () => createTotalSyncPayload(server.store, { cursor: "server:1" }),
    });

    const valid = client.graph.company.validateCreate({
      name: "Local draft",
      status: testNamespace.status.values.draft.id,
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
      status: testNamespace.status.values.draft.id,
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
          predicateKey: testNamespace.company.fields.name.key,
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
      status: testNamespace.status.values.draft.id,
      website: new URL("https://draft.example"),
    });

    expect(client.graph.company.get(localId)).toMatchObject({
      id: localId,
      name: "Local draft",
      status: testNamespace.status.values.draft.id,
    });
    expect(client.graph.company.get(localId).website.toString()).toBe("https://draft.example/");
    expect(client.sync.getState()).toMatchObject({
      status: "idle",
      completeness: "incomplete",
      freshness: "stale",
    });
  });

  it("queues pending write transactions for create, update, delete, and predicate edits after local commit", () => {
    const server = createServerGraph();
    const { enterpriseTagId, platformTagId } = createCompanyTagSet(server.coreGraph);
    const companyId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
      tags: [enterpriseTagId],
    });

    const createClient = createSyncedTypeClient(testNamespace, {
      pull: () => createTotalSyncPayload(server.store, { cursor: "server:create" }),
    });
    const createdId = createClient.graph.company.create({
      name: "Queued Create",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://queued.example"),
    });
    const createPending = createClient.sync.getPendingTransactions();
    expect(createPending).toHaveLength(1);
    expect(createPending[0]).toMatchObject({
      id: "local:1",
    });
    expect(createPending[0]?.ops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          op: "assert",
          edge: expect.objectContaining({
            s: createdId,
            p: edgeId(core.node.fields.type),
            o: testNamespace.company.values.id,
          }),
        }),
        expect.objectContaining({
          op: "assert",
          edge: expect.objectContaining({
            s: createdId,
            p: edgeId(testNamespace.company.fields.name),
            o: "Queued Create",
          }),
        }),
      ]),
    );
    expect(createClient.sync.getState().pendingCount).toBe(1);

    const updateClient = createSyncedTypeClient(testNamespace, {
      pull: () => createTotalSyncPayload(server.store, { cursor: "server:update" }),
    });
    updateClient.sync.apply(createTotalSyncPayload(server.store, { cursor: "server:update" }));
    updateClient.graph.company.update(companyId, {
      name: "Queued Update",
    });
    expect(updateClient.sync.getPendingTransactions()).toEqual([
      expect.objectContaining({
        id: "local:1",
        ops: expect.arrayContaining([
          expect.objectContaining({ op: "retract" }),
          expect.objectContaining({
            op: "assert",
            edge: expect.objectContaining({
              s: companyId,
              p: edgeId(testNamespace.company.fields.name),
              o: "Queued Update",
            }),
          }),
        ]),
      }),
    ]);

    const deleteClient = createSyncedTypeClient(testNamespace, {
      pull: () => createTotalSyncPayload(server.store, { cursor: "server:delete" }),
    });
    deleteClient.sync.apply(createTotalSyncPayload(server.store, { cursor: "server:delete" }));
    deleteClient.graph.company.delete(companyId);
    const deletePending = deleteClient.sync.getPendingTransactions();
    expect(deletePending).toHaveLength(1);
    expect(deletePending[0]?.ops.every((operation) => operation.op === "retract")).toBe(true);

    const predicateClient = createSyncedTypeClient(testNamespace, {
      pull: () => createTotalSyncPayload(server.store, { cursor: "server:predicate" }),
    });
    predicateClient.sync.apply(
      createTotalSyncPayload(server.store, { cursor: "server:predicate" }),
    );
    predicateClient.graph.company.ref(companyId).fields.tags.add(platformTagId);
    expect(predicateClient.sync.getPendingTransactions()).toEqual([
      expect.objectContaining({
        id: "local:1",
        ops: expect.arrayContaining([
          expect.objectContaining({
            op: "assert",
            edge: expect.objectContaining({
              s: companyId,
              p: edgeId(testNamespace.company.fields.tags),
              o: platformTagId,
            }),
          }),
        ]),
      }),
    ]);
  });

  it("flushes queued pending writes through the authority and clears them after acknowledgement", async () => {
    const server = createServerGraph();
    const { enterpriseTagId, platformTagId } = createCompanyTagSet(server.coreGraph);
    const companyId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
      tags: [enterpriseTagId],
    });
    const authority = createAuthoritativeGraphWriteSession(server.store, testNamespace, {
      cursorPrefix: "server:",
    });
    const client = createSyncedTypeClient(testNamespace, {
      pull: () =>
        createTotalSyncPayload(server.store, { cursor: authority.getCursor() ?? "server:0" }),
      push: (transaction) => authority.apply(transaction),
    });

    client.sync.apply(createTotalSyncPayload(server.store, { cursor: "server:0" }));
    client.graph.company.update(companyId, {
      name: "Acme Flush Labs",
    });
    client.graph.company.ref(companyId).fields.tags.add(platformTagId);

    expect(client.sync.getPendingTransactions()).toHaveLength(2);

    const results = await client.sync.flush();

    expect(results).toEqual([
      expect.objectContaining({
        txId: "local:1",
        cursor: "server:1",
        replayed: false,
      }),
      expect.objectContaining({
        txId: "local:2",
        cursor: "server:2",
        replayed: false,
      }),
    ]);
    expect(client.sync.getPendingTransactions()).toEqual([]);
    expect(client.sync.getState()).toMatchObject({
      status: "ready",
      cursor: "server:2",
      completeness: "complete",
      freshness: "current",
      pendingCount: 0,
    });
    expect(server.graph.company.get(companyId)).toMatchObject({
      id: companyId,
      name: "Acme Flush Labs",
    });
    expect([...server.graph.company.get(companyId).tags].sort()).toEqual(
      [enterpriseTagId, platformTagId].sort(),
    );
    expect(client.graph.company.get(companyId)).toMatchObject({
      id: companyId,
      name: "Acme Flush Labs",
    });
    expect([...client.graph.company.get(companyId).tags].sort()).toEqual(
      [enterpriseTagId, platformTagId].sort(),
    );
  });

  it("keeps failed pending pushes retryable and surfaces structured flush errors", async () => {
    const server = createServerGraph();
    const companyId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });
    const authority = createAuthoritativeGraphWriteSession(server.store, testNamespace, {
      cursorPrefix: "server:",
    });
    let shouldFail = true;
    const client = createSyncedTypeClient(testNamespace, {
      pull: () =>
        createTotalSyncPayload(server.store, { cursor: authority.getCursor() ?? "server:0" }),
      push(transaction) {
        if (shouldFail) {
          shouldFail = false;
          throw new Error("push failed");
        }
        return authority.apply(transaction);
      },
    });

    client.sync.apply(createTotalSyncPayload(server.store, { cursor: "server:0" }));
    client.graph.company.update(companyId, {
      name: "Acme Retry Labs",
    });

    await expect(client.sync.flush()).rejects.toBeInstanceOf(GraphSyncWriteError);

    expect(client.sync.getPendingTransactions()).toHaveLength(1);
    expect(client.sync.getState()).toMatchObject({
      status: "error",
      cursor: "server:0",
      freshness: "stale",
      pendingCount: 1,
    });
    expect(client.sync.getState().error).toBeInstanceOf(GraphSyncWriteError);
    const writeError = client.sync.getState().error as GraphSyncWriteError;
    expect(writeError.transaction).toMatchObject({
      id: "local:1",
    });
    expect(writeError.cause).toBeInstanceOf(Error);
    expect(client.graph.company.get(companyId).name).toBe("Acme Retry Labs");
    expect(server.graph.company.get(companyId).name).toBe("Acme Corp");

    const retry = await client.sync.flush();

    expect(retry).toEqual([
      expect.objectContaining({
        txId: "local:1",
        cursor: "server:1",
      }),
    ]);
    expect(client.sync.getPendingTransactions()).toEqual([]);
    expect(client.graph.company.get(companyId).name).toBe("Acme Retry Labs");
    expect(server.graph.company.get(companyId).name).toBe("Acme Retry Labs");
  });

  it("keeps total sync as a recovery path after pending push failures", async () => {
    const server = createServerGraph();
    const companyId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });
    const client = createSyncedTypeClient(testNamespace, {
      pull: () => createTotalSyncPayload(server.store, { cursor: "server:recovery" }),
      push() {
        throw new Error("push failed");
      },
    });

    client.sync.apply(createTotalSyncPayload(server.store, { cursor: "server:0" }));
    client.graph.company.update(companyId, {
      name: "Local Diverged Name",
    });

    await expect(client.sync.flush()).rejects.toBeInstanceOf(GraphSyncWriteError);
    expect(client.sync.getPendingTransactions()).toHaveLength(1);
    expect(client.graph.company.get(companyId).name).toBe("Local Diverged Name");

    const recovered = await client.sync.sync();

    expect(recovered.cursor).toBe("server:recovery");
    expect(client.sync.getPendingTransactions()).toEqual([]);
    expect(client.sync.getState()).toMatchObject({
      status: "ready",
      cursor: "server:recovery",
      freshness: "current",
      pendingCount: 0,
    });
    expect(client.graph.company.get(companyId).name).toBe("Acme Corp");
  });

  it("treats an accepted total snapshot as authoritative over valid local optimistic edits", async () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });

    const client = createSyncedTypeClient(testNamespace, {
      pull: () => createTotalSyncPayload(server.store, { cursor: "server:1" }),
    });

    const localId = client.graph.company.create({
      name: "Local draft",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://draft.example"),
    });

    expect(client.graph.company.list().map((company) => company.id)).toEqual([localId]);

    const payload = await client.sync.sync();

    expect(payload.cursor).toBe("server:1");
    expect(client.graph.company.list().map((company) => company.id)).toEqual([acmeId]);
    expect(client.graph.company.get(acmeId)).toMatchObject({
      id: acmeId,
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
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
      status: testNamespace.status.values.draft.id,
      foundedYear: 1987,
      website: new URL("https://acme.com"),
    });
    const estiiId = server.graph.company.create({
      name: "Estii",
      status: testNamespace.status.values.approved.id,
      website: new URL("https://estii.com"),
    });

    const client = createSyncedTypeClient(testNamespace, {
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
      status: testNamespace.status.values.draft.id,
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
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });

    const dataOnlyPayload = createDataOnlyTotalSyncPayload(server.store, {
      cursor: "server:data-only:1",
    });
    const client = createSyncedTypeClient(testNamespace, {
      pull: () => dataOnlyPayload,
    });

    const payload = await client.sync.sync();

    expect(payload.mode).toBe("total");
    if (payload.mode !== "total") throw new Error("Expected total sync bootstrap payload.");
    expect(payload.cursor).toBe("server:data-only:1");
    expect(
      dataOnlyPayload.snapshot.edges.some((edge) => edge.s === typeId(testNamespace.company)),
    ).toBe(false);
    expect(payload.snapshot.edges.some((edge) => edge.s === typeId(testNamespace.company))).toBe(
      true,
    );
    expect(client.graph.company.list().map((company) => company.id)).toEqual([acmeId]);
    expect(client.graph.company.get(acmeId)).toMatchObject({
      id: acmeId,
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
    });

    const validation = client.graph.company.validateUpdate(acmeId, {
      name: "Acme Graph Labs",
    });

    expect(validation).toMatchObject({
      ok: true,
      phase: "local",
      event: "update",
    });
    if (!validation.ok)
      throw new Error("Expected local validation to stay usable after data-only sync");

    client.graph.company.update(acmeId, {
      name: "Acme Graph Labs",
    });
    expect(client.graph.company.get(acmeId).name).toBe("Acme Graph Labs");
  });

  it("materializes data-only payloads through synced-client sync.apply", () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });

    const dataOnlyPayload = createDataOnlyTotalSyncPayload(server.store, {
      cursor: "server:data-only:apply",
    });
    const client = createSyncedTypeClient(testNamespace, {
      pull: () => dataOnlyPayload,
    });

    const payload = client.sync.apply(dataOnlyPayload);

    expect(payload.mode).toBe("total");
    if (payload.mode !== "total") throw new Error("Expected total sync apply payload.");
    expect(payload.cursor).toBe("server:data-only:apply");
    expect(
      dataOnlyPayload.snapshot.edges.some((edge) => edge.s === typeId(testNamespace.company)),
    ).toBe(false);
    expect(payload.snapshot.edges.some((edge) => edge.s === typeId(testNamespace.company))).toBe(
      true,
    );
    expect(payload.snapshot.edges).toEqual(expect.arrayContaining(dataOnlyPayload.snapshot.edges));
    expect(client.graph.company.list().map((company) => company.id)).toEqual([acmeId]);
    expect(client.graph.company.get(acmeId)).toMatchObject({
      id: acmeId,
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
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
    if (!validation.ok)
      throw new Error("Expected local validation to stay usable after sync.apply");
  });

  it("applies authoritative write results incrementally while preserving sync state and schema baseline", async () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });

    const client = createSyncedTypeClient(testNamespace, {
      pull: () =>
        createDataOnlyTotalSyncPayload(server.store, {
          cursor: "server:data-only:1",
        }),
    });

    await client.sync.sync();

    const acme = client.graph.company.ref(acmeId);
    let nameNotifications = 0;
    let websiteNotifications = 0;
    const unsubscribeName = acme.fields.name.subscribe(() => {
      nameNotifications += 1;
    });
    const unsubscribeWebsite = acme.fields.website.subscribe(() => {
      websiteNotifications += 1;
    });

    const authority = createAuthoritativeGraphWriteSession(server.store, testNamespace, {
      cursorPrefix: "server:",
    });
    const result = authority.apply(
      createCompanyNameWriteTransaction(server.store, acmeId, "Acme Graph Labs", "tx:1"),
    );

    const applied = client.sync.applyWriteResult(result);

    expect(applied).toMatchObject({
      txId: "tx:1",
      cursor: "server:1",
      replayed: false,
    });
    expect(client.graph.company.get(acmeId)).toMatchObject({
      id: acmeId,
      name: "Acme Graph Labs",
      status: testNamespace.status.values.draft.id,
    });
    expect(client.graph.company.get(acmeId).website.toString()).toBe("https://acme.com/");
    expect(client.sync.getState()).toMatchObject({
      status: "ready",
      completeness: "complete",
      freshness: "current",
      cursor: "server:1",
    });
    expect(nameNotifications).toBe(1);
    expect(websiteNotifications).toBe(0);

    const validation = client.graph.company.validateUpdate(acmeId, {
      name: "Acme After Incremental",
    });

    expect(validation).toMatchObject({
      ok: true,
      phase: "local",
      event: "update",
    });
    if (!validation.ok)
      throw new Error("Expected schema baseline to remain valid after write replay");

    unsubscribeName();
    unsubscribeWebsite();
  });

  it("keeps predicate-slot notifications precise when incremental reconciliation preserves the logical value", async () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });

    const client = createSyncedTypeClient(testNamespace, {
      pull: () => createTotalSyncPayload(server.store, { cursor: "server:0" }),
    });

    await client.sync.sync();

    const acme = client.graph.company.ref(acmeId);
    let nameNotifications = 0;
    const unsubscribeName = acme.fields.name.subscribe(() => {
      nameNotifications += 1;
    });

    const authority = createAuthoritativeGraphWriteSession(server.store, testNamespace, {
      cursorPrefix: "server:",
      initialSequence: 0,
    });
    const result = authority.apply(
      createCompanyNameWriteTransaction(server.store, acmeId, "Acme Corp", "tx:same-value"),
    );

    client.sync.applyWriteResult(result);

    expect(nameNotifications).toBe(0);
    expect(client.graph.company.get(acmeId).name).toBe("Acme Corp");
    expect(client.sync.getState()).toMatchObject({
      status: "ready",
      cursor: "server:1",
      completeness: "complete",
      freshness: "current",
    });

    unsubscribeName();
  });

  it("pulls incremental authoritative batches after the current cursor without notifying unrelated predicate slots", async () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });
    const betaId = server.graph.company.create({
      name: "Beta Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://beta.example"),
    });
    const authority = createAuthoritativeGraphWriteSession(server.store, testNamespace, {
      cursorPrefix: "server:",
    });

    const client = createSyncedTypeClient(testNamespace, {
      pull: (state) =>
        state.cursor
          ? authority.getIncrementalSyncResult(state.cursor)
          : createTotalSyncPayload(server.store, {
              cursor: authority.getBaseCursor(),
            }),
    });

    await client.sync.sync();

    const acme = client.graph.company.ref(acmeId);
    const beta = client.graph.company.ref(betaId);
    let acmeNameNotifications = 0;
    let acmeWebsiteNotifications = 0;
    let betaNameNotifications = 0;
    const unsubscribeAcmeName = acme.fields.name.subscribe(() => {
      acmeNameNotifications += 1;
    });
    const unsubscribeAcmeWebsite = acme.fields.website.subscribe(() => {
      acmeWebsiteNotifications += 1;
    });
    const unsubscribeBetaName = beta.fields.name.subscribe(() => {
      betaNameNotifications += 1;
    });

    const first = authority.apply(
      createCompanyNameWriteTransaction(server.store, acmeId, "Acme Incremental One", "tx:1"),
    );
    const second = authority.apply(
      createCompanyNameWriteTransaction(server.store, acmeId, "Acme Incremental Two", "tx:2"),
    );

    const applied = await client.sync.sync();

    expect(applied.mode).toBe("incremental");
    expect("fallback" in applied).toBe(false);
    if ("fallback" in applied) {
      throw new Error("Expected a data-bearing incremental sync result.");
    }
    expect(applied).toEqual({
      mode: "incremental",
      scope: { kind: "graph" },
      after: authority.getBaseCursor(),
      transactions: [first, second],
      cursor: second.cursor,
      completeness: "complete",
      freshness: "current",
    });
    expect(client.graph.company.get(acmeId).name).toBe("Acme Incremental Two");
    expect(client.graph.company.get(acmeId).website.toString()).toBe("https://acme.com/");
    expect(client.graph.company.get(betaId).name).toBe("Beta Corp");
    expect(acmeNameNotifications).toBe(1);
    expect(acmeWebsiteNotifications).toBe(0);
    expect(betaNameNotifications).toBe(0);
    expect(client.sync.getState()).toMatchObject({
      status: "ready",
      cursor: second.cursor,
      completeness: "complete",
      freshness: "current",
    });

    unsubscribeAcmeName();
    unsubscribeAcmeWebsite();
    unsubscribeBetaName();
  });

  it("preserves queued local mutations when synced clients pull incremental authoritative batches", async () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });
    const betaId = server.graph.company.create({
      name: "Beta Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://beta.example"),
    });
    const authority = createAuthoritativeGraphWriteSession(server.store, testNamespace, {
      cursorPrefix: "server:",
    });
    const client = createSyncedTypeClient(testNamespace, {
      pull: (state) =>
        state.cursor
          ? authority.getIncrementalSyncResult(state.cursor)
          : createTotalSyncPayload(server.store, {
              cursor: authority.getBaseCursor(),
            }),
    });

    await client.sync.sync();

    client.graph.company.update(betaId, {
      name: "Beta Local Draft",
    });
    const peerResult = authority.apply(
      createCompanyNameWriteTransaction(server.store, acmeId, "Acme From Peer", "tx:peer"),
    );

    const applied = await client.sync.sync();

    expect(applied.mode).toBe("incremental");
    expect("fallback" in applied).toBe(false);
    if ("fallback" in applied) {
      throw new Error("Expected a data-bearing incremental sync result.");
    }
    expect(applied.cursor).toBe(peerResult.cursor);
    expect(client.sync.getPendingTransactions()).toEqual([
      expect.objectContaining({
        id: "local:1",
      }),
    ]);
    expect(client.sync.getState()).toMatchObject({
      status: "ready",
      cursor: peerResult.cursor,
      completeness: "complete",
      freshness: "current",
      pendingCount: 1,
    });
    expect(client.graph.company.get(acmeId).name).toBe("Acme From Peer");
    expect(client.graph.company.get(betaId).name).toBe("Beta Local Draft");
  });

  it("routes invalid incremental batches back to total snapshot recovery without partial local state", async () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });
    const authority = createAuthoritativeGraphWriteSession(server.store, testNamespace, {
      cursorPrefix: "server:",
    });
    let first: ReturnType<typeof authority.apply> | undefined;
    let second: ReturnType<typeof authority.apply> | undefined;
    let invalidResult:
      | (ReturnType<typeof authority.apply> & {
          transaction: GraphWriteTransaction;
        })
      | undefined;
    let pullCount = 0;

    const client = createSyncedTypeClient(testNamespace, {
      pull: (state) => {
        if (!state.cursor) {
          return createTotalSyncPayload(server.store, {
            cursor: authority.getBaseCursor(),
          });
        }

        pullCount += 1;
        if (pullCount === 1) {
          if (!first || !invalidResult || !second) {
            throw new Error("Expected incremental batch fixtures to be initialized before pull.");
          }
          return {
            mode: "incremental",
            scope: { kind: "graph" },
            after: state.cursor,
            transactions: [first, invalidResult],
            cursor: second.cursor,
            completeness: "complete",
            freshness: "current",
          };
        }

        return createTotalSyncPayload(server.store, {
          cursor: authority.getCursor() ?? authority.getBaseCursor(),
        });
      },
    });

    await client.sync.sync();
    expect(client.graph.company.get(acmeId).name).toBe("Acme Corp");

    first = authority.apply(
      createCompanyNameWriteTransaction(server.store, acmeId, "Acme Incremental One", "tx:1"),
    );
    const afterFirstStore = createStore();
    afterFirstStore.replace(server.store.snapshot());
    second = authority.apply(
      createCompanyNameWriteTransaction(server.store, acmeId, "Acme Incremental Two", "tx:2"),
    );
    invalidResult = {
      ...second,
      transaction: createCompanyNameWriteTransaction(afterFirstStore, acmeId, "   ", second.txId),
    };
    if (!first || !second || !invalidResult) {
      throw new Error("Expected invalid incremental batch fixtures to be initialized.");
    }

    let error: unknown;
    try {
      await client.sync.sync();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<unknown>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
    });
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "field",
          code: "string.blank",
          predicateKey: testNamespace.company.fields.name.key,
          nodeId: acmeId,
        }),
      ]),
    );
    expect(client.sync.getState()).toMatchObject({
      status: "error",
      cursor: authority.getBaseCursor(),
      completeness: "complete",
      freshness: "stale",
    });
    expect(client.graph.company.get(acmeId).name).toBe("Acme Corp");

    const recovered = await client.sync.sync();

    expect(recovered.mode).toBe("total");
    expect(client.sync.getState()).toMatchObject({
      status: "ready",
      cursor: second.cursor,
      completeness: "complete",
      freshness: "current",
    });
    expect(client.graph.company.get(acmeId).name).toBe("Acme Incremental Two");
  });

  it("lets non-throwing authoritative validation reuse the preserved schema baseline", () => {
    const server = createServerGraph();
    server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });

    const clientStore = createStore();
    bootstrap(clientStore, core);
    bootstrap(clientStore, testNamespace);

    const payload = createDataOnlyTotalSyncPayload(server.store, {
      cursor: "server:data-only:1",
    });
    const result = validateAuthoritativeTotalSyncPayload(payload, testNamespace, {
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
    const { aiTagId, enterpriseTagId } = createCompanyTagSet(server.coreGraph);
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
      tags: [enterpriseTagId, aiTagId],
    });
    let cursor = 0;

    const client = createSyncedTypeClient(testNamespace, {
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
      tags: [aiTagId, enterpriseTagId],
    });
    await client.sync.sync();

    expect(nameNotifications).toBe(1);
    expect(tagNotifications).toBe(0);
    expect(client.graph.company.get(acmeId).name).toBe("Acme Platform");
    expect(client.graph.company.get(acmeId).tags).toEqual([enterpriseTagId, aiTagId]);
    expect(client.graph.company.list().map((company) => company.name)).toEqual(["Acme Platform"]);

    unsubscribeName();
    unsubscribeTags();
  });

  it("preserves the last ready cursor and marks sync state stale when a pull fails", async () => {
    const server = createServerGraph();
    server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });

    const error = new Error("sync failed");
    const client = createSyncedTypeClient(testNamespace, {
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
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });
    let cursor = 0;

    const client = createSyncedTypeClient(testNamespace, {
      pull: () =>
        createTotalSyncPayload(server.store, {
          cursor: `server:${(cursor += 1)}`,
        }),
    });

    await client.sync.sync();
    expect(client.graph.company.get(acmeId).name).toBe("Acme Corp");

    for (const edge of server.store.facts(acmeId, edgeId(testNamespace.company.fields.name))) {
      server.store.retract(edge.id);
    }
    server.store.assert(acmeId, edgeId(testNamespace.company.fields.name), "   ");

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
    expect(validationError.result.changedPredicateKeys).toEqual([
      testNamespace.company.fields.name.key,
    ]);
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "field",
          code: "string.blank",
          predicateKey: testNamespace.company.fields.name.key,
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
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });
    let cursor = 0;

    const client = createSyncedTypeClient(testNamespace, {
      pull: () =>
        createTotalSyncPayload(server.store, {
          cursor: `server:${(cursor += 1)}`,
        }),
    });

    await client.sync.sync();
    expect(client.graph.company.get(acmeId).name).toBe("Acme Corp");

    server.store.assert(acmeId, edgeId(testNamespace.company.fields.name), "Acme Corp");

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
    expect(validationError.result.changedPredicateKeys).toEqual([
      testNamespace.company.fields.name.key,
    ]);
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "field.cardinality",
          predicateKey: testNamespace.company.fields.name.key,
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
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });

    const client = createSyncedTypeClient(testNamespace, {
      pull: () => createTotalSyncPayload(server.store, { cursor: "server:1" }),
    });

    await client.sync.sync();
    expect(client.graph.company.get(acmeId).name).toBe("Acme Corp");

    for (const edge of server.store.facts(acmeId, edgeId(testNamespace.company.fields.name))) {
      server.store.retract(edge.id);
    }
    server.store.assert(acmeId, edgeId(testNamespace.company.fields.name), "   ");

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
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });

    for (const edge of server.store.facts(acmeId, edgeId(testNamespace.company.fields.name))) {
      server.store.retract(edge.id);
    }
    server.store.assert(acmeId, edgeId(testNamespace.company.fields.name), "   ");

    const result = validateAuthoritativeTotalSyncPayload(
      createTotalSyncPayload(server.store, { cursor: "server:1" }),
      testNamespace,
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
    });
    if (result.ok) throw new Error("Expected authoritative payload validation to fail");
    expect(result.changedPredicateKeys).toEqual([testNamespace.company.fields.name.key]);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "field",
          code: "string.blank",
          predicateKey: testNamespace.company.fields.name.key,
          nodeId: acmeId,
        }),
      ]),
    );
  });

  it("rejects invalid authoritative write results without mutating synced client state", async () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });

    const client = createSyncedTypeClient(testNamespace, {
      pull: () => createTotalSyncPayload(server.store, { cursor: "server:1" }),
    });

    await client.sync.sync();

    const invalidResult = {
      txId: "tx:invalid",
      cursor: "server:2",
      replayed: false,
      transaction: createCompanyNameWriteTransaction(server.store, acmeId, "   ", "tx:invalid"),
    };

    let error: unknown;
    try {
      client.sync.applyWriteResult(invalidResult);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<typeof invalidResult>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
    });
    expect(client.sync.getState()).toMatchObject({
      status: "ready",
      cursor: "server:1",
      freshness: "current",
      completeness: "complete",
    });
    expect(client.graph.company.get(acmeId).name).toBe("Acme Corp");
  });

  it("returns caller-owned authoritative validation payload snapshots", () => {
    const server = createServerGraph();
    server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });

    const payload = createTotalSyncPayload(server.store, {
      cursor: "server:owned-result",
    });
    const originalCursor = payload.cursor;
    const originalObject = payload.snapshot.edges[0]?.o;

    const result = validateAuthoritativeTotalSyncPayload(payload, testNamespace);

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
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });

    for (const edge of server.store.facts(acmeId, edgeId(testNamespace.company.fields.name))) {
      server.store.retract(edge.id);
    }
    server.store.assert(acmeId, edgeId(testNamespace.company.fields.name), "   ");

    const payload = createTotalSyncPayload(server.store, {
      cursor: "server:invalid:name",
    });
    const result = validateAuthoritativeTotalSyncPayload(payload, testNamespace);

    expect(result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
    });
    if (result.ok) throw new Error("Expected authoritative payload validation to fail");

    const client = createSyncedTypeClient(testNamespace, {
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
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });

    for (const edge of server.store.facts(acmeId, edgeId(testNamespace.company.fields.name))) {
      server.store.retract(edge.id);
    }
    server.store.assert(acmeId, edgeId(testNamespace.company.fields.name), "   ");

    const clientStore = createStore();
    bootstrap(clientStore, core);
    bootstrap(clientStore, testNamespace);
    const payload = createDataOnlyTotalSyncPayload(server.store, {
      cursor: "server:data-only:invalid-name",
    });

    const result = validateAuthoritativeTotalSyncPayload(payload, testNamespace, {
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
    expect(result.changedPredicateKeys).toEqual([testNamespace.company.fields.name.key]);
  });

  it("lets direct authoritative payload validation preserve bootstrapped schema for data-only payloads", () => {
    const server = createServerGraph();
    server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });

    const clientStore = createStore();
    bootstrap(clientStore, core);
    bootstrap(clientStore, testNamespace);

    const result = validateAuthoritativeTotalSyncPayload(
      createDataOnlyTotalSyncPayload(server.store, { cursor: "server:data-only:1" }),
      testNamespace,
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
      testNamespace,
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
      testNamespace,
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
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });

    const clientStore = createStore();
    bootstrap(clientStore, core);
    bootstrap(clientStore, testNamespace);
    const clientGraph = createTypeClient(clientStore, testNamespace);
    const sync = createTotalSyncController(clientStore, {
      pull: () => createTotalSyncPayload(server.store, { cursor: "server:1" }),
      validate: createAuthoritativeTotalSyncValidator(testNamespace),
    });

    sync.apply(createTotalSyncPayload(server.store, { cursor: "server:1" }));
    expect(clientGraph.company.get(acmeId).name).toBe("Acme Corp");

    for (const edge of server.store.facts(acmeId, edgeId(testNamespace.company.fields.name))) {
      server.store.retract(edge.id);
    }
    server.store.assert(acmeId, edgeId(testNamespace.company.fields.name), "   ");

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
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });

    const client = createSyncedTypeClient(testNamespace, {
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
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });

    const client = createSyncedTypeClient(testNamespace, {
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
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });

    const clientStore = createStore();
    bootstrap(clientStore, core);
    bootstrap(clientStore, testNamespace);
    const clientGraph = createTypeClient(clientStore, testNamespace);
    const session = createTotalSyncSession(clientStore, {
      validate: createAuthoritativeTotalSyncValidator(testNamespace),
    });

    session.apply(createTotalSyncPayload(server.store, { cursor: "server:1" }));
    expect(clientGraph.company.get(acmeId).name).toBe("Acme Corp");
    expect(session.getState()).toMatchObject({
      status: "ready",
      cursor: "server:1",
      freshness: "current",
    });

    for (const edge of server.store.facts(acmeId, edgeId(testNamespace.company.fields.name))) {
      server.store.retract(edge.id);
    }
    server.store.assert(acmeId, edgeId(testNamespace.company.fields.name), "   ");

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

  it("lets lower-level total sync sessions apply incremental batches in cursor order and recover from gaps with total sync", async () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });
    const authority = createAuthoritativeGraphWriteSession(server.store, testNamespace, {
      cursorPrefix: "server:",
    });

    const clientStore = createStore();
    bootstrap(clientStore, core);
    bootstrap(clientStore, testNamespace);
    const clientGraph = createTypeClient(clientStore, testNamespace);
    const session = createTotalSyncSession(clientStore, {
      validate: createAuthoritativeTotalSyncValidator(testNamespace),
      validateWriteResult: createAuthoritativeGraphWriteResultValidator(clientStore, testNamespace),
    });

    session.apply(
      createTotalSyncPayload(server.store, {
        cursor: authority.getBaseCursor(),
      }),
    );

    const first = authority.apply(
      createCompanyNameWriteTransaction(server.store, acmeId, "Acme Incremental One", "tx:1"),
    );
    const second = authority.apply(
      createCompanyNameWriteTransaction(server.store, acmeId, "Acme Incremental Two", "tx:2"),
    );
    const incremental = authority.getIncrementalSyncResult(authority.getBaseCursor());
    const applied = session.apply(incremental);

    expect(applied.mode).toBe("incremental");
    if (applied.mode !== "incremental" || "fallback" in applied) {
      throw new Error("Expected a data-bearing incremental sync result.");
    }
    expect(applied.transactions).toEqual([first, second]);
    expect(clientGraph.company.get(acmeId).name).toBe("Acme Incremental Two");
    expect(session.getState()).toMatchObject({
      status: "ready",
      cursor: second.cursor,
      completeness: "complete",
      freshness: "current",
    });

    const gapAuthority = createAuthoritativeGraphWriteSession(server.store, testNamespace, {
      cursorPrefix: "server:",
      initialSequence: 4,
    });

    let gapError: unknown;
    try {
      await session.pull((state) => gapAuthority.getIncrementalSyncResult(state.cursor));
    } catch (caught) {
      gapError = caught;
    }

    expect(gapError).toBeInstanceOf(GraphValidationError);
    const validationError = gapError as GraphValidationError<void>;
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "sync.incremental.recovery",
          predicateKey: "$sync:incremental",
          nodeId: "$sync:incremental",
        }),
      ]),
    );
    expect(session.getState()).toMatchObject({
      status: "error",
      cursor: second.cursor,
      freshness: "stale",
    });
    expect(clientGraph.company.get(acmeId).name).toBe("Acme Incremental Two");

    const recovered = await session.pull(() =>
      createTotalSyncPayload(server.store, {
        cursor: gapAuthority.getBaseCursor(),
      }),
    );

    expect(recovered.mode).toBe("total");
    expect(session.getState()).toMatchObject({
      status: "ready",
      cursor: gapAuthority.getBaseCursor(),
      freshness: "current",
      completeness: "complete",
    });
    expect(clientGraph.company.get(acmeId).name).toBe("Acme Incremental Two");
  });

  it("lets lower-level total sync sessions preserve bootstrapped schema for data-only payloads", () => {
    const server = createServerGraph();
    const acmeId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });

    const clientStore = createStore();
    bootstrap(clientStore, core);
    bootstrap(clientStore, testNamespace);
    const preserveSnapshot = clientStore.snapshot();
    const clientGraph = createTypeClient(clientStore, testNamespace);
    const session = createTotalSyncSession(clientStore, {
      preserveSnapshot,
      validate: createAuthoritativeTotalSyncValidator(testNamespace),
    });

    const dataOnlyPayload = createDataOnlyTotalSyncPayload(server.store, {
      cursor: "server:data-only:1",
    });
    const payload = session.apply(dataOnlyPayload);

    expect(payload.mode).toBe("total");
    if (payload.mode !== "total") throw new Error("Expected total sync payload.");
    expect(
      dataOnlyPayload.snapshot.edges.some((edge) => edge.s === typeId(testNamespace.company)),
    ).toBe(false);
    expect(payload.snapshot.edges.some((edge) => edge.s === typeId(testNamespace.company))).toBe(
      true,
    );
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
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });
    let cursor = 0;

    const client = createSyncedTypeClient(testNamespace, {
      pull: () =>
        createTotalSyncPayload(server.store, {
          cursor: `server:${(cursor += 1)}`,
        }),
    });

    await client.sync.sync();
    expect(client.graph.company.get(acmeId).foundedYear).toBeUndefined();

    server.store.assert(acmeId, edgeId(testNamespace.company.fields.foundedYear), "NaN");

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
          predicateKey: testNamespace.company.fields.foundedYear.key,
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

    const client = createSyncedTypeClient(testNamespace, {
      pull: () =>
        createTotalSyncPayload(server.store, {
          cursor: `server:${(cursor += 1)}`,
        }),
    });

    await client.sync.sync();
    expect(client.graph.block.get(blockId).collapsed).toBe(true);

    for (const edge of server.store.facts(blockId, edgeId(testNamespace.block.fields.collapsed))) {
      server.store.retract(edge.id);
    }
    server.store.assert(blockId, edgeId(testNamespace.block.fields.collapsed), "0");

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
          predicateKey: testNamespace.block.fields.collapsed.key,
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
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });
    let cursor = 0;

    const client = createSyncedTypeClient(testNamespace, {
      pull: () =>
        createTotalSyncPayload(server.store, {
          cursor: `server:${(cursor += 1)}`,
        }),
    });

    await client.sync.sync();
    expect(client.graph.company.get(acmeId).status).toBe(testNamespace.status.values.draft.id);

    for (const edge of server.store.facts(acmeId, edgeId(testNamespace.company.fields.status))) {
      server.store.retract(edge.id);
    }
    server.store.assert(acmeId, edgeId(testNamespace.company.fields.status), "active");

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
          predicateKey: testNamespace.company.fields.status.key,
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
    expect(client.graph.company.get(acmeId).status).toBe(testNamespace.status.values.draft.id);
  });

  it("rejects authoritative snapshots with wrong-type entity references and preserves local state", async () => {
    const server = createServerGraph();
    const companyId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });
    const personId = server.graph.person.create({
      name: "Alice",
      status: testNamespace.status.values.inReview.id,
      worksAt: [companyId],
    });
    const otherPersonId = server.graph.person.create({
      name: "Bob",
      status: testNamespace.status.values.approved.id,
    });
    let cursor = 0;

    const client = createSyncedTypeClient(testNamespace, {
      pull: () =>
        createTotalSyncPayload(server.store, {
          cursor: `server:${(cursor += 1)}`,
        }),
    });

    await client.sync.sync();
    expect(client.graph.person.get(personId).worksAt).toEqual([companyId]);

    for (const edge of server.store.facts(personId, edgeId(testNamespace.person.fields.worksAt))) {
      server.store.retract(edge.id);
    }
    server.store.assert(personId, edgeId(testNamespace.person.fields.worksAt), otherPersonId);

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
          predicateKey: testNamespace.person.fields.worksAt.key,
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
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });
    let cursor = 0;

    const client = createSyncedTypeClient(testNamespace, {
      pull: () =>
        createTotalSyncPayload(server.store, {
          cursor: `server:${(cursor += 1)}`,
        }),
    });

    await client.sync.sync();
    expect(client.graph.company.get(companyId).type).toEqual([testNamespace.company.values.id]);

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
    expect(client.graph.company.get(companyId).type).toEqual([testNamespace.company.values.id]);
  });
});

describe("authoritative graph writes", () => {
  it("derives canonical write ops and transactions from before and after snapshots", () => {
    const before = {
      edges: [
        {
          id: "edge:existing",
          s: "node:existing",
          p: "predicate:existing",
          o: "value:existing",
        },
      ],
      retracted: ["edge:2"],
    };
    const after = {
      edges: [
        {
          id: "edge:z",
          s: "node:z",
          p: "predicate:z",
          o: "value:z",
        },
        {
          id: "edge:existing",
          s: "node:existing",
          p: "predicate:existing",
          o: "value:existing",
        },
        {
          id: "edge:a",
          s: "node:a",
          p: "predicate:a",
          o: "value:a",
        },
      ],
      retracted: ["edge:3", "edge:1", "edge:2"],
    };

    const ops = createGraphWriteOperationsFromSnapshots(before, after);
    const transaction = createGraphWriteTransactionFromSnapshots(before, after, "tx:derived");

    expect(ops).toEqual([
      {
        op: "retract",
        edgeId: "edge:1",
      },
      {
        op: "retract",
        edgeId: "edge:3",
      },
      {
        op: "assert",
        edge: {
          id: "edge:a",
          s: "node:a",
          p: "predicate:a",
          o: "value:a",
        },
      },
      {
        op: "assert",
        edge: {
          id: "edge:z",
          s: "node:z",
          p: "predicate:z",
          o: "value:z",
        },
      },
    ]);
    expect(transaction).toEqual({
      id: "tx:derived",
      ops,
    });
  });

  it("rejects empty transaction identities and cursors", () => {
    const server = createServerGraph();
    const companyId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });
    const transaction = createCompanyNameWriteTransaction(
      server.store,
      companyId,
      "Acme Graph Labs",
      "",
    );

    const txValidation = validateAuthoritativeGraphWriteTransaction(
      transaction,
      server.store,
      testNamespace,
    );

    expect(txValidation).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
    });
    if (txValidation.ok) throw new Error("Expected empty transaction ids to fail validation");
    expect(txValidation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "sync.tx.id.empty",
          predicateKey: "$sync:tx",
        }),
      ]),
    );

    const resultValidation = validateAuthoritativeGraphWriteResult(
      {
        txId: "",
        cursor: "",
        replayed: false,
        transaction,
      },
      server.store,
      testNamespace,
    );

    expect(resultValidation).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
    });
    if (resultValidation.ok)
      throw new Error("Expected empty write-result identities to fail validation");
    expect(resultValidation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "sync.txResult.txId.empty",
          predicateKey: "$sync:txResult",
        }),
        expect.objectContaining({
          source: "runtime",
          code: "sync.txResult.cursor.empty",
          predicateKey: "$sync:txResult",
        }),
        expect.objectContaining({
          source: "runtime",
          code: "sync.tx.id.empty",
          predicateKey: "$sync:txResult",
        }),
      ]),
    );
  });

  it("applies valid write transactions atomically and advances the authority cursor", () => {
    const server = createServerGraph();
    const companyId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });
    const authority = createAuthoritativeGraphWriteSession(server.store, testNamespace, {
      cursorPrefix: "server:",
    });
    const transaction = createCompanyNameWriteTransaction(
      server.store,
      companyId,
      "Acme Graph Labs",
      "tx:1",
    );

    const validation = validateAuthoritativeGraphWriteTransaction(
      transaction,
      server.store,
      testNamespace,
    );

    expect(validation).toMatchObject({
      ok: true,
      phase: "authoritative",
      event: "reconcile",
    });
    if (!validation.ok) throw new Error("Expected authoritative write validation to pass");

    const result = authority.apply(transaction);

    expect(result).toMatchObject({
      txId: "tx:1",
      cursor: "server:1",
      replayed: false,
    });
    expect(result.transaction).toEqual(transaction);
    expect(authority.getCursor()).toBe("server:1");
    expect(server.graph.company.get(companyId).name).toBe("Acme Graph Labs");
  });

  it("surfaces accepted changes after a cursor and resumes from durable history across restart", () => {
    const server = createServerGraph();
    const companyId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });
    const authority = createAuthoritativeGraphWriteSession(server.store, testNamespace, {
      cursorPrefix: "server:",
    });

    const first = authority.apply(
      createCompanyNameWriteTransaction(server.store, companyId, "Acme Durable One", "tx:1"),
    );
    const second = authority.apply(
      createCompanyNameWriteTransaction(server.store, companyId, "Acme Durable Two", "tx:2"),
    );
    const history = authority.getHistory();

    expect(authority.getBaseCursor()).toBe("server:0");
    expect(authority.getChangesAfter(authority.getBaseCursor())).toEqual({
      kind: "changes",
      cursor: "server:2",
      changes: [first, second],
    });
    expect(authority.getChangesAfter(first.cursor)).toEqual({
      kind: "changes",
      cursor: "server:2",
      changes: [second],
    });
    expect(authority.getChangesAfter("server:unknown")).toEqual({
      kind: "reset",
      cursor: "server:2",
      changes: [],
    });

    const restartedStore = createStore();
    bootstrap(restartedStore, core);
    bootstrap(restartedStore, testNamespace);
    restartedStore.replace(server.store.snapshot());
    const restartedGraph = createTypeClient(restartedStore, testNamespace);
    const restarted = createAuthoritativeGraphWriteSession(restartedStore, testNamespace, {
      cursorPrefix: history.cursorPrefix,
      initialSequence: history.baseSequence,
      history: history.results,
    });
    const third = restarted.apply(
      createCompanyNameWriteTransaction(restartedStore, companyId, "Acme Durable Three", "tx:3"),
    );

    expect(third).toMatchObject({
      txId: "tx:3",
      replayed: false,
      cursor: "server:3",
    });
    expect(restarted.getChangesAfter(second.cursor)).toEqual({
      kind: "changes",
      cursor: "server:3",
      changes: [third],
    });
    expect(restartedGraph.company.get(companyId).name).toBe("Acme Durable Three");
  });

  it("wraps incremental pull delivery in the same metadata model as total snapshot bootstrap", () => {
    const server = createServerGraph();
    const companyId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });
    const authority = createAuthoritativeGraphWriteSession(server.store, testNamespace, {
      cursorPrefix: "server:",
    });
    const bootstrapPayload = createTotalSyncPayload(server.store, {
      cursor: authority.getBaseCursor(),
      freshness: "current",
    });

    const first = authority.apply(
      createCompanyNameWriteTransaction(server.store, companyId, "Acme Incremental One", "tx:1"),
    );
    const second = authority.apply(
      createCompanyNameWriteTransaction(server.store, companyId, "Acme Incremental Two", "tx:2"),
    );
    const incremental = authority.getIncrementalSyncResult(bootstrapPayload.cursor, {
      freshness: "stale",
    });

    expect("fallback" in incremental).toBe(false);
    if ("fallback" in incremental) {
      throw new Error("Expected a data-bearing incremental sync payload.");
    }
    expect(incremental).toEqual({
      mode: "incremental",
      scope: bootstrapPayload.scope,
      after: bootstrapPayload.cursor,
      transactions: [first, second],
      cursor: second.cursor,
      completeness: bootstrapPayload.completeness,
      freshness: "stale",
    });

    const validation = validateIncrementalSyncPayload(incremental);

    expect(validation).toMatchObject({
      ok: true,
      phase: "authoritative",
      event: "reconcile",
      value: incremental,
      changedPredicateKeys: [],
    });
  });

  it("surfaces unknown cursor, gap, and reset as explicit incremental pull fallbacks", () => {
    const server = createServerGraph();
    const companyId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });
    const authority = createAuthoritativeGraphWriteSession(server.store, testNamespace, {
      cursorPrefix: "server:",
    });
    const first = authority.apply(
      createCompanyNameWriteTransaction(server.store, companyId, "Acme Incremental One", "tx:1"),
    );

    const unknownCursor = authority.getIncrementalSyncResult("server:unknown");
    expect(unknownCursor).toEqual({
      mode: "incremental",
      scope: { kind: "graph" },
      after: "server:unknown",
      transactions: [],
      cursor: first.cursor,
      completeness: "complete",
      freshness: "current",
      fallback: "unknown-cursor",
    });

    const gapAuthority = createAuthoritativeGraphWriteSession(server.store, testNamespace, {
      cursorPrefix: "server:",
      initialSequence: 2,
    });
    const gap = gapAuthority.getIncrementalSyncResult("server:1");
    expect(gap).toEqual({
      mode: "incremental",
      scope: { kind: "graph" },
      after: "server:1",
      transactions: [],
      cursor: "server:2",
      completeness: "complete",
      freshness: "current",
      fallback: "gap",
    });

    const resetAuthority = createAuthoritativeGraphWriteSession(server.store, testNamespace, {
      cursorPrefix: "reset:",
    });
    const reset = resetAuthority.getIncrementalSyncResult(first.cursor);
    expect(reset).toEqual({
      mode: "incremental",
      scope: { kind: "graph" },
      after: first.cursor,
      transactions: [],
      cursor: "reset:0",
      completeness: "complete",
      freshness: "current",
      fallback: "reset",
    });

    expect(validateIncrementalSyncResult(unknownCursor)).toMatchObject({
      ok: true,
      phase: "authoritative",
      event: "reconcile",
    });
    expect(validateIncrementalSyncResult(gap)).toMatchObject({
      ok: true,
      phase: "authoritative",
      event: "reconcile",
    });
    expect(validateIncrementalSyncResult(reset)).toMatchObject({
      ok: true,
      phase: "authoritative",
      event: "reconcile",
    });
  });

  it("rejects malformed incremental pull envelopes through the exported validation surface", () => {
    const result = validateIncrementalSyncResult({
      mode: "delta",
      scope: { kind: "partial" },
      after: "",
      transactions: [
        {
          txId: "tx:1",
          cursor: "server:1",
          replayed: true,
          transaction: {
            id: "tx:1",
            ops: [],
          },
        },
      ],
      cursor: "server:2",
      completeness: "incomplete",
      freshness: "future",
      fallback: "later",
    } as unknown as ReturnType<
      ReturnType<typeof createAuthoritativeGraphWriteSession>["getIncrementalSyncResult"]
    >);

    expect(result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
      changedPredicateKeys: ["$sync:incremental"],
    });
    if (result.ok) throw new Error("Expected malformed incremental sync validation to fail");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "sync.incremental.mode",
          predicateKey: "$sync:incremental",
          nodeId: "$sync:incremental",
        }),
        expect.objectContaining({
          source: "runtime",
          code: "sync.incremental.scope",
          predicateKey: "$sync:incremental",
          nodeId: "$sync:incremental",
        }),
        expect.objectContaining({
          source: "runtime",
          code: "sync.incremental.after.empty",
          predicateKey: "$sync:incremental",
          nodeId: "$sync:incremental",
        }),
        expect.objectContaining({
          source: "runtime",
          code: "sync.incremental.completeness",
          predicateKey: "$sync:incremental",
          nodeId: "$sync:incremental",
        }),
        expect.objectContaining({
          source: "runtime",
          code: "sync.incremental.freshness",
          predicateKey: "$sync:incremental",
          nodeId: "$sync:incremental",
        }),
        expect.objectContaining({
          source: "runtime",
          code: "sync.incremental.transaction.replayed",
          predicateKey: "$sync:incremental",
          nodeId: "$sync:incremental",
        }),
        expect.objectContaining({
          source: "runtime",
          code: "sync.incremental.fallback",
          predicateKey: "$sync:incremental",
          nodeId: "$sync:incremental",
        }),
        expect.objectContaining({
          source: "runtime",
          code: "sync.incremental.fallback.transactions",
          predicateKey: "$sync:incremental",
          nodeId: "$sync:incremental",
        }),
        expect.objectContaining({
          source: "runtime",
          code: "sync.tx.ops.empty",
          predicateKey: "$sync:incremental",
          nodeId: "$sync:incremental",
        }),
      ]),
    );
    expect(
      formatValidationPath(
        result.issues.find((issue) => issue.code === "sync.tx.ops.empty")?.path ?? [],
      ),
    ).toBe("transactions[0].transaction.ops");
  });

  it("rejects invalid write transactions with structured validation results and leaves authority state unchanged", () => {
    const server = createServerGraph();
    const companyId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });
    const authority = createAuthoritativeGraphWriteSession(server.store, testNamespace, {
      cursorPrefix: "server:",
    });
    const transaction = createCompanyNameWriteTransaction(
      server.store,
      companyId,
      "   ",
      "tx:invalid",
    );

    const validation = validateAuthoritativeGraphWriteTransaction(
      transaction,
      server.store,
      testNamespace,
    );

    expect(validation).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
    });
    if (validation.ok) throw new Error("Expected authoritative write validation to fail");
    expect(validation.changedPredicateKeys).toEqual([testNamespace.company.fields.name.key]);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "field",
          code: "string.blank",
          predicateKey: testNamespace.company.fields.name.key,
          nodeId: companyId,
        }),
      ]),
    );

    let error: unknown;
    try {
      authority.apply(transaction);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<GraphWriteTransaction>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
    });
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "field",
          code: "string.blank",
          predicateKey: testNamespace.company.fields.name.key,
          nodeId: companyId,
        }),
      ]),
    );
    expect(server.graph.company.get(companyId).name).toBe("Acme Corp");
    expect(authority.getCursor()).toBeUndefined();
  });

  it("treats duplicate transaction ids as deterministic replays when the canonical ops match", () => {
    const server = createServerGraph();
    const companyId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });
    const authority = createAuthoritativeGraphWriteSession(server.store, testNamespace, {
      cursorPrefix: "server:",
    });
    const assertedEdgeId = server.store.newNode();
    const first = createCompanyNameWriteTransaction(
      server.store,
      companyId,
      "Acme Replay",
      "tx:1",
      {
        edgeId: assertedEdgeId,
        assertFirst: true,
      },
    );
    const replay = createCompanyNameWriteTransaction(
      server.store,
      companyId,
      "Acme Replay",
      "tx:1",
      {
        edgeId: assertedEdgeId,
        assertFirst: false,
      },
    );

    const firstResult = authority.apply(first);
    const replayResult = authority.apply(replay);

    expect(firstResult).toMatchObject({
      txId: "tx:1",
      cursor: "server:1",
      replayed: false,
    });
    expect(replayResult).toMatchObject({
      txId: "tx:1",
      cursor: "server:1",
      replayed: true,
    });
    expect(server.graph.company.get(companyId).name).toBe("Acme Replay");
    expect(authority.getCursor()).toBe("server:1");
  });

  it("rejects reused transaction ids when the canonical transaction differs", () => {
    const server = createServerGraph();
    const companyId = server.graph.company.create({
      name: "Acme Corp",
      status: testNamespace.status.values.draft.id,
      website: new URL("https://acme.com"),
    });
    const authority = createAuthoritativeGraphWriteSession(server.store, testNamespace, {
      cursorPrefix: "server:",
    });

    authority.apply(createCompanyNameWriteTransaction(server.store, companyId, "Acme One", "tx:1"));

    let error: unknown;
    try {
      authority.apply(
        createCompanyNameWriteTransaction(server.store, companyId, "Acme Two", "tx:1"),
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<GraphWriteTransaction>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
      changedPredicateKeys: ["$sync:tx"],
    });
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "sync.tx.id.conflict",
          predicateKey: "$sync:tx",
        }),
      ]),
    );
    expect(server.graph.company.get(companyId).name).toBe("Acme One");
    expect(authority.getCursor()).toBe("server:1");
  });
});
