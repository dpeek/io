import { booleanTypeModule } from "../type/boolean/index.js";
import { defineDefaultEnumTypeModule } from "../type/enum-module.js";
import { numberTypeModule } from "../type/number/index.js";
import { slugTypeModule } from "../type/slug.js";
import { stringTypeModule } from "../type/string/index.js";
import coreIdMap from "./core.json";
import { defineEnum, defineNamespace, defineType } from "./schema.js";
import { defineReferenceField } from "./type-module.js";
import { dateTypeModule } from "../schema/core/date/index.js";
import { emailTypeModule } from "../schema/core/email/index.js";
import { urlTypeModule } from "../schema/core/url/index.js";

const string = stringTypeModule.type;

const number = numberTypeModule.type;

const date = dateTypeModule.type;

const boolean = booleanTypeModule.type;

const url = urlTypeModule.type;

const email = emailTypeModule.type;

const slug = slugTypeModule.type;

const node = defineType({
  values: { key: "core:node", name: "Node" },
  fields: {
    type: defineReferenceField({
      range: "core:type",
      cardinality: "many",
    }),
    name: stringTypeModule.field({
      cardinality: "one",
      validate: ({ value }) =>
        typeof value === "string" && value.trim().length > 0
          ? undefined
          : {
              code: "string.blank",
              message: "Name must not be blank.",
            },
      meta: {
        label: "Name",
      },
    }),
    label: stringTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Label",
      },
    }),
    description: stringTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Description",
        editor: {
          kind: "textarea",
          multiline: true,
        },
      },
      filter: {
        operators: ["contains", "equals"] as const,
        defaultOperator: "contains",
      },
    }),
    createdAt: dateTypeModule.field({
      cardinality: "one?",
      onCreate: ({ incoming, now }) => incoming ?? now,
    }),
    updatedAt: dateTypeModule.field({
      cardinality: "one?",
      onCreate: ({ now }) => now,
      onUpdate: ({ now, changedPredicateKeys }) =>
        [...changedPredicateKeys].some(
          (key) => !key.endsWith(":createdAt") && !key.endsWith(":updatedAt"),
        )
          ? now
          : undefined,
    }),
  },
});

const type = defineType({
  values: { key: "core:type", name: "Type" },
  fields: {
    ...node.fields,
  },
});

const cardinality = defineEnum({
  values: { key: "core:cardinality", name: "Cardinality" },
  options: {
    one: {
      name: "Exactly one",
      description: "Predicate must have exactly one value",
    },
    oneOptional: {
      name: "Zero or one",
      description: "Predicate may have zero or one value",
    },
    many: {
      name: "Many",
      description: "Predicate may have multiple values",
    },
  },
});

const cardinalityTypeModule = defineDefaultEnumTypeModule(cardinality);

const predicate = defineType({
  values: { key: "core:predicate", name: "Predicate" },
  fields: {
    ...node.fields,
    key: stringTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Key",
      },
      filter: {
        operators: ["equals", "prefix"] as const,
        defaultOperator: "equals",
      },
    }),
    range: defineReferenceField({
      range: type.values.key,
      cardinality: "one?",
    }),
    cardinality: cardinalityTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Cardinality",
      },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
  },
});

const _enum = defineType({
  values: { key: "core:enum", name: "Enum" },
  fields: {
    ...node.fields,
    member: defineReferenceField({
      range: type.values.key,
      cardinality: "many",
    }),
  },
});

export const core = defineNamespace(coreIdMap, {
  string,
  number,
  date,
  boolean,
  url,
  email,
  slug,
  type,
  cardinality,
  predicate,
  enum: _enum,
  node,
});
