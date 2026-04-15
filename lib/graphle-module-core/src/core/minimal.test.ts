import { describe, expect, it } from "bun:test";

import {
  createBootstrappedSnapshot,
  requireGraphBootstrapCoreSchema,
} from "@dpeek/graphle-bootstrap";

import { minimalCore, minimalCoreGraphBootstrapOptions } from "./minimal.js";

describe("minimal core namespace", () => {
  it("boots without icon or svg contracts", () => {
    const coreSchema = requireGraphBootstrapCoreSchema(minimalCore);
    const snapshot = createBootstrappedSnapshot(minimalCore, minimalCoreGraphBootstrapOptions);

    expect(coreSchema.icon).toBeUndefined();
    expect(coreSchema.type.fields.icon).toBeUndefined();
    expect(coreSchema.predicate.fields.icon).toBeUndefined();
    expect(Object.keys(minimalCore).sort()).toEqual(
      [
        "boolean",
        "cardinality",
        "date",
        "enum",
        "json",
        "markdown",
        "node",
        "number",
        "predicate",
        "slug",
        "string",
        "type",
        "url",
      ].sort(),
    );
    expect(snapshot.edges.length).toBeGreaterThan(0);
  });
});
