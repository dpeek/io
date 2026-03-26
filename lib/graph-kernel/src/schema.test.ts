import { describe, expect, it } from "bun:test";

import { applyIdMap, createIdMap } from "./identity.js";
import {
  createFallbackPolicyDescriptor,
  defineEnum,
  defineScalar,
  defineType,
  edgeId,
  fieldPolicyFallbackContractVersion,
  fieldPolicyDescriptor,
  fieldSecretMetadataVisibility,
  fieldTreeId,
  fieldTreeKey,
  fieldVisibility,
  fieldWritePolicy,
  graphFieldVisibilities,
  graphFieldWritePolicies,
  isEntityType,
  isEnumType,
  isFieldsOutput,
  isGraphFieldVisibility,
  isGraphFieldWritePolicy,
  isScalarType,
  isSecretBackedField,
  rangeOf,
  resolveFieldPolicyDescriptor,
  typeId,
} from "./schema.js";

function defineStringScalar<const Key extends string>(key: Key) {
  return defineScalar<string, Key>({
    values: { key },
    encode: (value) => value,
    decode: (value) => value,
  });
}

function createSchemaFixture() {
  const secretHandle = defineStringScalar("core:secret-handle");
  const text = defineStringScalar("test:string");
  const url = defineStringScalar("test:url");
  const status = defineEnum({
    values: { key: "test:status", name: "Status" },
    options: {
      draft: { name: "Draft" },
      published: { name: "Published" },
    },
  });
  const item = defineType({
    values: { key: "test:item", name: "Item" },
    fields: {
      title: {
        range: text,
        cardinality: "one",
        authority: {
          policy: {
            readAudience: "graph-member",
            writeAudience: "graph-member-edit",
            shareable: true,
            requiredCapabilities: ["item:title:write"],
          },
        },
      },
      website: { range: url, cardinality: "one?" },
      status: { range: status, cardinality: "one" },
      secretNotes: {
        range: secretHandle,
        cardinality: "one?",
        authority: {
          visibility: "authority-only",
          write: "authority-only",
          secret: {
            kind: "sealed-handle",
            metadataVisibility: "replicated",
            revealCapability: "secret:reveal",
            rotateCapability: "secret:rotate",
          },
        },
      },
      details: {
        summary: { range: text, cardinality: "one?" },
      },
    },
  });

  return { secretHandle, text, url, status, item };
}

describe("schema helpers", () => {
  it("publishes the stable field-authority value sets", () => {
    expect(graphFieldVisibilities).toEqual(["replicated", "authority-only"]);
    expect(graphFieldWritePolicies).toEqual(["client-tx", "server-command", "authority-only"]);
    expect(isGraphFieldVisibility("replicated")).toBe(true);
    expect(isGraphFieldVisibility("server-command")).toBe(false);
    expect(isGraphFieldWritePolicy("server-command")).toBe(true);
    expect(isGraphFieldWritePolicy("replicated")).toBe(false);
  });

  it("keeps secret metadata visibility and policy descriptors on the shared schema contract", () => {
    const { item } = createSchemaFixture();

    expect(fieldVisibility(undefined)).toBe("replicated");
    expect(fieldWritePolicy(undefined)).toBe("client-tx");
    expect(fieldSecretMetadataVisibility(undefined)).toBe("replicated");
    expect(isSecretBackedField(undefined)).toBe(false);

    expect(fieldVisibility(item.fields.title)).toBe("replicated");
    expect(fieldWritePolicy(item.fields.title)).toBe("client-tx");
    expect(fieldPolicyDescriptor(item.fields.title)).toEqual({
      predicateId: "test:item:title",
      transportVisibility: "replicated",
      requiredWriteScope: "client-tx",
      readAudience: "graph-member",
      writeAudience: "graph-member-edit",
      shareable: true,
      requiredCapabilities: ["item:title:write"],
    });

    expect(fieldVisibility(item.fields.secretNotes)).toBe("authority-only");
    expect(fieldWritePolicy(item.fields.secretNotes)).toBe("authority-only");
    expect(fieldSecretMetadataVisibility(item.fields.secretNotes)).toBe("replicated");
    expect(isSecretBackedField(item.fields.secretNotes)).toBe(true);
    expect(item.fields.secretNotes.authority.secret).toEqual({
      kind: "sealed-handle",
      metadataVisibility: "replicated",
      revealCapability: "secret:reveal",
      rotateCapability: "secret:rotate",
    });
  });

  it("publishes a stable fallback descriptor contract for predicates without authored policy", () => {
    const { item } = createSchemaFixture();

    expect(fieldPolicyFallbackContractVersion).toBe(0);
    expect(createFallbackPolicyDescriptor(item.fields.website)).toEqual({
      predicateId: "test:item:website",
      transportVisibility: "replicated",
      requiredWriteScope: "client-tx",
      readAudience: "public",
      writeAudience: "graph-member-edit",
      shareable: false,
    });
    expect(resolveFieldPolicyDescriptor(item.fields.title)).toEqual(
      fieldPolicyDescriptor(item.fields.title),
    );
    expect(resolveFieldPolicyDescriptor(item.fields.website)).toEqual({
      predicateId: "test:item:website",
      transportVisibility: "replicated",
      requiredWriteScope: "client-tx",
      readAudience: "public",
      writeAudience: "graph-member-edit",
      shareable: false,
    });
  });

  it("keeps authored keys visible before stable ids are applied", () => {
    const { item, text, status } = createSchemaFixture();
    const scalarRangeLiteral: "test:string" = rangeOf(text);
    const enumRangeLiteral: "test:status" = rangeOf(status);

    expect(isEntityType(item)).toBe(true);
    expect(isScalarType(text)).toBe(true);
    expect(isEnumType(status)).toBe(true);
    expect(isFieldsOutput(item.fields)).toBe(true);
    expect(fieldTreeKey(item.fields.details)).toBe("test:item:details");
    expect(fieldTreeId(item.fields.details)).toBe("test:item:details");
    expect(edgeId(item.fields.title)).toBe("test:item:title");
    expect(typeId(item)).toBe("test:item");
    expect(scalarRangeLiteral).toBe("test:string");
    expect(enumRangeLiteral).toBe("test:status");
  });

  it("resolves type ids, field ids, and field ranges when a namespace is defined", () => {
    const defs = createSchemaFixture();
    const { map } = createIdMap(defs);
    const namespace = applyIdMap(map, defs);
    const scalarRangeLiteral: "test:string" = rangeOf(namespace.text);
    const enumRangeLiteral: "test:status" = rangeOf(namespace.status);

    expect(typeId(namespace.item)).toBe(namespace.item.values.id);
    expect(fieldTreeId(namespace.item.fields.details)).not.toBe(
      fieldTreeKey(namespace.item.fields.details),
    );
    expect(edgeId(namespace.item.fields.title)).toBe(namespace.item.fields.title.id);
    expect(namespace.item.fields.title.range as string).toBe(namespace.text.values.id);
    expect(namespace.item.fields.website.range as string).toBe(namespace.url.values.id);
    expect(namespace.item.fields.status.range as string).toBe(namespace.status.values.id);
    expect(namespace.item.fields.secretNotes.range as string).toBe(
      namespace.secretHandle.values.id,
    );
    expect(namespace.status.values.draft.key).toBe("test:status.draft");
    expect(namespace.status.values.published.id).toBe(namespace.status.options.published.id);
    expect(namespace.status.values.draft.id).not.toBe(namespace.status.values.published.id);
    expect(scalarRangeLiteral as string).toBe(namespace.text.values.id);
    expect(enumRangeLiteral as string).toBe(namespace.status.values.id);
  });
});
