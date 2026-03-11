import { describe, expect, it } from "bun:test";

import { stringTypeModule } from "../type/string/index.js";
import { app } from "./app";
import { bootstrap } from "./bootstrap";
import { GraphValidationError, createTypeClient } from "./client";
import { core } from "./core";
import { defineNamespace, defineScalar, defineType, edgeId } from "./schema";
import { createStore } from "./store";
import { createSyncedTypeClient, createTotalSyncPayload } from "./sync";

type ValidatorCall = {
  changedPredicateKeys: readonly string[];
  event: string;
  nodeId: string;
  path: readonly string[];
  phase: string;
  predicateKey: string;
};

function createValidationLifecycleFixture() {
  const scalarCalls: ValidatorCall[] = [];
  const fieldCalls: ValidatorCall[] = [];

  const score = defineScalar({
    values: { key: "test:score", name: "Score" },
    encode: (value: number) => String(value),
    decode: (raw) => Number(raw),
    validate: ({ changedPredicateKeys, event, nodeId, path, phase, predicateKey, value }) => {
      scalarCalls.push({
        changedPredicateKeys: [...changedPredicateKeys],
        event,
        nodeId,
        path,
        phase,
        predicateKey,
      });
      return Number.isFinite(value)
        ? undefined
        : {
            code: "score.notFinite",
            message: "Score must be finite.",
          };
    },
  });

  const reviewItem = defineType({
    values: { key: "test:review-item", name: "Review Item" },
    fields: {
      ...core.node.fields,
      title: stringTypeModule.field({
        cardinality: "one",
        validate: ({ changedPredicateKeys, event, nodeId, path, phase, predicateKey, value }) => {
          fieldCalls.push({
            changedPredicateKeys: [...changedPredicateKeys],
            event,
            nodeId,
            path,
            phase,
            predicateKey,
          });
          return typeof value === "string" && value.trim().length > 0
            ? undefined
            : {
                code: "string.blank",
                message: "Title must not be blank.",
              };
        },
      }),
      score: {
        range: score,
        cardinality: "one",
      },
      status: {
        range: app.status,
        cardinality: "one",
      },
    },
  });

  const namespace = defineNamespace(
    {},
    {
      score,
      reviewItem,
    },
    { strict: false },
  );

  function createGraph() {
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, app);
    bootstrap(store, namespace);

    return {
      store,
      graph: createTypeClient(store, namespace),
    };
  }

  return {
    createGraph,
    fieldCalls,
    namespace,
    scalarCalls,
  };
}

function createDeleteValidationLifecycleFixture() {
  const relationshipCalls: ValidatorCall[] = [];

  const company = defineType({
    values: { key: "test:company", name: "Company" },
    fields: {
      ...core.node.fields,
    },
  });

  const person = defineType({
    values: { key: "test:person", name: "Person" },
    fields: {
      ...core.node.fields,
      worksAt: {
        range: company,
        cardinality: "many",
        validate: ({ changedPredicateKeys, event, nodeId, path, phase, predicateKey }) => {
          relationshipCalls.push({
            changedPredicateKeys: [...changedPredicateKeys],
            event,
            nodeId,
            path,
            phase,
            predicateKey,
          });
        },
      },
    },
  });

  const namespace = defineNamespace(
    {},
    {
      company,
      person,
    },
    { strict: false },
  );

  function createGraph() {
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, namespace);

    return {
      store,
      graph: createTypeClient(store, namespace),
    };
  }

  return {
    createGraph,
    namespace,
    relationshipCalls,
  };
}

function expectValidatorCall(
  call: ValidatorCall | undefined,
  expected: {
    event: string;
    nodeId: string;
    path: readonly string[];
    phase: string;
    predicateKey: string;
    changedPredicateKeys: readonly string[];
  },
): void {
  expect(call).toMatchObject({
    event: expected.event,
    nodeId: expected.nodeId,
    path: expected.path,
    phase: expected.phase,
    predicateKey: expected.predicateKey,
  });
  expect(call?.changedPredicateKeys).toEqual(expect.arrayContaining(expected.changedPredicateKeys));
}

describe("validation lifecycle contract", () => {
  it("reuses the same create node id across local preflight and commit", () => {
    const fixture = createValidationLifecycleFixture();
    const local = fixture.createGraph();
    const input = {
      name: "Create contract",
      title: "Ready",
      score: 5,
      status: app.status.values.active.id,
    };

    const localResult = local.graph.reviewItem.validateCreate(input);

    expect(localResult).toMatchObject({
      ok: true,
      phase: "local",
      event: "create",
    });
    if (!localResult.ok) throw new Error("Expected local create validation to pass");
    expect(fixture.fieldCalls.length).toBeGreaterThan(0);
    expect(fixture.scalarCalls.length).toBeGreaterThan(0);
    const preflightFieldNodeIds = [...new Set(fixture.fieldCalls.map((call) => call.nodeId))];
    const preflightScalarNodeIds = [...new Set(fixture.scalarCalls.map((call) => call.nodeId))];
    expect(preflightFieldNodeIds).toHaveLength(1);
    expect(preflightScalarNodeIds).toHaveLength(1);
    const preflightNodeId = preflightFieldNodeIds[0];
    if (!preflightNodeId) throw new Error("Expected create preflight to produce a node id");
    expect(preflightScalarNodeIds[0]).toBe(preflightNodeId);

    fixture.fieldCalls.length = 0;
    fixture.scalarCalls.length = 0;

    const createdId = local.graph.reviewItem.create(input);

    expect(createdId).toBe(preflightNodeId);
    expect(fixture.fieldCalls.length).toBeGreaterThan(0);
    expect(fixture.scalarCalls.length).toBeGreaterThan(0);
    expect(new Set(fixture.fieldCalls.map((call) => call.nodeId))).toEqual(new Set([createdId]));
    expect(new Set(fixture.scalarCalls.map((call) => call.nodeId))).toEqual(new Set([createdId]));
  });

  it("reuses field and scalar validators across local mutation preflight and authoritative sync", async () => {
    const fixture = createValidationLifecycleFixture();
    const local = fixture.createGraph();
    const localId = local.graph.reviewItem.create({
      name: "Local contract",
      title: "Ready",
      score: 7,
      status: app.status.values.active.id,
    });
    fixture.fieldCalls.length = 0;
    fixture.scalarCalls.length = 0;

    const localResult = local.graph.reviewItem.validateUpdate(localId, {
      title: "   ",
      score: Number.POSITIVE_INFINITY,
    });

    expect(localResult).toMatchObject({
      ok: false,
      phase: "local",
      event: "update",
    });
    if (localResult.ok) throw new Error("Expected local validation to fail");
    expect(localResult.changedPredicateKeys).toEqual([
      fixture.namespace.reviewItem.fields.title.key,
      fixture.namespace.reviewItem.fields.score.key,
      core.node.fields.updatedAt.key,
    ]);
    expect(localResult.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "field",
          code: "string.blank",
          predicateKey: fixture.namespace.reviewItem.fields.title.key,
          path: ["title"],
        }),
        expect.objectContaining({
          source: "type",
          code: "score.notFinite",
          predicateKey: fixture.namespace.reviewItem.fields.score.key,
          path: ["score"],
        }),
      ]),
    );
    expect(local.graph.reviewItem.get(localId)).toMatchObject({
      title: "Ready",
      score: 7,
    });
    expect(fixture.fieldCalls).toHaveLength(1);
    expectValidatorCall(fixture.fieldCalls[0], {
      changedPredicateKeys: [
        fixture.namespace.reviewItem.fields.title.key,
        fixture.namespace.reviewItem.fields.score.key,
        core.node.fields.updatedAt.key,
      ],
      event: "update",
      nodeId: localId,
      path: ["title"],
      phase: "local",
      predicateKey: fixture.namespace.reviewItem.fields.title.key,
    });
    expect(fixture.scalarCalls).toHaveLength(1);
    expectValidatorCall(fixture.scalarCalls[0], {
      changedPredicateKeys: [
        fixture.namespace.reviewItem.fields.title.key,
        fixture.namespace.reviewItem.fields.score.key,
        core.node.fields.updatedAt.key,
      ],
      event: "update",
      nodeId: localId,
      path: ["score"],
      phase: "local",
      predicateKey: fixture.namespace.reviewItem.fields.score.key,
    });

    fixture.fieldCalls.length = 0;
    fixture.scalarCalls.length = 0;

    const server = fixture.createGraph();
    const serverId = server.graph.reviewItem.create({
      name: "Authoritative contract",
      title: "Ready",
      score: 11,
      status: app.status.values.active.id,
    });
    fixture.fieldCalls.length = 0;
    fixture.scalarCalls.length = 0;

    for (const edge of server.store.facts(
      serverId,
      edgeId(fixture.namespace.reviewItem.fields.title),
    )) {
      server.store.retract(edge.id);
    }
    server.store.assert(serverId, edgeId(fixture.namespace.reviewItem.fields.title), "   ");

    for (const edge of server.store.facts(
      serverId,
      edgeId(fixture.namespace.reviewItem.fields.score),
    )) {
      server.store.retract(edge.id);
    }
    server.store.assert(serverId, edgeId(fixture.namespace.reviewItem.fields.score), "Infinity");

    const client = createSyncedTypeClient(fixture.namespace, {
      pull: () => createTotalSyncPayload(server.store, { cursor: "server:1" }),
    });

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
      fixture.namespace.reviewItem.fields.title.key,
      fixture.namespace.reviewItem.fields.score.key,
    ]);
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "field",
          code: "string.blank",
          predicateKey: fixture.namespace.reviewItem.fields.title.key,
          path: ["title"],
        }),
        expect.objectContaining({
          source: "type",
          code: "score.notFinite",
          predicateKey: fixture.namespace.reviewItem.fields.score.key,
          path: ["score"],
        }),
      ]),
    );
    expect(fixture.fieldCalls).toHaveLength(1);
    expectValidatorCall(fixture.fieldCalls[0], {
      changedPredicateKeys: [
        core.node.fields.name.key,
        fixture.namespace.reviewItem.fields.title.key,
        fixture.namespace.reviewItem.fields.score.key,
        fixture.namespace.reviewItem.fields.status.key,
      ],
      event: "reconcile",
      nodeId: serverId,
      path: ["title"],
      phase: "authoritative",
      predicateKey: fixture.namespace.reviewItem.fields.title.key,
    });
    expect(fixture.scalarCalls).toHaveLength(1);
    expectValidatorCall(fixture.scalarCalls[0], {
      changedPredicateKeys: [
        core.node.fields.name.key,
        fixture.namespace.reviewItem.fields.title.key,
        fixture.namespace.reviewItem.fields.score.key,
        fixture.namespace.reviewItem.fields.status.key,
      ],
      event: "reconcile",
      nodeId: serverId,
      path: ["score"],
      phase: "authoritative",
      predicateKey: fixture.namespace.reviewItem.fields.score.key,
    });
  });

  it("keeps simulated local graph validation in the local update phase", () => {
    const fixture = createValidationLifecycleFixture();
    const local = fixture.createGraph();
    const localId = local.graph.reviewItem.create({
      name: "Local contract",
      title: "Ready",
      score: 7,
      status: app.status.values.active.id,
    });
    fixture.fieldCalls.length = 0;
    fixture.scalarCalls.length = 0;

    const result = local.graph.reviewItem.validateUpdate(localId, {
      score: 8,
    });

    expect(result).toMatchObject({
      ok: true,
      phase: "local",
      event: "update",
    });
    expect(fixture.fieldCalls).toHaveLength(1);
    expectValidatorCall(fixture.fieldCalls[0], {
      changedPredicateKeys: [fixture.namespace.reviewItem.fields.title.key],
      event: "update",
      nodeId: localId,
      path: ["title"],
      phase: "local",
      predicateKey: fixture.namespace.reviewItem.fields.title.key,
    });
    expect(fixture.fieldCalls[0]?.changedPredicateKeys).toEqual([
      fixture.namespace.reviewItem.fields.title.key,
    ]);
    expect(fixture.scalarCalls).toHaveLength(2);
    for (const call of fixture.scalarCalls) {
      expectValidatorCall(call, {
        changedPredicateKeys: [fixture.namespace.reviewItem.fields.score.key],
        event: "update",
        nodeId: localId,
        path: ["score"],
        phase: "local",
        predicateKey: fixture.namespace.reviewItem.fields.score.key,
      });
    }
    expect(
      new Set(fixture.scalarCalls.map((call) => [...call.changedPredicateKeys].sort().join("|"))),
    ).toEqual(
      new Set([
        [fixture.namespace.reviewItem.fields.score.key].join("|"),
        [fixture.namespace.reviewItem.fields.score.key, core.node.fields.updatedAt.key]
          .sort()
          .join("|"),
      ]),
    );
  });

  it("keeps simulated local graph validation in the local delete phase", () => {
    const fixture = createDeleteValidationLifecycleFixture();
    const local = fixture.createGraph();
    const companyId = local.graph.company.create({
      name: "Acme",
    });
    const personId = local.graph.person.create({
      name: "Alice",
      worksAt: [companyId],
    });
    fixture.relationshipCalls.length = 0;

    const result = local.graph.company.validateDelete(companyId);

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "delete",
    });
    expect(fixture.relationshipCalls).toHaveLength(1);
    expectValidatorCall(fixture.relationshipCalls[0], {
      changedPredicateKeys: [fixture.namespace.person.fields.worksAt.key],
      event: "delete",
      nodeId: personId,
      path: ["worksAt"],
      phase: "local",
      predicateKey: fixture.namespace.person.fields.worksAt.key,
    });
    expect(fixture.relationshipCalls[0]?.changedPredicateKeys).toEqual([
      fixture.namespace.person.fields.worksAt.key,
    ]);
  });

  it("surfaces runtime-owned graph invariants through local delete and authoritative sync boundaries", async () => {
    const fixture = createDeleteValidationLifecycleFixture();
    const local = fixture.createGraph();
    const companyId = local.graph.company.create({
      name: "Acme",
    });
    local.graph.person.create({
      name: "Alice",
      worksAt: [companyId],
    });
    fixture.relationshipCalls.length = 0;

    const localResult = local.graph.company.validateDelete(companyId);

    expect(localResult).toMatchObject({
      ok: false,
      phase: "local",
      event: "delete",
      changedPredicateKeys: [fixture.namespace.person.fields.worksAt.key],
    });
    if (localResult.ok) throw new Error("Expected local delete validation to fail");
    expect(localResult.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "reference.missing",
          predicateKey: fixture.namespace.person.fields.worksAt.key,
          path: ["worksAt"],
        }),
      ]),
    );

    const server = fixture.createGraph();
    const serverCompanyId = server.graph.company.create({
      name: "Acme",
    });
    const serverPersonId = server.graph.person.create({
      name: "Alice",
      worksAt: [serverCompanyId],
    });
    fixture.relationshipCalls.length = 0;

    for (const edge of server.store.facts(serverCompanyId)) {
      server.store.retract(edge.id);
    }

    const client = createSyncedTypeClient(fixture.namespace, {
      pull: () => createTotalSyncPayload(server.store, { cursor: "server:1" }),
    });

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
      changedPredicateKeys: [fixture.namespace.person.fields.worksAt.key],
    });
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "reference.missing",
          predicateKey: fixture.namespace.person.fields.worksAt.key,
          path: ["worksAt"],
        }),
      ]),
    );
    expect(fixture.relationshipCalls).toHaveLength(1);
    expectValidatorCall(fixture.relationshipCalls[0], {
      changedPredicateKeys: [
        core.node.fields.name.key,
        fixture.namespace.person.fields.worksAt.key,
      ],
      event: "reconcile",
      nodeId: serverPersonId,
      path: ["worksAt"],
      phase: "authoritative",
      predicateKey: fixture.namespace.person.fields.worksAt.key,
    });
  });
});
