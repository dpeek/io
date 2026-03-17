import { defineType } from "@io/core/graph/def";

import { core } from "../../core.js";
import { numberTypeModule } from "../../core/number/index.js";

export const card = defineType({
  values: { key: "estii:card", name: "Rate Card" },
  fields: {
    ...core.node.fields,
    order: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Order" },
    }),
    marginMin: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Minimum margin" },
    }),
    marginMed: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Medium margin" },
    }),
    marginMax: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Maximum margin" },
    }),
  },
});
