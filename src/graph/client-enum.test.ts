import { describe, expect, it } from "bun:test";

import { bootstrap, createStore } from "@io/core/graph";
import { core } from "@io/core/graph/modules";
import { createGraphClient, GraphValidationError, formatValidationPath } from "@io/graph-client";

import { kitchenSink } from "./testing/kitchen-sink.js";

const kitchenSinkDefs = { ...core, ...kitchenSink } as const;

describe("enum range client behavior", () => {
  it("accepts valid enum value ids", () => {
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, kitchenSink);
    const graph = createGraphClient(store, kitchenSink, kitchenSinkDefs);

    const id = graph.record.create({
      name: "Acme",
      headline: "KS-1",
      status: kitchenSink.status.values.draft.id,
      score: 10,
    });

    const record = graph.record.get(id);
    expect(record.status).toBe(kitchenSink.status.values.draft.id);
  });

  it("surfaces unknown enum value ids through the shared validation contract", () => {
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, kitchenSink);
    const graph = createGraphClient(store, kitchenSink, kitchenSinkDefs);

    let error: unknown;
    try {
      graph.record.create({
        name: "Bad Co",
        headline: "KS-2",
        status: "draft",
        score: 13,
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
          predicateKey: kitchenSink.record.fields.status.key,
        }),
      ]),
    );
    expect(formatValidationPath(validationError.result.issues[0]?.path ?? [])).toBe("status");
    expect(graph.record.list()).toEqual([]);
  });

  it("surfaces invalid many-enum updates through GraphValidationError instead of raw errors", () => {
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, kitchenSink);
    const graph = createGraphClient(store, kitchenSink, kitchenSinkDefs);
    const id = graph.record.create({
      name: "Contract",
      headline: "KS-10",
      status: kitchenSink.status.values.draft.id,
      statusHistory: [kitchenSink.status.values.draft.id],
      score: 75,
    });

    let error: unknown;
    try {
      graph.record.update(id, {
        statusHistory: ["kitchen:status.invalid"],
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
          predicateKey: kitchenSink.record.fields.statusHistory.key,
        }),
      ]),
    );
    expect(formatValidationPath(validationError.result.issues[0]?.path ?? [])).toBe(
      "statusHistory",
    );
    expect(graph.record.get(id).statusHistory).toEqual([kitchenSink.status.values.draft.id]);
  });
});
