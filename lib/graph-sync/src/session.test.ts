import { describe, expect, it } from "bun:test";

import { createGraphStore } from "@io/graph-kernel";

import {
  createIncrementalSyncPayload,
  createModuleSyncScope,
  createTotalSyncPayload,
  createTotalSyncSession,
  graphSyncScope,
  GraphSyncValidationError,
} from "./index";

describe("total sync sessions", () => {
  it("preserves requested and delivered module scope state through total apply", () => {
    const server = createGraphStore();
    server.assert("n:1", "p:type", "t:task");
    const requestedScope = {
      kind: "module" as const,
      moduleId: "ops/workflow",
      scopeId: "scope:ops/workflow:review",
    };
    const session = createTotalSyncSession(createGraphStore(), {
      requestedScope,
    });
    const deliveredScope = createModuleSyncScope({
      moduleId: requestedScope.moduleId,
      scopeId: requestedScope.scopeId,
      definitionHash: "scope-def:v1",
      policyFilterVersion: "policy:v1",
    });
    const observedStates: ReturnType<typeof session.getState>[] = [];
    const unsubscribe = session.subscribe((state) => {
      observedStates.push(state);
    });

    const applied = session.apply(
      createTotalSyncPayload(server, {
        scope: deliveredScope,
        cursor: "module:1",
        completeness: "incomplete",
        freshness: "stale",
      }),
    );

    expect(applied).toMatchObject({
      mode: "total",
      scope: deliveredScope,
      cursor: "module:1",
      completeness: "incomplete",
      freshness: "stale",
    });
    expect(session.getState()).toMatchObject({
      requestedScope,
      scope: deliveredScope,
      cursor: "module:1",
      completeness: "incomplete",
      freshness: "stale",
      status: "ready",
    });
    expect(observedStates.at(-1)).toMatchObject({
      requestedScope,
      scope: deliveredScope,
      cursor: "module:1",
      completeness: "incomplete",
      freshness: "stale",
      status: "ready",
    });

    unsubscribe();
  });

  it("records total and incremental activities as payloads are applied", () => {
    const server = createGraphStore();
    server.assert("n:1", "p:type", "t:task");

    const session = createTotalSyncSession(createGraphStore());
    session.apply(
      createTotalSyncPayload(server, {
        cursor: "server:1",
        scope: graphSyncScope,
      }),
    );
    session.apply(
      createIncrementalSyncPayload([], {
        after: "server:1",
        cursor: "server:2",
        scope: graphSyncScope,
      }),
    );

    expect(session.getState().recentActivities).toEqual([
      expect.objectContaining({
        kind: "total",
        cursor: "server:1",
        freshness: "current",
      }),
      expect.objectContaining({
        kind: "incremental",
        after: "server:1",
        cursor: "server:2",
        freshness: "current",
        transactionCount: 0,
        txIds: [],
        writeScopes: [],
      }),
    ]);
  });

  it("rejects incremental scope swaps", () => {
    const server = createGraphStore();
    server.assert("n:1", "p:type", "t:task");
    const session = createTotalSyncSession(createGraphStore());

    session.apply(
      createTotalSyncPayload(server, {
        cursor: "server:1",
        scope: graphSyncScope,
      }),
    );

    const error = (() => {
      try {
        session.apply(
          createIncrementalSyncPayload([], {
            after: "server:1",
            cursor: "server:2",
            scope: createModuleSyncScope({
              moduleId: "ops/workflow",
              scopeId: "scope:review",
              definitionHash: "scope-def:v1",
              policyFilterVersion: "policy:v1",
            }),
          }),
        );
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();

    expect(error).toBeInstanceOf(GraphSyncValidationError);
  });

  it("marks the session stale when pull throws", async () => {
    const session = createTotalSyncSession(createGraphStore());

    await expect(
      session.pull(() => {
        throw new Error("sync failed");
      }),
    ).rejects.toThrow("sync failed");

    expect(session.getState()).toMatchObject({
      status: "error",
      freshness: "stale",
    });
  });
});
