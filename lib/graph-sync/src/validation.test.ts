import { describe, expect, it } from "bun:test";

import { createStore } from "@io/graph-kernel";

import { createModuleSyncScope, graphSyncScope } from "./contracts";
import { createTotalSyncPayload } from "./session";
import {
  createIncrementalSyncFallback,
  createIncrementalSyncPayload,
  prepareTotalSyncPayload,
  validateIncrementalSyncResult,
  validateTotalSyncPayload,
} from "./validation";

describe("sync validation", () => {
  it("accepts module-scoped incremental fallbacks for scope and policy changes", () => {
    const moduleScope = createModuleSyncScope({
      moduleId: "ops/workflow",
      scopeId: "scope:ops/workflow:review",
      definitionHash: "scope-def:v1",
      policyFilterVersion: "policy:v1",
    });

    const incremental = createIncrementalSyncPayload([], {
      after: "module:1",
      cursor: "module:2",
      scope: moduleScope,
      completeness: "incomplete",
      freshness: "stale",
    });

    expect(validateIncrementalSyncResult(incremental)).toMatchObject({
      ok: true,
      phase: "authoritative",
      event: "reconcile",
      value: incremental,
      changedPredicateKeys: [],
    });

    for (const fallback of ["scope-changed", "policy-changed"] as const) {
      const result = createIncrementalSyncFallback(fallback, {
        after: "module:2",
        cursor: "module:3",
        scope: moduleScope,
        completeness: "incomplete",
        freshness: "stale",
      });

      expect(validateIncrementalSyncResult(result)).toMatchObject({
        ok: true,
        phase: "authoritative",
        event: "reconcile",
        value: result,
        changedPredicateKeys: [],
      });
    }
  });

  it("accepts empty incremental payloads that advance the cursor without fallback", () => {
    const result = createIncrementalSyncPayload([], {
      after: "server:1",
      cursor: "server:2",
      freshness: "stale",
    });

    expect(result).toEqual({
      mode: "incremental",
      scope: { kind: "graph" },
      after: "server:1",
      transactions: [],
      cursor: "server:2",
      completeness: "complete",
      freshness: "stale",
    });
    expect(validateIncrementalSyncResult(result)).toMatchObject({
      ok: true,
      phase: "authoritative",
      event: "reconcile",
      value: result,
      changedPredicateKeys: [],
    });
  });

  it("rejects scoped fallback reasons for graph-scoped incremental results", () => {
    const result = validateIncrementalSyncResult(
      createIncrementalSyncFallback("scope-changed", {
        after: "server:1",
        cursor: "server:2",
        scope: graphSyncScope,
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
      changedPredicateKeys: ["$sync:incremental"],
    });
    if (result.ok) throw new Error("Expected graph-scoped scope-changed fallback to fail.");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "sync.incremental.fallbackReason.scope",
        }),
      ]),
    );
  });

  it("requires complete graph-scoped total payloads", () => {
    const result = validateTotalSyncPayload(
      createTotalSyncPayload(createStore(), {
        scope: graphSyncScope,
        completeness: "incomplete",
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "authoritative",
      event: "reconcile",
      changedPredicateKeys: ["$sync:payload"],
    });
    if (result.ok) throw new Error("Expected incomplete graph totals to fail validation.");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "sync.completeness",
        }),
      ]),
    );
  });

  it("allows incomplete module-scoped total payloads", () => {
    const moduleScope = createModuleSyncScope({
      moduleId: "ops/workflow",
      scopeId: "scope:ops/workflow:review",
      definitionHash: "scope-def:v1",
      policyFilterVersion: "policy:v1",
    });

    expect(
      validateTotalSyncPayload(
        createTotalSyncPayload(createStore(), {
          scope: moduleScope,
          completeness: "incomplete",
        }),
      ),
    ).toMatchObject({
      ok: true,
      phase: "authoritative",
      event: "reconcile",
    });
  });

  it("merges preserved snapshot state during total payload preparation", () => {
    const prepared = prepareTotalSyncPayload(
      {
        mode: "total",
        scope: graphSyncScope,
        snapshot: {
          edges: [{ id: "edge:new", s: "n:new", p: "p:type", o: "t:task" }],
          retracted: ["edge:new"],
        },
        cursor: "server:1",
        completeness: "complete",
        freshness: "current",
      },
      {
        preserveSnapshot: {
          edges: [{ id: "edge:old", s: "n:old", p: "p:type", o: "t:task" }],
          retracted: ["edge:old"],
        },
      },
    );

    expect(prepared).toMatchObject({
      ok: true,
    });
    if (!prepared.ok) throw new Error("Expected preserved snapshot merge to succeed.");
    expect(prepared.value.snapshot).toEqual({
      edges: [
        { id: "edge:new", s: "n:new", p: "p:type", o: "t:task" },
        { id: "edge:old", s: "n:old", p: "p:type", o: "t:task" },
      ],
      retracted: ["edge:new", "edge:old"],
    });
  });
});
