import { isSecretBackedField } from "@io/graph-kernel";

import {
  defineEnum,
  defineReferenceField,
  defineScalar,
  defineScalarModule,
  defineSecretField,
  defineType,
  existingEntityReferenceField,
  type GraphSecretFieldAuthority,
} from "./def.js";
import { core } from "./modules/core.js";
import { booleanTypeModule } from "./modules/core/boolean/index.js";
import { defineDefaultEnumTypeModule } from "./modules/core/enum-module.js";
import { stringTypeModule } from "./modules/core/string/index.js";

const probeStringType = defineScalar({
  values: { key: "probe:string", name: "Probe String" },
  encode: (value: string) => value,
  decode: (raw) => raw,
});

const probeEntityType = defineType({
  values: { key: "probe:entity", name: "Probe Entity" },
  fields: {},
});

const probeStatusType = defineEnum({
  values: { key: "probe:status", name: "Probe Status" },
  options: {
    active: { name: "Active" },
    paused: { name: "Paused" },
  },
});

const probeStatusTypeModule = defineDefaultEnumTypeModule(probeStatusType);

void defineReferenceField({
  range: probeEntityType,
  cardinality: "many",
});

void existingEntityReferenceField(probeEntityType, {
  cardinality: "many",
  label: "Related entities",
});

void existingEntityReferenceField(probeEntityType, {
  cardinality: "many",
  collection: "unordered",
  create: true,
  editorKind: "entity-reference-combobox",
  label: "Searchable related entities",
});

const secretField = defineSecretField({
  range: core.secretHandle,
  cardinality: "one?",
  revealCapability: "secret:reveal",
  rotateCapability: "secret:rotate",
});

void (secretField.authority.secret satisfies GraphSecretFieldAuthority);

if (isSecretBackedField(secretField)) {
  void (secretField.authority.secret satisfies GraphSecretFieldAuthority);
  void secretField.authority.secret.revealCapability;
  void secretField.authority.secret.rotateCapability;

  // @ts-expect-error transport details stay out of the shared secret-field authority contract
  void secretField.authority.secret.command;
}

void stringTypeModule.field({
  cardinality: "one",
  authority: {
    visibility: "authority-only",
    write: "authority-only",
  },
  meta: {
    editor: {
      kind: "textarea",
      multiline: true,
    },
  },
});

void stringTypeModule.field({
  cardinality: "one",
  meta: {
    editor: {
      // @ts-expect-error string fields cannot switch to an unrelated editor kind
      kind: "checkbox",
    },
  },
});

void stringTypeModule.field({
  cardinality: "one",
  filter: {
    // @ts-expect-error string fields cannot narrow to unknown filter operators
    operators: ["gt"] as const,
  },
});

void probeStatusTypeModule.field({
  cardinality: "one",
  filter: {
    operators: ["is"] as const,
    // @ts-expect-error the chosen default operator must belong to the narrowed operator set
    defaultOperator: "oneOf",
  },
});

void booleanTypeModule.field({
  cardinality: "one?",
  meta: {
    editor: {
      kind: "switch",
    },
  },
});

void booleanTypeModule.field({
  cardinality: "one?",
  meta: {
    editor: {
      // @ts-expect-error boolean fields cannot switch to text editing semantics
      kind: "text",
    },
  },
});

void defineScalarModule({
  type: probeStringType,
  meta: {
    summary: {
      kind: "value",
      // @ts-expect-error scalar metadata formatters must align with the decoded scalar value type
      format: (value: number) => String(value),
    },
    display: {
      kind: "text",
      allowed: ["text"] as const,
      format: (value: string) => value,
    },
    editor: {
      kind: "text",
      allowed: ["text"] as const,
    },
  },
  filter: {
    defaultOperator: "equals",
    operators: {
      equals: {
        label: "Equals",
        operand: {
          kind: "string",
        },
        parse: (raw: string) => raw,
        format: (operand: string) => operand,
        test: (value: string, operand: string) => value === operand,
      },
    },
  },
});
