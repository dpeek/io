import { describe, expect, it } from "bun:test";

const requiredExports = [
  "authorizeCommand",
  "authorizeRead",
  "authorizeWrite",
  "createAuthoritativeGraphWriteResultValidator",
  "createAuthoritativeGraphWriteSession",
  "createAuthoritativeTotalSyncPayload",
  "createAuthoritativeTotalSyncValidator",
  "createJsonPersistedAuthoritativeGraph",
  "createJsonPersistedAuthoritativeGraphStorage",
  "createPersistedAuthoritativeGraph",
  "defineAdmissionPolicy",
  "defineShareGrant",
  "defineShareSurface",
  "defineWebPrincipalBootstrapPayload",
  "persistedAuthoritativeGraphStateVersion",
  "validateAuthoritativeGraphWriteResult",
  "validateAuthoritativeGraphWriteTransaction",
  "validateAuthoritativeTotalSyncPayload",
  "validateShareGrant",
  "validateShareSurface",
] as const;

const forbiddenExports = [
  "createGraphClient",
  "createSyncedGraphClient",
  "createGraphStore",
  "GraphCommandSpec",
  "createModuleReadScope",
  "ObjectViewSpec",
  "WorkflowSpec",
] as const;

describe("@io/graph-authority", () => {
  it("keeps the package surface focused on authority-owned runtime behavior", async () => {
    const authorityExports = await import("@io/graph-authority");

    expect(Object.keys(authorityExports)).toEqual(expect.arrayContaining([...requiredExports]));
    for (const name of forbiddenExports) {
      expect(Object.keys(authorityExports)).not.toContain(name);
    }
  });
});
