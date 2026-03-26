import { describe, expect, it } from "bun:test";

import * as kernel from "./index.js";

describe("graph-kernel package surface", () => {
  it("publishes explicit graph-prefixed factories and field-tree helpers", () => {
    expect(Object.keys(kernel)).toEqual(
      expect.arrayContaining([
        "applyGraphIdMap",
        "cloneGraphStoreSnapshot",
        "createFallbackPolicyDescriptor",
        "createGraphId",
        "createGraphIdMap",
        "createGraphStore",
        "extractGraphSchemaKeys",
        "fieldTreeMeta",
        "fieldPolicyFallbackContractVersion",
        "findDuplicateGraphIds",
        "graphWriteScopes",
        "isGraphWriteScope",
        "readDefinitionIconId",
        "resolveFieldPolicyDescriptor",
      ]),
    );

    expect(Object.keys(kernel)).not.toContain("applyIdMap");
    expect(Object.keys(kernel)).not.toContain("authoritativeWriteScopes");
    expect(Object.keys(kernel)).not.toContain("cloneStoreSnapshot");
    expect(Object.keys(kernel)).not.toContain("createIdMap");
    expect(Object.keys(kernel)).not.toContain("createStore");
    expect(Object.keys(kernel)).not.toContain("extractSchemaKeys");
    expect(Object.keys(kernel)).not.toContain("fieldsMeta");
    expect(Object.keys(kernel)).not.toContain("findDuplicateIds");
    expect(Object.keys(kernel)).not.toContain("isAuthoritativeWriteScope");
  });
});
