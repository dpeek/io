import { describe, expect, it } from "bun:test";

import {
  fieldSecretMetadataVisibility,
  fieldVisibility,
  fieldWritePolicy,
  isSecretBackedField,
} from "@io/graph-kernel";

import {
  defineGraphModuleManifest,
  defineDefaultEnumTypeModule,
  defineEnum,
  defineType,
  defineSecretField,
  defineValidatedStringTypeModule,
  existingEntityReferenceField,
  existingEntityReferenceFieldMeta,
  readDefinitionIconId,
} from "./index.js";
import {
  defineModuleQuerySurfaceCatalog,
  defineModuleQuerySurfaceSpec,
  defineModuleReadScopeDefinition,
} from "@io/graph-projection";

const secretHandle = defineType({
  values: { key: "probe:secretHandle", name: "Secret Handle" },
  fields: {},
});

const status = defineEnum({
  values: { key: "probe:status", name: "Status" },
  options: {
    draft: { name: "Draft" },
    published: { name: "Published" },
  },
});

const statusTypeModule = defineDefaultEnumTypeModule(status);

const emailTypeModule = defineValidatedStringTypeModule({
  values: { key: "probe:email", name: "Email" },
  parse: (raw: string) => raw.trim().toLowerCase(),
  filter: {
    defaultOperator: "equals",
    operators: {
      equals: {
        label: "Equals",
        operand: {
          kind: "string",
          placeholder: "team@example.com",
        },
        parse: (raw: string) => raw.trim().toLowerCase(),
        format: (operand: string) => operand,
        test: (value: string, operand: string) => value === operand,
      },
      domain: {
        label: "Domain",
        operand: {
          kind: "string",
          placeholder: "example.com",
        },
        parse: (raw: string) => raw.trim().toLowerCase(),
        format: (operand: string) => operand,
        test: (value: string, operand: string) => value.endsWith(`@${operand}`),
      },
    },
  },
  placeholder: "team@example.com",
  inputType: "email",
  inputMode: "email",
  autocomplete: "email",
});

const replicatedSecretField = defineSecretField({
  range: secretHandle,
  cardinality: "one?",
});

const hiddenSecretField = defineSecretField({
  range: secretHandle,
  cardinality: "one?",
  authority: {
    visibility: "authority-only",
    write: "authority-only",
  },
});

const explicitSecretMetadataField = defineSecretField({
  range: secretHandle,
  cardinality: "one?",
  authority: {
    visibility: "authority-only",
  },
  metadataVisibility: "replicated",
  revealCapability: "secret:reveal",
  rotateCapability: "secret:rotate",
});

describe("@io/graph-module", () => {
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

  it("authors existing-entity reference policies as reusable field metadata", () => {
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

    const field = existingEntityReferenceField(secretHandle, {
      cardinality: "many",
      label: "Related nodes",
      create: true,
    });

    expect(field.range).toBe(secretHandle);
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

  it("ships generic enum-module defaults outside the built-in core module tree", () => {
    const field = statusTypeModule.field({
      cardinality: "one",
      meta: {
        display: {
          kind: "badge",
        },
      },
      filter: {
        operators: ["is"] as const,
      },
    });

    expect(statusTypeModule.type).toBe(status);
    expect(field.meta.display.kind).toBe("badge");
    expect(field.meta.editor.kind).toBe("select");
    expect(field.filter.defaultOperator).toBe("is");
    expect(Object.keys(field.filter.operators)).toEqual(["is"]);
  });

  it("ships generic validated-string helpers outside the built-in core module tree", () => {
    const field = emailTypeModule.field({
      cardinality: "one",
      filter: {
        operators: ["equals"] as const,
      },
    });

    expect(emailTypeModule.type.values.key).toBe("probe:email");
    expect(field.meta.editor.inputType).toBe("email");
    expect(field.meta.editor.inputMode).toBe("email");
    expect(field.meta.editor.autocomplete).toBe("email");
    expect(field.meta.editor.parse?.(" TEAM@ACME.COM ")).toBe("team@acme.com");
    expect(field.filter.defaultOperator).toBe("equals");
    expect(Object.keys(field.filter.operators)).toEqual(["equals"]);
  });

  it("re-exports icon-ref reading for definition-time callers", () => {
    expect(readDefinitionIconId("seed:icon:domain")).toBe("seed:icon:domain");
    expect(readDefinitionIconId({ id: "seed:icon:domain" })).toBe("seed:icon:domain");
    expect(readDefinitionIconId({ id: "" })).toBeUndefined();
    expect(readDefinitionIconId(undefined)).toBeUndefined();
  });

  it("defines built-in and local module manifests through one shared contract", () => {
    const probeScope = defineModuleReadScopeDefinition({
      kind: "module",
      moduleId: "probe.local",
      scopeId: "scope:probe:local",
      definitionHash: "scope-def:probe:local:v1",
    });

    const probeCatalog = defineModuleQuerySurfaceCatalog({
      catalogId: "probe.local:query-surfaces",
      catalogVersion: "query-catalog:probe.local:v1",
      moduleId: "probe.local",
      surfaces: [
        defineModuleQuerySurfaceSpec({
          surfaceId: probeScope.scopeId,
          surfaceVersion: "query-surface:probe.local:scope:v1",
          label: "Probe Scope",
          queryKind: "scope",
          source: {
            kind: "scope",
            scopeId: probeScope.scopeId,
          },
        }),
      ],
    });

    const localManifest = defineGraphModuleManifest({
      moduleId: "probe.local",
      version: "0.0.1",
      source: {
        kind: "local",
        specifier: "./modules/probe-local.ts",
        exportName: "manifest",
      },
      compatibility: {
        graph: "graph-schema:v1",
        runtime: "graph-runtime:v1",
      },
      runtime: {
        schemas: [
          {
            key: "probe.local",
            namespace: {
              status,
            },
          },
        ],
        commands: [
          {
            key: "probe.local:save",
            label: "Save probe",
            execution: "serverOnly",
            input: undefined,
            output: undefined,
          },
        ],
        readScopes: [probeScope],
        querySurfaceCatalogs: [probeCatalog],
        activationHooks: [
          {
            key: "probe.local.activate",
            stage: "activate",
          },
        ],
      },
    });

    const builtInManifest = defineGraphModuleManifest({
      moduleId: "probe.builtin",
      version: "0.0.1",
      source: {
        kind: "built-in",
        specifier: "@io/probe-module",
        exportName: "probeManifest",
      },
      compatibility: {
        graph: "graph-schema:v1",
        runtime: "graph-runtime:v1",
      },
      runtime: {
        schemas: [
          {
            key: "probe.builtin",
            namespace: {
              secretHandle,
            },
          },
        ],
      },
    });

    expect(localManifest).toMatchObject({
      moduleId: "probe.local",
      source: {
        kind: "local",
        specifier: "./modules/probe-local.ts",
        exportName: "manifest",
      },
      runtime: {
        readScopes: [probeScope],
        querySurfaceCatalogs: [probeCatalog],
      },
    });
    expect(builtInManifest).toMatchObject({
      moduleId: "probe.builtin",
      source: {
        kind: "built-in",
        specifier: "@io/probe-module",
        exportName: "probeManifest",
      },
    });
    expect(Object.isFrozen(localManifest.runtime.readScopes!)).toBe(true);
    expect(Object.isFrozen(localManifest.runtime.querySurfaceCatalogs!)).toBe(true);
  });

  it("fails closed when manifests are incomplete or internally inconsistent", () => {
    expect(() =>
      defineGraphModuleManifest({
        moduleId: "probe.empty",
        version: "0.0.1",
        source: {
          kind: "local",
          specifier: "./modules/probe-empty.ts",
          exportName: "manifest",
        },
        compatibility: {
          graph: "graph-schema:v1",
          runtime: "graph-runtime:v1",
        },
        runtime: {},
      }),
    ).toThrow("runtime must declare at least one contribution.");

    expect(() =>
      defineGraphModuleManifest({
        moduleId: "probe.local",
        version: "0.0.1",
        source: {
          kind: "local",
          specifier: "./modules/probe-local.ts",
          exportName: "manifest",
        },
        compatibility: {
          graph: "graph-schema:v1",
          runtime: "graph-runtime:v1",
        },
        runtime: {
          readScopes: [
            defineModuleReadScopeDefinition({
              kind: "module",
              moduleId: "probe.other",
              scopeId: "scope:probe:other",
              definitionHash: "scope-def:probe:other:v1",
            }),
          ],
        },
      }),
    ).toThrow('runtime.readScopes "scope:probe:other" must use moduleId "probe.local".');
  });
});
