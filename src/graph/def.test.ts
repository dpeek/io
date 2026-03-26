import { describe, expect, it } from "bun:test";

import {
  fieldSecretMetadataVisibility,
  fieldVisibility,
  fieldWritePolicy,
  isSecretBackedField,
} from "@io/graph-kernel";

import {
  defineSecretField,
  existingEntityReferenceField,
  existingEntityReferenceFieldMeta,
  readDefinitionIconId,
} from "./def.js";
import { core } from "./modules/core.js";

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

describe("root graph definition helpers", () => {
  it("authors secret-backed fields without reimplementing kernel authority rules", () => {
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

  it("keeps entity-reference policy helpers on the root definition surface", () => {
    expect(
      existingEntityReferenceFieldMeta({
        label: "Related items",
        create: true,
        excludeSubject: true,
        editorKind: "entity-reference-combobox",
        collection: "unordered",
      }),
    ).toEqual({
      label: "Related items",
      reference: {
        selection: "existing-only",
        create: true,
        excludeSubject: true,
      },
      editor: {
        kind: "entity-reference-combobox",
      },
      collection: {
        kind: "unordered",
      },
    });

    const field = existingEntityReferenceField(core.node, {
      cardinality: "many",
      label: "Related nodes",
      create: true,
    });

    expect(field.range).toBe(core.node);
    expect(field).toMatchObject({
      cardinality: "many",
      meta: {
        label: "Related nodes",
        reference: {
          selection: "existing-only",
          create: true,
        },
      },
    });
  });

  it("re-exports icon-ref reading for definition-time callers", () => {
    expect(readDefinitionIconId("seed:icon:domain")).toBe("seed:icon:domain");
    expect(readDefinitionIconId({ id: "seed:icon:domain" })).toBe("seed:icon:domain");
    expect(readDefinitionIconId({ id: "" })).toBeUndefined();
    expect(readDefinitionIconId(undefined)).toBeUndefined();
  });
});
