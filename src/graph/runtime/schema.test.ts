import { describe, expect, it } from "bun:test";

import { core } from "./core.js";
import {
  fieldSecretMetadataVisibility,
  fieldVisibility,
  fieldWritePolicy,
  graphFieldVisibilities,
  graphFieldWritePolicies,
  isGraphFieldVisibility,
  isGraphFieldWritePolicy,
  isSecretBackedField,
} from "./schema.js";
import { defineSecretField } from "./type-module.js";

const replicatedSecretField = defineSecretField({
  range: core.secretHandle,
  cardinality: "one?",
});

const hiddenSecretField = defineSecretField({
  range: core.secretHandle,
  cardinality: "one?",
  authority: {
    visibility: "authority-only",
    write: "authority-only",
  },
});

const explicitSecretMetadataField = defineSecretField({
  range: core.secretHandle,
  cardinality: "one?",
  authority: {
    visibility: "authority-only",
  },
  metadataVisibility: "replicated",
  revealCapability: "secret:reveal",
  rotateCapability: "secret:rotate",
});

describe("graph field authority contract", () => {
  it("publishes the stable shared field-authority value sets", () => {
    expect(graphFieldVisibilities).toEqual(["replicated", "authority-only"]);
    expect(graphFieldWritePolicies).toEqual(["client-tx", "server-command", "authority-only"]);
    expect(isGraphFieldVisibility("replicated")).toBe(true);
    expect(isGraphFieldVisibility("server-command")).toBe(false);
    expect(isGraphFieldWritePolicy("server-command")).toBe(true);
    expect(isGraphFieldWritePolicy("replicated")).toBe(false);
  });

  it("keeps secret metadata visibility on the shared schema contract", () => {
    expect(fieldVisibility(undefined)).toBe("replicated");
    expect(fieldWritePolicy(undefined)).toBe("client-tx");
    expect(fieldSecretMetadataVisibility(undefined)).toBe("replicated");
    expect(isSecretBackedField(undefined)).toBe(false);

    expect(fieldVisibility(replicatedSecretField)).toBe("replicated");
    expect(fieldWritePolicy(replicatedSecretField)).toBe("server-command");
    expect(fieldSecretMetadataVisibility(replicatedSecretField)).toBe("replicated");
    expect(isSecretBackedField(replicatedSecretField)).toBe(true);

    expect(fieldVisibility(hiddenSecretField)).toBe("authority-only");
    expect(fieldWritePolicy(hiddenSecretField)).toBe("authority-only");
    expect(fieldSecretMetadataVisibility(hiddenSecretField)).toBe("authority-only");

    expect(fieldVisibility(explicitSecretMetadataField)).toBe("authority-only");
    expect(fieldWritePolicy(explicitSecretMetadataField)).toBe("server-command");
    expect(fieldSecretMetadataVisibility(explicitSecretMetadataField)).toBe("replicated");
    expect(explicitSecretMetadataField.authority.secret).toEqual({
      kind: "sealed-handle",
      metadataVisibility: "replicated",
      revealCapability: "secret:reveal",
      rotateCapability: "secret:rotate",
    });
  });
});
