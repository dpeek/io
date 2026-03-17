import { defineType } from "@io/core/graph/def";

import { core } from "../../core.js";
import { numberTypeModule } from "../../core/number/index.js";
import { stringTypeModule } from "../../core/string/index.js";
import { estiiReferenceField } from "../reference-field.js";

export const estimate = defineType({
  values: { key: "estii:estimate", name: "Estimate" },
  fields: {
    ...core.node.fields,
    order: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Order" },
    }),
    amount: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Amount" },
    }),
    targetResource: estiiReferenceField("estii:resource", {
      cardinality: "one",
      label: "Target resource",
    }),
    unit: stringTypeModule.field({
      cardinality: "one?",
      meta: { label: "Unit" },
    }),
    period: stringTypeModule.field({
      cardinality: "one?",
      meta: { label: "Period" },
    }),
    variable: estiiReferenceField("estii:variable", {
      cardinality: "one?",
      label: "Variable",
    }),
  },
});
