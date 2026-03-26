import { describe, expect, it } from "bun:test";

import * as graphClient from "./index.js";

describe("graph-client package surface", () => {
  it("publishes graph-prefixed client factories and synced graph helpers", () => {
    expect(Object.keys(graphClient)).toEqual(
      expect.arrayContaining([
        "createEntityWithId",
        "createGraphClient",
        "createHttpGraphClient",
        "createHttpGraphTxIdFactory",
        "createSyncedGraphClient",
        "GraphSyncWriteError",
        "GraphValidationError",
        "validateGraphStore",
      ]),
    );

    expect(Object.keys(graphClient)).not.toContain("createSyncedTypeClient");
    expect(Object.keys(graphClient)).not.toContain("createTypeClient");
    expect(Object.keys(graphClient)).not.toContain("createBootstrappedSnapshot");
  });
});
