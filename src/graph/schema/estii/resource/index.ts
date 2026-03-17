import { defineType } from "@io/core/graph/def";

import { core } from "../../core.js";
import { jsonTypeModule } from "../../core/json/index.js";
import { numberTypeModule } from "../../core/number/index.js";
import { stringTypeModule } from "../../core/string/index.js";
import { resourceKindTypeModule } from "../enums.js";
import { estiiReferenceField } from "../reference-field.js";

export const resource = defineType({
  values: { key: "estii:resource", name: "Resource" },
  fields: {
    ...core.node.fields,
    order: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Order" },
    }),
    kind: resourceKindTypeModule.field({
      cardinality: "one",
      meta: { label: "Kind" },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    rates: jsonTypeModule.field({
      cardinality: "one",
      meta: { label: "Rates" },
    }),
    model: stringTypeModule.field({
      cardinality: "one?",
      meta: { label: "Pricing model" },
    }),
    unit: stringTypeModule.field({
      cardinality: "one?",
      meta: { label: "Unit" },
    }),
    period: stringTypeModule.field({
      cardinality: "one?",
      meta: { label: "Period" },
    }),
    margin: numberTypeModule.field({
      cardinality: "one?",
      meta: { label: "Margin" },
    }),
    quantity: stringTypeModule.field({
      cardinality: "one?",
      meta: { label: "Quantity" },
    }),
    tag: estiiReferenceField("estii:resourceTag", {
      cardinality: "one?",
      label: "Tag",
    }),
  },
});
