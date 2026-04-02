import { describe, expect, it } from "bun:test";

import {
  isIncrementalSyncFallbackReason,
  isModuleSyncScopeFallbackReason,
  moduleSyncScopeFallbackReasons,
} from "./contracts.js";

describe("graph sync fallback contracts", () => {
  it("exports the shared named-scope fallback vocabulary", () => {
    expect(moduleSyncScopeFallbackReasons).toEqual(["scope-changed", "policy-changed"]);
    expect(isModuleSyncScopeFallbackReason("scope-changed")).toBe(true);
    expect(isModuleSyncScopeFallbackReason("policy-changed")).toBe(true);
    expect(isModuleSyncScopeFallbackReason("gap")).toBe(false);
    expect(
      moduleSyncScopeFallbackReasons.every((reason) => isIncrementalSyncFallbackReason(reason)),
    ).toBe(true);
  });
});
