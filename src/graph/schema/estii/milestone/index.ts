import { defineType } from "@io/core/graph/def";

import { core } from "../../core.js";
import { dateTypeModule } from "../../core/date/index.js";
import { numberTypeModule } from "../../core/number/index.js";
import { milestonePeriodTypeModule } from "../enums.js";
import { estiiReferenceField } from "../reference-field.js";

export const milestone = defineType({
  values: { key: "estii:milestone", name: "Milestone" },
  fields: {
    ...core.node.fields,
    order: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Order" },
    }),
    phase: estiiReferenceField("estii:phase", {
      cardinality: "one?",
      label: "Phase",
    }),
    progress: numberTypeModule.field({
      cardinality: "one?",
      meta: { label: "Progress" },
    }),
    date: dateTypeModule.field({
      cardinality: "one?",
      meta: { label: "Date" },
    }),
    period: milestonePeriodTypeModule.field({
      cardinality: "one?",
      meta: { label: "Period" },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    days: numberTypeModule.field({
      cardinality: "one?",
      meta: { label: "Days" },
    }),
    percent: numberTypeModule.field({
      cardinality: "one?",
      meta: { label: "Percent" },
    }),
    amount: numberTypeModule.field({
      cardinality: "one?",
      meta: { label: "Amount" },
    }),
  },
});
