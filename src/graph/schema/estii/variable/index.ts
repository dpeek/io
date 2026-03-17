import { defineType } from "@io/core/graph/def";

import { core } from "../../core.js";
import { numberTypeModule } from "../../core/number/index.js";
import { stringTypeModule } from "../../core/string/index.js";
import { formulaTypeModule } from "../enums.js";

export const variable = defineType({
  values: { key: "estii:variable", name: "Variable" },
  fields: {
    ...core.node.fields,
    order: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Order" },
    }),
    formula: formulaTypeModule.field({
      cardinality: "one",
      meta: { label: "Formula" },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    unit: stringTypeModule.field({
      cardinality: "one?",
      meta: { label: "Unit" },
    }),
    value: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Value" },
    }),
    periodMs: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Period (ms)" },
    }),
    delta: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Delta" },
    }),
    deltaPeriodMs: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Delta period (ms)" },
    }),
    rounding: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Rounding" },
    }),
  },
});
