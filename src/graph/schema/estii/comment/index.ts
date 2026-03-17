import { defineType } from "@io/core/graph/def";

import { core } from "../../core.js";
import { dateTypeModule } from "../../core/date/index.js";
import { numberTypeModule } from "../../core/number/index.js";
import { stringTypeModule } from "../../core/string/index.js";
import { estiiReferenceField } from "../reference-field.js";

export const comment = defineType({
  values: { key: "estii:comment", name: "Comment" },
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
    resolvedAt: dateTypeModule.field({
      cardinality: "one?",
      meta: { label: "Resolved at" },
    }),
    mentions: estiiReferenceField("estii:person", {
      cardinality: "many",
      collection: "unordered",
      label: "Mentions",
    }),
    replies: estiiReferenceField("estii:reply", {
      cardinality: "many",
      collection: "ordered",
      label: "Replies",
    }),
  },
});
