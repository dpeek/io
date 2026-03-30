import { describe, expect, it } from "bun:test";

import {
  createDefaultLocalhostSyntheticIdentity,
  createLocalhostBootstrapToken,
  createLocalhostSyntheticEmail,
  defineLocalhostBootstrapCredential,
  defineLocalhostSyntheticIdentity,
  isLocalhostBootstrapToken,
  isLocalhostOrigin,
  localhostBootstrapCredentialMaxTtlMs,
} from "./local-bootstrap.js";

describe("localhost bootstrap contract", () => {
  it("defines the localhost bootstrap credential and synthetic local identity", () => {
    const credential = defineLocalhostBootstrapCredential({
      kind: "localhost-bootstrap",
      availability: "localhost-only",
      token: "io_local_bootstrap_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      issuedAt: "2026-03-30T00:00:00.000Z",
      expiresAt: "2026-03-30T00:05:00.000Z",
      redeemOrigin: "http://io.localhost:8787",
      oneTimeUse: true,
      syntheticIdentity: defineLocalhostSyntheticIdentity({
        localIdentityId: "local:default",
        email: createLocalhostSyntheticEmail("local:default"),
        displayName: "Local Operator",
      }),
    });

    expect(credential).toEqual({
      kind: "localhost-bootstrap",
      availability: "localhost-only",
      token: "io_local_bootstrap_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      issuedAt: "2026-03-30T00:00:00.000Z",
      expiresAt: "2026-03-30T00:05:00.000Z",
      redeemOrigin: "http://io.localhost:8787",
      oneTimeUse: true,
      syntheticIdentity: {
        localIdentityId: "local:default",
        email: "local+default@localhost.invalid",
        displayName: "Local Operator",
      },
    });
    expect(Object.isFrozen(credential)).toBe(true);
    expect(Object.isFrozen(credential.syntheticIdentity)).toBe(true);
  });

  it("creates the default deterministic synthetic local identity", () => {
    expect(createDefaultLocalhostSyntheticIdentity()).toEqual({
      localIdentityId: "local:default",
      email: "local+default@localhost.invalid",
      displayName: "Local Operator",
    });
  });

  it("accepts the supported localhost origin forms", () => {
    expect(isLocalhostOrigin("http://localhost:8787")).toBe(true);
    expect(isLocalhostOrigin("http://io.localhost:8787")).toBe(true);
    expect(isLocalhostOrigin("http://127.0.0.1:8787")).toBe(true);
    expect(isLocalhostOrigin("http://[::1]:8787")).toBe(true);
    expect(isLocalhostOrigin("https://example.com")).toBe(false);
  });

  it("rejects credentials that outlive the localhost bootstrap TTL", () => {
    expect(() =>
      defineLocalhostBootstrapCredential({
        kind: "localhost-bootstrap",
        availability: "localhost-only",
        token:
          "io_local_bootstrap_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        issuedAt: "2026-03-30T00:00:00.000Z",
        expiresAt: new Date(
          Date.parse("2026-03-30T00:00:00.000Z") + localhostBootstrapCredentialMaxTtlMs + 1,
        ).toISOString(),
        redeemOrigin: "http://localhost:8787",
        oneTimeUse: true,
        syntheticIdentity: {
          localIdentityId: "local:default",
          email: "local+default@localhost.invalid",
          displayName: "Local Operator",
        },
      }),
    ).toThrow(`expiresAt must be within ${localhostBootstrapCredentialMaxTtlMs}ms of issuedAt.`);
  });

  it("rejects synthetic identities that do not use the deterministic local email", () => {
    expect(() =>
      defineLocalhostSyntheticIdentity({
        localIdentityId: "local:default",
        email: "operator@example.com",
        displayName: "Local Operator",
      }),
    ).toThrow(
      'email must match the synthetic local identity email "local+default@localhost.invalid".',
    );
  });

  it("recognizes the issued localhost bootstrap token format", () => {
    expect(
      isLocalhostBootstrapToken(
        "io_local_bootstrap_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      ),
    ).toBe(true);
    expect(isLocalhostBootstrapToken("io_local_bootstrap_NOT_HEX")).toBe(false);
  });

  it("issues new bootstrap tokens in the shared opaque token format", () => {
    expect(isLocalhostBootstrapToken(createLocalhostBootstrapToken())).toBe(true);
  });
});
