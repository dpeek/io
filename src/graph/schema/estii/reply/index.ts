import { defineType } from "@io/core/graph/def";

import { core } from "../../core.js";
import { numberTypeModule } from "../../core/number/index.js";
import { stringTypeModule } from "../../core/string/index.js";
import { estiiReferenceField } from "../reference-field.js";

export const reply = defineType({
  values: { key: "estii:reply", name: "Reply" },
  fields: {
    ...core.node.fields,
    order: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Order" },
    }),
    contents: stringTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Contents",
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
    author: estiiReferenceField("estii:person", {
      cardinality: "one",
      label: "Author",
    }),
    mentions: estiiReferenceField("estii:person", {
      cardinality: "many",
      collection: "unordered",
      label: "Mentions",
    }),
  },
});
