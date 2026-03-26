import { describe, expect, it } from "bun:test";

import { graphSyncScope } from "@io/graph-sync";

import { applyHttpSyncRequest, readHttpSyncRequest } from "./http-sync-request";

describe("http sync request transport", () => {
  it("writes explicit graph scope requests", () => {
    const url = new URL("http://io.localhost:1355/api/sync");

    applyHttpSyncRequest(url, {
      after: "graph:1",
      scope: graphSyncScope,
    });

    expect(url.toString()).toBe(
      "http://io.localhost:1355/api/sync?after=graph%3A1&scopeKind=graph",
    );
  });

  it("writes module scope requests with module identity", () => {
    const url = new URL("http://io.localhost:1355/api/sync");

    applyHttpSyncRequest(url, {
      after: "scope:1",
      scope: {
        kind: "module",
        moduleId: "ops/workflow",
        scopeId: "scope:ops/workflow:review",
      },
    });

    expect(url.toString()).toBe(
      "http://io.localhost:1355/api/sync?after=scope%3A1&scopeKind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview",
    );
  });

  it("reads explicit graph scope requests", () => {
    expect(
      readHttpSyncRequest("http://io.localhost:1355/api/sync?after=graph%3A1&scopeKind=graph"),
    ).toEqual({
      after: "graph:1",
      scope: graphSyncScope,
    });
  });

  it("reads module scope requests", () => {
    expect(
      readHttpSyncRequest(
        "http://io.localhost:1355/api/sync?after=scope%3A1&scopeKind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview",
      ),
    ).toEqual({
      after: "scope:1",
      scope: {
        kind: "module",
        moduleId: "ops/workflow",
        scopeId: "scope:ops/workflow:review",
      },
    });
  });
});
