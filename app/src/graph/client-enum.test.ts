import { describe, expect, it } from "bun:test";
import { app } from "./app";
import { bootstrap } from "./bootstrap";
import { GraphValidationError, createTypeClient, formatValidationPath } from "./client";
import { core } from "./core";
import { defineEnum, defineNamespace, defineType } from "./schema";
import { createStore } from "./store";
import { defineDefaultEnumTypeModule } from "../type/enum-module";

describe("enum range client behavior", () => {
  it("accepts valid enum value ids", () => {
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, app);
    const graph = createTypeClient(store, app);

    const id = graph.company.create({
      name: "Acme",
      website: new URL("https://acme.com"),
      status: app.status.values.active.id,
    });

    const company = graph.company.get(id);
    expect(company.status).toBe(app.status.values.active.id);
  });

  it("surfaces unknown enum value ids through the shared validation contract", () => {
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, app);
    const graph = createTypeClient(store, app);

    let error: unknown;
    try {
      graph.company.create({
        name: "Bad Co",
        website: new URL("https://bad.example"),
        status: "active",
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
          source: "type",
          code: "enum.member",
          predicateKey: app.company.fields.status.key,
        }),
      ]),
    );
    expect(formatValidationPath(validationError.result.issues[0]?.path ?? [])).toBe("status");
    expect(graph.company.list()).toEqual([]);
  });

  it("surfaces invalid many-enum updates through GraphValidationError instead of raw errors", () => {
    const reviewState = defineEnum({
      values: { key: "test:review-state", name: "Review State" },
      options: {
        draft: { name: "Draft" },
        approved: { name: "Approved" },
      },
    });
    const reviewStateModule = defineDefaultEnumTypeModule(reviewState);
    const reviewItem = defineType({
      values: { key: "test:review-item", name: "Review Item" },
      fields: {
        ...core.node.fields,
        states: reviewStateModule.field({
          cardinality: "many",
        }),
      },
    });
    const testNamespace = defineNamespace(
      {},
      {
        reviewState,
        reviewItem,
      },
      { strict: false },
    );

    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, testNamespace);
    const graph = createTypeClient(store, testNamespace);
    const id = graph.reviewItem.create({
      name: "Contract",
      states: [testNamespace.reviewState.values.draft.key],
    });

    let error: unknown;
    try {
      graph.reviewItem.update(id, {
        states: ["test:review-state.invalid"],
      });
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
          source: "type",
          code: "enum.member",
          predicateKey: testNamespace.reviewItem.fields.states.key,
        }),
      ]),
    );
    expect(formatValidationPath(validationError.result.issues[0]?.path ?? [])).toBe("states");
    expect(graph.reviewItem.get(id).states).toEqual([testNamespace.reviewState.values.draft.key]);
  });
});
