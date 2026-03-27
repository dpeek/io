import { describe, expect, it } from "bun:test";

import {
  createWebAppPolicyContractFingerprint,
  createWebAppPolicyContractSnapshot,
  deriveWebAppPolicyVersion,
  hashWebAppPolicyContractFingerprint,
  webAppPolicyContractFingerprint,
  webAppPolicyVersion,
} from "./policy-version.js";

describe("policy version contract snapshot", () => {
  it("keeps the current compiled snapshot at version zero", () => {
    const snapshot = createWebAppPolicyContractSnapshot();
    const baselineHash = hashWebAppPolicyContractFingerprint(webAppPolicyContractFingerprint);

    expect(deriveWebAppPolicyVersion(snapshot, baselineHash)).toBe(0);
    expect(webAppPolicyVersion).toBe(0);
  });

  it("changes when an authored predicate policy changes", () => {
    const snapshot = createWebAppPolicyContractSnapshot();
    const baselineHash = hashWebAppPolicyContractFingerprint(
      createWebAppPolicyContractFingerprint(snapshot),
    );
    const firstDescriptor = snapshot.descriptors[0];
    if (!firstDescriptor) {
      throw new Error("Expected at least one policy descriptor in the web app graph.");
    }
    const changedSnapshot = {
      ...snapshot,
      descriptors: [
        {
          ...firstDescriptor,
          shareable: !firstDescriptor.shareable,
        },
        ...snapshot.descriptors.slice(1),
      ],
    };

    expect(deriveWebAppPolicyVersion(changedSnapshot, baselineHash)).not.toBe(0);
  });

  it("changes when the share-surface contract epoch changes", () => {
    const snapshot = createWebAppPolicyContractSnapshot();
    const baselineHash = hashWebAppPolicyContractFingerprint(
      createWebAppPolicyContractFingerprint(snapshot),
    );
    const changedSnapshot = {
      ...snapshot,
      shareSurfaceVersion: snapshot.shareSurfaceVersion + 1,
    };

    expect(deriveWebAppPolicyVersion(changedSnapshot, baselineHash)).not.toBe(0);
  });

  it("changes when the fallback-policy contract epoch changes", () => {
    const snapshot = createWebAppPolicyContractSnapshot();
    const baselineHash = hashWebAppPolicyContractFingerprint(
      createWebAppPolicyContractFingerprint(snapshot),
    );
    const changedSnapshot = {
      ...snapshot,
      fallbackDescriptorVersion: snapshot.fallbackDescriptorVersion + 1,
    };

    expect(deriveWebAppPolicyVersion(changedSnapshot, baselineHash)).not.toBe(0);
  });

  it("changes when the authority policy-evaluator epoch changes", () => {
    const snapshot = createWebAppPolicyContractSnapshot();
    const baselineHash = hashWebAppPolicyContractFingerprint(
      createWebAppPolicyContractFingerprint(snapshot),
    );
    const changedSnapshot = {
      ...snapshot,
      evaluatorVersion: snapshot.evaluatorVersion + 1,
    };

    expect(deriveWebAppPolicyVersion(changedSnapshot, baselineHash)).not.toBe(0);
  });
});
