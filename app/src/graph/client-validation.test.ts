import { describe, expect, it } from "bun:test";
import { stringTypeModule } from "../type/string/index.js";
import { app } from "./app";
import { bootstrap } from "./bootstrap";
import { GraphValidationError, createTypeClient, formatValidationPath } from "./client";
import { core } from "./core";
import { defineNamespace, defineType, edgeId } from "./schema";
import { createStore } from "./store";
import { defineReferenceField } from "./type-module.js";

function createGraph() {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, app);
  const graph = createTypeClient(store, app);

  return { store, graph };
}

function setupGraph() {
  const { store, graph } = createGraph();

  const companyId = graph.company.create({
    name: "Acme",
    website: new URL("https://acme.com"),
    status: app.status.values.active.id,
  });

  return { store, graph, companyId };
}

function setupGraphWithProtectedNickname() {
  const employee = defineType({
    values: { key: "test:employee", name: "Employee" },
    fields: {
      ...core.node.fields,
      nickname: stringTypeModule.field({
        cardinality: "one?",
        validate: ({ value }) =>
          value === undefined
            ? {
                code: "string.clear",
                message: "Nickname must not be cleared.",
              }
            : undefined,
      }),
    },
  });
  const namespace = defineNamespace({}, { employee }, { strict: false });
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, namespace);
  const graph = createTypeClient(store, namespace);
  const employeeId = graph.employee.create({
    name: "Ada",
    nickname: "Ace",
  });

  return { store, graph, employeeId };
}

describe("graph validation", () => {
  it("preflights create input through the local validation pipeline without committing", () => {
    const { graph } = createGraph();

    const result = graph.company.validateCreate({
      name: "Acme",
      website: new URL("https://acme.com"),
      status: app.status.values.active.id,
    });

    expect(result).toMatchObject({
      ok: true,
      phase: "local",
      event: "create",
    });
    if (!result.ok) throw new Error("Expected local create validation to pass");
    expect(result.value["name"]).toBe("Acme");
    expect(result.value["website"]).toBeInstanceOf(URL);
    expect(result.value["createdAt"]).toBeInstanceOf(Date);
    expect(result.value["updatedAt"]).toBeInstanceOf(Date);
    expect(graph.company.list()).toEqual([]);
  });

  it("reuses lifecycle-managed timestamps for equivalent local create preflight and commit", () => {
    const { graph } = createGraph();
    const input = {
      name: "Acme",
      website: new URL("https://acme.com"),
      status: app.status.values.active.id,
    };

    const first = graph.company.validateCreate(input);
    const second = graph.company.validateCreate(input);

    expect(second).toEqual(first);
    if (!first.ok) throw new Error("Expected local create validation to pass");

    const id = graph.company.create(input);
    const company = graph.company.get(id);

    expect(company.createdAt?.toISOString()).toBe((first.value["createdAt"] as Date).toISOString());
    expect(company.updatedAt?.toISOString()).toBe((first.value["updatedAt"] as Date).toISOString());
  });

  it("keeps local create preflight and commit aligned when post-create graph validation fails", () => {
    const reviewItem = defineType({
      values: { key: "test:review-item", name: "Review Item" },
      fields: {
        ...core.node.fields,
        title: stringTypeModule.field({
          cardinality: "one",
        }),
      },
    });
    const namespace = defineNamespace({}, { reviewItem }, { strict: false });
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, namespace);
    const graph = createTypeClient(store, namespace);

    for (const edge of store.facts(namespace.reviewItem.values.id)) {
      store.retract(edge.id);
    }

    const input = {
      name: "Acme",
      title: "Ready",
    };

    const result = graph.reviewItem.validateCreate(input);

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "create",
    });
    if (result.ok) throw new Error("Expected local create validation to fail");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "reference.missing",
          predicateKey: core.node.fields.type.key,
        }),
      ]),
    );

    let error: unknown;
    try {
      graph.reviewItem.create(input);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    expect(graph.reviewItem.list()).toEqual([]);
  });

  it("rejects invalid create input before committing to the local store", () => {
    const { graph } = createGraph();

    let error: unknown;
    try {
      graph.company.create({
        name: "   ",
        website: new URL("https://acme.com"),
        status: app.status.values.active.id,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<Record<string, unknown>>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "local",
      event: "create",
    });
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "field",
          code: "string.blank",
          predicateKey: app.company.fields.name.key,
        }),
      ]),
    );
    expect(graph.company.list()).toEqual([]);
  });

  it("clones thrown validation results away from mutable caller preflight data", () => {
    const { graph } = createGraph();

    const result = graph.company.validateCreate({
      name: "   ",
      website: new URL("https://acme.com"),
      status: app.status.values.active.id,
    });

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "create",
    });
    if (result.ok) throw new Error("Expected local create validation to fail");

    const error = new GraphValidationError(result);

    (result.changedPredicateKeys as string[]).push("test:mutated");
    const firstIssue = result.issues[0]!;
    firstIssue.predicateKey = "test:mutated";
    firstIssue.message = "Mutated issue";

    expect(error.result.changedPredicateKeys).toEqual(
      expect.arrayContaining([app.company.fields.name.key]),
    );
    expect(error.result.changedPredicateKeys).not.toContain("test:mutated");
    expect(error.result.issues[0]?.predicateKey).toBe(app.company.fields.name.key);
    expect(error.result.issues[0]?.message).not.toBe("Mutated issue");
  });

  it("allows lifecycle-managed self references to validate on the simulated post-create graph", () => {
    const employee = defineType({
      values: { key: "test:employee", name: "Employee" },
      fields: {
        ...core.node.fields,
        manager: defineReferenceField({
          range: "test:employee",
          cardinality: "one?",
          onCreate: ({ incoming, nodeId }) => incoming ?? nodeId,
        }),
      },
    });
    const namespace = defineNamespace({}, { employee }, { strict: false });
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, namespace);
    const graph = createTypeClient(store, namespace);

    const result = graph.employee.validateCreate({
      name: "Ada",
    });

    expect(result).toMatchObject({
      ok: true,
      phase: "local",
      event: "create",
    });
    if (!result.ok) throw new Error("Expected local create validation to pass");
    const managerId = result.value["manager"];
    expect(managerId).toEqual(expect.any(String));
    if (typeof managerId !== "string") throw new Error("Expected manager id to be a string");

    const id = graph.employee.create({
      name: "Ada",
    });

    expect(id).toBe(managerId);
    expect(graph.employee.get(id).manager).toBe(id);
  });

  it("includes omitted required predicates in changedPredicateKeys for local create failures", () => {
    const { graph } = createGraph();
    const input = {
      name: "Acme",
      status: app.status.values.active.id,
    } as unknown as Parameters<typeof graph.company.validateCreate>[0];

    const result = graph.company.validateCreate(input);

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "create",
    });
    if (result.ok) throw new Error("Expected local create validation to fail");
    expect(result.changedPredicateKeys).toEqual(
      expect.arrayContaining([app.company.fields.website.key]),
    );
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "field.required",
          predicateKey: app.company.fields.website.key,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("website");
    expect(graph.company.list()).toEqual([]);
  });

  it("rejects create input that tries to override the managed type field", () => {
    const { graph } = createGraph();
    const input = {
      name: "Acme",
      website: new URL("https://acme.com"),
      status: app.status.values.active.id,
      type: [app.person.values.id],
    };

    const result = graph.company.validateCreate(input);

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "create",
    });
    if (result.ok) throw new Error("Expected local create validation to fail");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "field.managed",
          predicateKey: core.node.fields.type.key,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("type");

    let error: unknown;
    try {
      graph.company.create(input);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    expect(graph.company.list()).toEqual([]);
  });

  it("rejects create input that explicitly restates the managed type field", () => {
    const { graph } = createGraph();
    const input = {
      name: "Acme",
      website: new URL("https://acme.com"),
      status: app.status.values.active.id,
      type: [app.company.values.id],
    };

    const result = graph.company.validateCreate(input);

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "create",
    });
    if (result.ok) throw new Error("Expected local create validation to fail");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "field.managed",
          predicateKey: core.node.fields.type.key,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("type");
    expect(graph.company.list()).toEqual([]);
  });

  it("surfaces local update validation results without mutating entity state", () => {
    const { graph, companyId } = setupGraph();
    const companyRef = graph.company.ref(companyId);

    const result = companyRef.validateUpdate({
      name: "   ",
    });
    const handleResult = graph.company.validateUpdate(companyId, {
      name: "   ",
    });

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "update",
    });
    expect(handleResult).toEqual(result);
    if (result.ok) throw new Error("Expected local update validation to fail");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "field",
          code: "string.blank",
          predicateKey: app.company.fields.name.key,
          nodeId: companyId,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("name");
    expect(companyRef.fields.name.get()).toBe("Acme");
  });

  it("surfaces predicate-ref preflight results without mutating entity state", () => {
    const { graph, companyId } = setupGraph();
    const companyRef = graph.company.ref(companyId);

    const result = companyRef.fields.name.validateSet("   ");
    const handleResult = companyRef.validateUpdate({
      name: "   ",
    });

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "update",
    });
    expect(handleResult).toEqual(result);
    if (result.ok) throw new Error("Expected predicate-ref validation to fail");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "field",
          code: "string.blank",
          predicateKey: app.company.fields.name.key,
          nodeId: companyId,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("name");
    expect(companyRef.fields.name.get()).toBe("Acme");
  });

  it("returns explicit undefined payloads for successful optional field clear preflight", () => {
    const { graph } = createGraph();
    const companyId = graph.company.create({
      name: "Acme",
      website: new URL("https://acme.com"),
      status: app.status.values.active.id,
      foundedYear: 1999,
    });
    const companyRef = graph.company.ref(companyId);

    const result = companyRef.fields.foundedYear.validateClear();
    const handleResult = graph.company.validateUpdate(companyId, {
      foundedYear: undefined,
    });

    expect(result).toMatchObject({
      ok: true,
      phase: "local",
      event: "update",
    });
    expect(handleResult).toEqual(result);
    if (!result.ok) throw new Error("Expected optional clear validation to pass");
    expect(Object.hasOwn(result.value, "foundedYear")).toBe(true);
    expect(result.value["foundedYear"]).toBeUndefined();
    expect(companyRef.fields.foundedYear.get()).toBe(1999);
  });

  it("hides internal clear sentinels from caller-facing validation results", () => {
    const { graph, employeeId } = setupGraphWithProtectedNickname();
    const employeeRef = graph.employee.ref(employeeId);

    const result = employeeRef.fields.nickname.validateClear();
    const handleResult = graph.employee.validateUpdate(employeeId, {
      nickname: undefined,
    });

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "update",
    });
    expect(handleResult).toEqual(result);
    if (result.ok) throw new Error("Expected optional clear validation to fail");
    expect(Object.hasOwn(result.value, "nickname")).toBe(true);
    expect(result.value["nickname"]).toBeUndefined();
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "field",
          code: "string.clear",
          predicateKey: employeeRef.fields.nickname.field.key,
          nodeId: employeeId,
        }),
      ]),
    );

    let error: unknown;
    try {
      employeeRef.fields.nickname.clear();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<Record<string, unknown>>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "local",
      event: "update",
    });
    expect(Object.hasOwn(validationError.result.value, "nickname")).toBe(true);
    expect(validationError.result.value["nickname"]).toBeUndefined();
    expect(validationError.result.issues).toEqual(result.issues);
    expect(employeeRef.fields.nickname.get()).toBe("Ace");
  });

  it("rejects local updates when the simulated post-update graph would remain invalid", () => {
    const { graph, store, companyId } = setupGraph();

    for (const edge of store.facts(companyId, edgeId(app.company.fields.name))) {
      store.retract(edge.id);
    }

    const result = graph.company.validateUpdate(companyId, {
      website: new URL("https://acme.co"),
    });

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "update",
    });
    if (result.ok) throw new Error("Expected local update validation to fail");
    expect(result.changedPredicateKeys).toEqual(
      expect.arrayContaining([app.company.fields.name.key, app.company.fields.website.key]),
    );
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "field.required",
          predicateKey: app.company.fields.name.key,
          nodeId: companyId,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("name");
    expect(graph.company.get(companyId).website.toString()).toBe("https://acme.com/");

    let error: unknown;
    try {
      graph.company.update(companyId, {
        website: new URL("https://acme.co"),
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    expect(graph.company.get(companyId).website.toString()).toBe("https://acme.com/");
  });

  it("rejects local updates when a single-value field already has duplicate current facts", () => {
    const { graph, store, companyId } = setupGraph();

    store.assert(companyId, edgeId(app.company.fields.name), "Acme");

    const result = graph.company.validateUpdate(companyId, {
      website: new URL("https://acme.co"),
    });

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "update",
    });
    if (result.ok) throw new Error("Expected local update validation to fail");
    expect(result.changedPredicateKeys).toEqual(
      expect.arrayContaining([app.company.fields.name.key, app.company.fields.website.key]),
    );
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "field.cardinality",
          predicateKey: app.company.fields.name.key,
          nodeId: companyId,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("name");
    expect(graph.company.get(companyId).name).toBe("Acme");

    let error: unknown;
    try {
      graph.company.update(companyId, {
        website: new URL("https://acme.co"),
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    expect(graph.company.get(companyId).website.toString()).toBe("https://acme.com/");
  });

  it("rejects local creates when the simulated post-create graph would remain invalid", () => {
    const { graph, store, companyId } = setupGraph();

    for (const edge of store.facts(companyId, edgeId(app.company.fields.name))) {
      store.retract(edge.id);
    }

    const input = {
      name: "Beta",
      website: new URL("https://beta.example"),
      status: app.status.values.active.id,
    };

    const result = graph.company.validateCreate(input);

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "create",
    });
    if (result.ok) throw new Error("Expected local create validation to fail");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "field.required",
          predicateKey: app.company.fields.name.key,
          nodeId: companyId,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("name");
    expect(graph.company.list()).toHaveLength(1);

    let error: unknown;
    try {
      graph.company.create(input);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    expect(graph.company.list()).toHaveLength(1);
  });

  it("rejects blank names through typed field mutations", () => {
    const { graph, companyId } = setupGraph();
    const companyRef = graph.company.ref(companyId);

    let error: unknown;
    try {
      companyRef.fields.name.set("   ");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<Record<string, unknown>>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "local",
      event: "update",
    });
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
    expect(companyRef.fields.name.get()).toBe("Acme");
  });

  it("rejects non-finite numbers through scalar type validation", () => {
    const { graph, companyId } = setupGraph();

    let error: unknown;
    try {
      graph.company.update(companyId, { foundedYear: Number.NaN });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<Record<string, unknown>>;
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "type",
          code: "number.notFinite",
          predicateKey: app.company.fields.foundedYear.key,
        }),
      ]),
    );
    expect(graph.company.get(companyId).foundedYear).toBeUndefined();
  });

  it("rejects wrong local built-in scalar input kinds through type-owned validation", () => {
    const { graph } = createGraph();
    const cases = [
      {
        message: "Expected URL value, got string.",
        path: "website",
        predicateKey: app.company.fields.website.key,
        result: graph.company.validateCreate({
          name: "Acme",
          website: "https://acme.com" as unknown as URL,
          status: app.status.values.active.id,
        }),
      },
      {
        message: "Expected number value, got string.",
        path: "order",
        predicateKey: app.block.fields.order.key,
        result: graph.block.validateCreate({
          name: "Outline",
          text: "Plan",
          order: "1" as unknown as number,
        }),
      },
      {
        message: "Expected boolean value, got string.",
        path: "collapsed",
        predicateKey: app.block.fields.collapsed.key,
        result: graph.block.validateCreate({
          name: "Outline",
          text: "Plan",
          order: 1,
          collapsed: "false" as unknown as boolean,
        }),
      },
    ];

    for (const testCase of cases) {
      expect(testCase.result).toMatchObject({
        ok: false,
        phase: "local",
        event: "create",
      });
      if (testCase.result.ok) throw new Error("Expected local scalar validation to fail");
      expect(testCase.result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "type",
            code: "value.invalid",
            message: `Field "${testCase.path}" is invalid: ${testCase.message}`,
            predicateKey: testCase.predicateKey,
          }),
        ]),
      );
      expect(formatValidationPath(testCase.result.issues[0]?.path ?? [])).toBe(testCase.path);
    }

    expect(graph.company.list()).toEqual([]);
    expect(graph.block.list()).toEqual([]);
  });

  it("rejects wrong-type entity references through typed field mutations", () => {
    const { graph, companyId } = setupGraph();
    const personId = graph.person.create({
      name: "Alice",
      worksAt: [companyId],
    });
    const otherPersonId = graph.person.create({
      name: "Bob",
    });

    let error: unknown;
    try {
      graph.person.ref(personId).fields.worksAt.add(otherPersonId);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<Record<string, unknown>>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "local",
      event: "update",
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
    expect(graph.person.get(personId).worksAt).toEqual([companyId]);
  });

  it("surfaces many-field predicate preflight results before committing relationship edits", () => {
    const { graph, companyId } = setupGraph();
    const personId = graph.person.create({
      name: "Alice",
      worksAt: [companyId],
    });
    const otherPersonId = graph.person.create({
      name: "Bob",
    });
    const worksAtRef = graph.person.ref(personId).fields.worksAt;

    const result = worksAtRef.validateAdd(otherPersonId);

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "update",
    });
    if (result.ok) throw new Error("Expected predicate-ref collection validation to fail");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "reference.type",
          predicateKey: app.person.fields.worksAt.key,
          nodeId: personId,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("worksAt");
    expect(worksAtRef.get()).toEqual([companyId]);
  });

  it("rejects invalid many-field remove targets through the shared predicate-ref validation path", () => {
    const { graph, companyId } = setupGraph();
    const personId = graph.person.create({
      name: "Alice",
      worksAt: [companyId],
    });
    const otherPersonId = graph.person.create({
      name: "Bob",
    });
    const worksAtRef = graph.person.ref(personId).fields.worksAt;

    const result = worksAtRef.validateRemove(otherPersonId);

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "update",
    });
    if (result.ok) throw new Error("Expected predicate-ref collection remove validation to fail");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "reference.type",
          predicateKey: app.person.fields.worksAt.key,
          nodeId: personId,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("worksAt");
    expect(worksAtRef.get()).toEqual([companyId]);

    let error: unknown;
    try {
      worksAtRef.remove(otherPersonId);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<Record<string, unknown>>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "local",
      event: "update",
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
    expect(worksAtRef.get()).toEqual([companyId]);
  });

  it("surfaces many-field replace preflight results before committing collection replacement", () => {
    const { graph, companyId } = setupGraph();
    const personId = graph.person.create({
      name: "Alice",
      worksAt: [companyId],
    });
    const otherPersonId = graph.person.create({
      name: "Bob",
    });
    const worksAtRef = graph.person.ref(personId).fields.worksAt;

    const result = worksAtRef.validateReplace([companyId, otherPersonId]);
    const handleResult = graph.person.validateUpdate(personId, {
      worksAt: [companyId, otherPersonId],
    });

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "update",
    });
    expect(handleResult).toEqual(result);
    if (result.ok) throw new Error("Expected predicate-ref collection replace validation to fail");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "reference.type",
          predicateKey: app.person.fields.worksAt.key,
          nodeId: personId,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("worksAt");
    expect(worksAtRef.get()).toEqual([companyId]);
  });

  it("rejects updates through typed handles when the target node has a different type", () => {
    const { graph, companyId } = setupGraph();
    const personId = graph.person.create({
      name: "Alice",
      worksAt: [companyId],
    });

    const result = graph.company.validateUpdate(personId, {
      status: app.status.values.paused.id,
    });

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "update",
    });
    if (result.ok) throw new Error("Expected wrong-type handle update validation to fail");
    expect(result.changedPredicateKeys).toEqual(
      expect.arrayContaining([core.node.fields.type.key, app.company.fields.status.key]),
    );
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "type.mismatch",
          predicateKey: core.node.fields.type.key,
          nodeId: personId,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("type");
    expect(graph.person.get(personId)).toMatchObject({
      name: "Alice",
      worksAt: [companyId],
    });

    let error: unknown;
    try {
      graph.company.update(personId, {
        status: app.status.values.paused.id,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    expect(graph.person.get(personId)).toMatchObject({
      name: "Alice",
      worksAt: [companyId],
    });
  });

  it("rejects managed type mutations through typed entity handles", () => {
    const { graph, companyId } = setupGraph();
    const companyRef = graph.company.ref(companyId);

    let error: unknown;
    try {
      companyRef.fields.type.clear();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<Record<string, unknown>>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "local",
      event: "update",
    });
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "field.managed",
          predicateKey: core.node.fields.type.key,
          nodeId: companyId,
        }),
      ]),
    );
    expect(formatValidationPath(validationError.result.issues[0]?.path ?? [])).toBe("type");
    expect(companyRef.fields.type.get()).toEqual([app.company.values.id]);
    expect(graph.company.list().map((company) => company.id)).toEqual([companyId]);
  });

  it("rejects managed type mutations even when they restate the current type", () => {
    const { graph, companyId } = setupGraph();
    const companyRef = graph.company.ref(companyId);

    let error: unknown;
    try {
      companyRef.fields.type.replace([app.company.values.id]);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<Record<string, unknown>>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "local",
      event: "update",
    });
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "field.managed",
          predicateKey: core.node.fields.type.key,
          nodeId: companyId,
        }),
      ]),
    );
    expect(formatValidationPath(validationError.result.issues[0]?.path ?? [])).toBe("type");
    expect(companyRef.fields.type.get()).toEqual([app.company.values.id]);
  });

  it("surfaces local delete validation results without retracting facts", () => {
    const { graph, companyId } = setupGraph();
    const personId = graph.person.create({
      name: "Alice",
      worksAt: [companyId],
    });

    const result = graph.company.validateDelete(companyId);

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "delete",
    });
    expect(graph.company.ref(companyId).validateDelete()).toEqual(result);
    if (result.ok) throw new Error("Expected local delete validation to fail");
    expect(result.changedPredicateKeys).toEqual([app.person.fields.worksAt.key]);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "reference.missing",
          predicateKey: app.person.fields.worksAt.key,
          nodeId: personId,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("worksAt");
    expect(graph.company.get(companyId).name).toBe("Acme");
    expect(graph.person.get(personId).worksAt).toEqual([companyId]);
  });

  it("rejects deletes that would leave dangling references through typed handles", () => {
    const { graph, companyId } = setupGraph();
    const personId = graph.person.create({
      name: "Alice",
      worksAt: [companyId],
    });

    let error: unknown;
    try {
      graph.company.delete(companyId);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<string>;
    expect(validationError.result).toMatchObject({
      ok: false,
      phase: "local",
      event: "delete",
    });
    expect(validationError.result.changedPredicateKeys).toEqual([app.person.fields.worksAt.key]);
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "reference.missing",
          predicateKey: app.person.fields.worksAt.key,
          nodeId: personId,
        }),
      ]),
    );
    expect(formatValidationPath(validationError.result.issues[0]?.path ?? [])).toBe("worksAt");
    expect(graph.company.get(companyId).name).toBe("Acme");
    expect(graph.person.get(personId).worksAt).toEqual([companyId]);
  });

  it("rejects deletes through typed handles when the target node does not exist", () => {
    const { graph, companyId } = setupGraph();
    const missingId = "missing-node";

    const result = graph.company.validateDelete(missingId);

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "delete",
    });
    if (result.ok) throw new Error("Expected missing-node delete validation to fail");
    expect(result.changedPredicateKeys).toEqual([core.node.fields.type.key]);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "node.missing",
          predicateKey: core.node.fields.type.key,
          nodeId: missingId,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("type");

    let error: unknown;
    try {
      graph.company.delete(missingId);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    expect(graph.company.get(companyId).name).toBe("Acme");
  });

  it("allows entity-ref deletes after inbound references are cleared", () => {
    const { graph, companyId } = setupGraph();
    const personId = graph.person.create({
      name: "Alice",
      worksAt: [companyId],
    });

    graph.person.update(personId, {
      worksAt: [],
    });

    graph.company.ref(companyId).delete();

    expect(graph.company.list()).toEqual([]);
    expect(graph.person.get(personId).worksAt).toEqual([]);
  });
});
