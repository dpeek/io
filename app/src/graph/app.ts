import {
  addressFields,
  booleanTypeModule,
  core,
  defineNamespace,
  defineReferenceField,
  defineType,
  emailTypeModule,
  existingEntityReferenceField,
  numberTypeModule,
  slugTypeModule,
  stringTypeModule,
  urlTypeModule,
} from "@io/graph";

import { statusTypeModule } from "../type/status/index.js";
import ids from "./app.json";

export const status = statusTypeModule.type;

export const company = defineType({
  values: { key: "app:company", name: "Company" },
  fields: {
    ...core.node.fields,
    address: {
      ...addressFields,
    },
    status: statusTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Status",
        display: {
          kind: "badge",
        },
      },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    foundedYear: numberTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Founded year",
      },
      filter: {
        operators: ["equals", "gt", "lt"] as const,
        defaultOperator: "equals",
      },
    }),
    tags: stringTypeModule.field({
      cardinality: "many",
      meta: {
        label: "Tags",
        collection: {
          kind: "unordered",
        },
        editor: {
          kind: "token-list",
        },
      },
      filter: {
        operators: ["contains", "equals"] as const,
        defaultOperator: "contains",
      },
    }),
    website: urlTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Website",
        display: {
          kind: "external-link",
        },
      },
    }),
    contactEmail: emailTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Contact email",
      },
      filter: {
        operators: ["equals", "domain"] as const,
        defaultOperator: "domain",
      },
    }),
    slug: slugTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Slug",
      },
    }),
  },
});

export const person = defineType({
  values: { key: "app:person", name: "Person" },
  fields: {
    ...core.node.fields,
    worksAt: existingEntityReferenceField(company, {
      cardinality: "many",
      label: "Works at",
    }),
  },
});

export const block = defineType({
  values: { key: "app:block", name: "Outline Node" },
  fields: {
    ...core.node.fields,
    text: stringTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Text",
        editor: {
          kind: "textarea",
          multiline: true,
        },
      },
      filter: {
        operators: ["contains", "prefix"] as const,
        defaultOperator: "contains",
      },
    }),
    parent: defineReferenceField({
      range: "app:block",
      cardinality: "one?",
    }),
    order: numberTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Order",
      },
    }),
    collapsed: booleanTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Collapsed",
      },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
  },
});

export const app = defineNamespace(ids, { company, person, status, block });
