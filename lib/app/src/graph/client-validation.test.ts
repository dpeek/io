import { describe, expect, it } from "bun:test";

import { createStore, applyIdMap, edgeId } from "@io/app/graph";
import { bootstrap } from "@io/graph-bootstrap";
import { createGraphClient, GraphValidationError, formatValidationPath } from "@io/graph-client";
import { defineReferenceField, defineType } from "@io/graph-module";
import { core, coreGraphBootstrapOptions, stringTypeModule } from "@io/graph-module-core";

import { createTestGraph, testNamespace } from "./test-graph.js";

function createGraph() {
  return createTestGraph();
}

function createRecordInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Acme",
    headline: "KS-ACME",
    website: new URL("https://acme.com"),
    status: testNamespace.status.values.draft.id,
    score: 42,
    ...overrides,
  };
}

function setupGraph() {
  const { store, graph } = createGraph();

  const recordId = graph.record.create(createRecordInput());

  return { store, graph, recordId };
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
  const namespace = applyIdMap({}, { employee }, { strict: false });
  const definitions = { ...core, ...namespace } as const;
  const store = createStore();
  bootstrap(store, core, coreGraphBootstrapOptions);
  bootstrap(store, namespace, coreGraphBootstrapOptions);
  const graph = createGraphClient(store, namespace, definitions);
  const employeeId = graph.employee.create({
    name: "Ada",
    nickname: "Ace",
  });

  return { store, graph, employeeId };
}

describe("graph validation", () => {
  it("preflights create input through the local validation pipeline without committing", () => {
    const { graph } = createGraph();

    const result = graph.record.validateCreate(createRecordInput());

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
    expect(graph.record.list()).toEqual([]);
  });

  it("reuses lifecycle-managed timestamps for equivalent local create preflight and commit", () => {
    const { graph } = createGraph();
    const input = createRecordInput();

    const first = graph.record.validateCreate(input);
    const second = graph.record.validateCreate(input);

    expect(second).toEqual(first);
    if (!first.ok) throw new Error("Expected local create validation to pass");

    const id = graph.record.create(input);
    const record = graph.record.get(id);

    expect(record.createdAt?.toISOString()).toBe((first.value["createdAt"] as Date).toISOString());
    expect(record.updatedAt?.toISOString()).toBe((first.value["updatedAt"] as Date).toISOString());
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
    const namespace = applyIdMap({}, { reviewItem }, { strict: false });
    const definitions = { ...core, ...namespace } as const;
    const store = createStore();
    bootstrap(store, core, coreGraphBootstrapOptions);
    bootstrap(store, namespace, coreGraphBootstrapOptions);
    const graph = createGraphClient(store, namespace, definitions);

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
      graph.record.create(createRecordInput({ name: "   " }));
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
          predicateKey: testNamespace.record.fields.name.key,
        }),
      ]),
    );
    expect(graph.record.list()).toEqual([]);
  });

  it("clones thrown validation results away from mutable caller preflight data", () => {
    const { graph } = createGraph();

    const result = graph.record.validateCreate(createRecordInput({ name: "   " }));

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
      expect.arrayContaining([testNamespace.record.fields.name.key]),
    );
    expect(error.result.changedPredicateKeys).not.toContain("test:mutated");
    expect(error.result.issues[0]?.predicateKey).toBe(testNamespace.record.fields.name.key);
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
    const namespace = applyIdMap({}, { employee }, { strict: false });
    const definitions = { ...core, ...namespace } as const;
    const store = createStore();
    bootstrap(store, core, coreGraphBootstrapOptions);
    bootstrap(store, namespace, coreGraphBootstrapOptions);
    const graph = createGraphClient(store, namespace, definitions);

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
      status: testNamespace.status.values.draft.id,
      score: 42,
    } as unknown as Parameters<typeof graph.record.validateCreate>[0];

    const result = graph.record.validateCreate(input);

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "create",
    });
    if (result.ok) throw new Error("Expected local create validation to fail");
    expect(result.changedPredicateKeys).toEqual(
      expect.arrayContaining([testNamespace.record.fields.headline.key]),
    );
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "field.required",
          predicateKey: testNamespace.record.fields.headline.key,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("headline");
    expect(graph.record.list()).toEqual([]);
  });

  it("rejects create input that tries to override the managed type field", () => {
    const { graph } = createGraph();
    const input = createRecordInput({
      type: [testNamespace.person.values.id],
    });

    const result = graph.record.validateCreate(input);

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
      graph.record.create(input);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    expect(graph.record.list()).toEqual([]);
  });

  it("rejects create input that explicitly restates the managed type field", () => {
    const { graph } = createGraph();
    const input = createRecordInput({
      type: [testNamespace.record.values.id],
    });

    const result = graph.record.validateCreate(input);

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
    expect(graph.record.list()).toEqual([]);
  });

  it("surfaces local update validation results without mutating entity state", () => {
    const { graph, recordId } = setupGraph();
    const recordRef = graph.record.ref(recordId);

    const result = recordRef.validateUpdate({
      name: "   ",
    });
    const handleResult = graph.record.validateUpdate(recordId, {
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
          predicateKey: testNamespace.record.fields.name.key,
          nodeId: recordId,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("name");
    expect(recordRef.fields.name.get()).toBe("Acme");
  });

  it("surfaces predicate-ref preflight results without mutating entity state", () => {
    const { graph, recordId } = setupGraph();
    const recordRef = graph.record.ref(recordId);

    const result = recordRef.fields.name.validateSet("   ");
    const handleResult = recordRef.validateUpdate({
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
          predicateKey: testNamespace.record.fields.name.key,
          nodeId: recordId,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("name");
    expect(recordRef.fields.name.get()).toBe("Acme");
  });

  it("returns explicit undefined payloads for successful optional field clear preflight", () => {
    const { graph } = createGraph();
    const recordId = graph.record.create(createRecordInput({ estimate: 1_200_000 }));
    const recordRef = graph.record.ref(recordId);

    const result = recordRef.fields.estimate.validateClear();
    const handleResult = graph.record.validateUpdate(recordId, {
      estimate: undefined,
    });

    expect(result).toMatchObject({
      ok: true,
      phase: "local",
      event: "update",
    });
    expect(handleResult).toEqual(result);
    if (!result.ok) throw new Error("Expected optional clear validation to pass");
    expect(Object.hasOwn(result.value, "estimate")).toBe(true);
    expect(result.value["estimate"]).toBeUndefined();
    expect(recordRef.fields.estimate.get()).toBe(1_200_000);
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
    const { graph, store, recordId } = setupGraph();

    for (const edge of store.facts(recordId, edgeId(testNamespace.record.fields.name))) {
      store.retract(edge.id);
    }

    const result = graph.record.validateUpdate(recordId, {
      website: new URL("https://acme.co"),
    });

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "update",
    });
    if (result.ok) throw new Error("Expected local update validation to fail");
    expect(result.changedPredicateKeys).toEqual(
      expect.arrayContaining([
        testNamespace.record.fields.name.key,
        testNamespace.record.fields.website.key,
      ]),
    );
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "field.required",
          predicateKey: testNamespace.record.fields.name.key,
          nodeId: recordId,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("name");
    expect(graph.record.get(recordId).website?.toString()).toBe("https://acme.com/");

    let error: unknown;
    try {
      graph.record.update(recordId, {
        website: new URL("https://acme.co"),
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    expect(graph.record.get(recordId).website?.toString()).toBe("https://acme.com/");
  });

  it("rejects local updates when a single-value field already has duplicate current facts", () => {
    const { graph, store, recordId } = setupGraph();

    store.assert(recordId, edgeId(testNamespace.record.fields.name), "Acme");

    const result = graph.record.validateUpdate(recordId, {
      website: new URL("https://acme.co"),
    });

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "update",
    });
    if (result.ok) throw new Error("Expected local update validation to fail");
    expect(result.changedPredicateKeys).toEqual(
      expect.arrayContaining([
        testNamespace.record.fields.name.key,
        testNamespace.record.fields.website.key,
      ]),
    );
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "field.cardinality",
          predicateKey: testNamespace.record.fields.name.key,
          nodeId: recordId,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("name");
    expect(graph.record.get(recordId).name).toBe("Acme");

    let error: unknown;
    try {
      graph.record.update(recordId, {
        website: new URL("https://acme.co"),
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    expect(graph.record.get(recordId).website?.toString()).toBe("https://acme.com/");
  });

  it("rejects local creates when the simulated post-create graph would remain invalid", () => {
    const { graph, store, recordId } = setupGraph();

    for (const edge of store.facts(recordId, edgeId(testNamespace.record.fields.name))) {
      store.retract(edge.id);
    }

    const input = createRecordInput({
      name: "Beta",
      headline: "KS-BETA",
      website: new URL("https://beta.example"),
    });

    const result = graph.record.validateCreate(input);

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
          predicateKey: testNamespace.record.fields.name.key,
          nodeId: recordId,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("name");
    expect(graph.record.list()).toHaveLength(1);

    let error: unknown;
    try {
      graph.record.create(input);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    expect(graph.record.list()).toHaveLength(1);
  });

  it("rejects blank names through typed field mutations", () => {
    const { graph, recordId } = setupGraph();
    const recordRef = graph.record.ref(recordId);

    let error: unknown;
    try {
      recordRef.fields.name.set("   ");
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
          predicateKey: testNamespace.record.fields.name.key,
        }),
      ]),
    );
    expect(formatValidationPath(validationError.result.issues[0]?.path ?? [])).toBe("name");
    expect(recordRef.fields.name.get()).toBe("Acme");
  });

  it("rejects non-finite numbers through scalar type validation", () => {
    const { graph, recordId } = setupGraph();

    let error: unknown;
    try {
      graph.record.update(recordId, { estimate: Number.NaN });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    const validationError = error as GraphValidationError<Record<string, unknown>>;
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "type",
          code: "value.invalid",
          message: 'Field "estimate" is invalid: Duration values must be finite.',
          predicateKey: testNamespace.record.fields.estimate.key,
        }),
      ]),
    );
    expect(graph.record.get(recordId).estimate).toBeUndefined();
  });

  it("rejects wrong local built-in scalar input kinds through type-owned validation", () => {
    const { graph } = createGraph();
    const cases = [
      {
        message: "Expected URL value, got string.",
        path: "website",
        predicateKey: testNamespace.record.fields.website.key,
        result: graph.record.validateCreate({
          ...createRecordInput(),
          website: "https://acme.com" as unknown as URL,
        }),
      },
      {
        message: "Expected number value, got string.",
        path: "estimate",
        predicateKey: testNamespace.record.fields.estimate.key,
        result: graph.record.validateCreate({
          ...createRecordInput(),
          estimate: "30 min" as unknown as number,
        }),
      },
      {
        message: "Expected boolean value, got string.",
        path: "archived",
        predicateKey: testNamespace.record.fields.archived.key,
        result: graph.record.validateCreate({
          ...createRecordInput(),
          archived: "false" as unknown as boolean,
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

    expect(graph.record.list()).toEqual([]);
  });

  it("rejects wrong-type entity references through typed field mutations", () => {
    const { graph, recordId } = setupGraph();
    graph.person.create({
      name: "Alice",
      status: testNamespace.status.values.inReview.id,
    });
    const otherRecordId = graph.record.create(
      createRecordInput({ name: "Beta", headline: "KS-BETA" }),
    );

    let error: unknown;
    try {
      graph.record.ref(recordId).fields.reviewers.add(otherRecordId);
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
          predicateKey: testNamespace.record.fields.reviewers.key,
          nodeId: recordId,
        }),
      ]),
    );
    expect(formatValidationPath(validationError.result.issues[0]?.path ?? [])).toBe("reviewers");
    expect(graph.record.get(recordId).reviewers).toEqual([]);
  });

  it("surfaces many-field predicate preflight results before committing relationship edits", () => {
    const { graph, recordId } = setupGraph();
    const reviewerId = graph.person.create({
      name: "Alice",
      status: testNamespace.status.values.inReview.id,
    });
    graph.record.update(recordId, { reviewers: [reviewerId] });
    const otherRecordId = graph.record.create(
      createRecordInput({ name: "Beta", headline: "KS-BETA" }),
    );
    const reviewersRef = graph.record.ref(recordId).fields.reviewers;

    const result = reviewersRef.validateAdd(otherRecordId);

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
          predicateKey: testNamespace.record.fields.reviewers.key,
          nodeId: recordId,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("reviewers");
    expect(reviewersRef.get()).toEqual([reviewerId]);
  });

  it("rejects invalid many-field remove targets through the shared predicate-ref validation path", () => {
    const { graph, recordId } = setupGraph();
    const reviewerId = graph.person.create({
      name: "Alice",
      status: testNamespace.status.values.inReview.id,
    });
    graph.record.update(recordId, { reviewers: [reviewerId] });
    const otherRecordId = graph.record.create(
      createRecordInput({ name: "Beta", headline: "KS-BETA" }),
    );
    const reviewersRef = graph.record.ref(recordId).fields.reviewers;

    const result = reviewersRef.validateRemove(otherRecordId);

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
          predicateKey: testNamespace.record.fields.reviewers.key,
          nodeId: recordId,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("reviewers");
    expect(reviewersRef.get()).toEqual([reviewerId]);

    let error: unknown;
    try {
      reviewersRef.remove(otherRecordId);
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
          predicateKey: testNamespace.record.fields.reviewers.key,
          nodeId: recordId,
        }),
      ]),
    );
    expect(reviewersRef.get()).toEqual([reviewerId]);
  });

  it("surfaces many-field replace preflight results before committing collection replacement", () => {
    const { graph, recordId } = setupGraph();
    const reviewerId = graph.person.create({
      name: "Alice",
      status: testNamespace.status.values.inReview.id,
    });
    graph.record.update(recordId, { reviewers: [reviewerId] });
    const otherRecordId = graph.record.create(
      createRecordInput({ name: "Beta", headline: "KS-BETA" }),
    );
    const reviewersRef = graph.record.ref(recordId).fields.reviewers;

    const result = reviewersRef.validateReplace([reviewerId, otherRecordId]);
    const handleResult = graph.record.validateUpdate(recordId, {
      reviewers: [reviewerId, otherRecordId],
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
          predicateKey: testNamespace.record.fields.reviewers.key,
          nodeId: recordId,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("reviewers");
    expect(reviewersRef.get()).toEqual([reviewerId]);
  });

  it("rejects updates through typed handles when the target node has a different type", () => {
    const { graph } = setupGraph();
    const personId = graph.person.create({
      name: "Alice",
      status: testNamespace.status.values.inReview.id,
    });

    const result = graph.record.validateUpdate(personId, {
      status: testNamespace.status.values.approved.id,
    });

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "update",
    });
    if (result.ok) throw new Error("Expected wrong-type handle update validation to fail");
    expect(result.changedPredicateKeys).toEqual(
      expect.arrayContaining([core.node.fields.type.key, testNamespace.record.fields.status.key]),
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
    });

    let error: unknown;
    try {
      graph.record.update(personId, {
        status: testNamespace.status.values.approved.id,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    expect(graph.person.get(personId)).toMatchObject({
      name: "Alice",
    });
  });

  it("rejects managed type mutations through typed entity handles", () => {
    const { graph, recordId } = setupGraph();
    const recordRef = graph.record.ref(recordId);

    let error: unknown;
    try {
      recordRef.fields.type.clear();
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
          nodeId: recordId,
        }),
      ]),
    );
    expect(formatValidationPath(validationError.result.issues[0]?.path ?? [])).toBe("type");
    expect(recordRef.fields.type.get()).toEqual([testNamespace.record.values.id]);
    expect(graph.record.list().map((record) => record.id)).toEqual([recordId]);
  });

  it("rejects managed type mutations even when they restate the current type", () => {
    const { graph, recordId } = setupGraph();
    const recordRef = graph.record.ref(recordId);

    let error: unknown;
    try {
      recordRef.fields.type.replace([testNamespace.record.values.id]);
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
          nodeId: recordId,
        }),
      ]),
    );
    expect(formatValidationPath(validationError.result.issues[0]?.path ?? [])).toBe("type");
    expect(recordRef.fields.type.get()).toEqual([testNamespace.record.values.id]);
  });

  it("surfaces local delete validation results without retracting facts", () => {
    const { graph, recordId } = setupGraph();
    const personId = graph.person.create({
      name: "Alice",
      status: testNamespace.status.values.inReview.id,
    });
    graph.record.update(recordId, {
      reviewers: [personId],
    });

    const result = graph.person.validateDelete(personId);

    expect(result).toMatchObject({
      ok: false,
      phase: "local",
      event: "delete",
    });
    expect(graph.person.ref(personId).validateDelete()).toEqual(result);
    if (result.ok) throw new Error("Expected local delete validation to fail");
    expect(result.changedPredicateKeys).toEqual([testNamespace.record.fields.reviewers.key]);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "reference.missing",
          predicateKey: testNamespace.record.fields.reviewers.key,
          nodeId: recordId,
        }),
      ]),
    );
    expect(formatValidationPath(result.issues[0]?.path ?? [])).toBe("reviewers");
    expect(graph.record.get(recordId).name).toBe("Acme");
    expect(graph.person.get(personId).name).toBe("Alice");
  });

  it("rejects deletes that would leave dangling references through typed handles", () => {
    const { graph, recordId } = setupGraph();
    const personId = graph.person.create({
      name: "Alice",
      status: testNamespace.status.values.inReview.id,
    });
    graph.record.update(recordId, {
      reviewers: [personId],
    });

    let error: unknown;
    try {
      graph.person.delete(personId);
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
    expect(validationError.result.changedPredicateKeys).toEqual([
      testNamespace.record.fields.reviewers.key,
    ]);
    expect(validationError.result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime",
          code: "reference.missing",
          predicateKey: testNamespace.record.fields.reviewers.key,
          nodeId: recordId,
        }),
      ]),
    );
    expect(formatValidationPath(validationError.result.issues[0]?.path ?? [])).toBe("reviewers");
    expect(graph.record.get(recordId).name).toBe("Acme");
    expect(graph.person.get(personId).name).toBe("Alice");
  });

  it("rejects deletes through typed handles when the target node does not exist", () => {
    const { graph, recordId } = setupGraph();
    const missingId = "missing-node";

    const result = graph.record.validateDelete(missingId);

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
      graph.record.delete(missingId);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphValidationError);
    expect(graph.record.get(recordId).name).toBe("Acme");
  });

  it("allows entity-ref deletes after inbound references are cleared", () => {
    const { graph, recordId } = setupGraph();
    const personId = graph.person.create({
      name: "Alice",
      status: testNamespace.status.values.inReview.id,
    });
    graph.record.update(recordId, {
      reviewers: [personId],
    });

    graph.record.update(recordId, {
      reviewers: [],
    });

    graph.person.ref(personId).delete();

    expect(graph.person.list()).toEqual([]);
    expect(graph.record.get(recordId).reviewers).toEqual([]);
  });
});
