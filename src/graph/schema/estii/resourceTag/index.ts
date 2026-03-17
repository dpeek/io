import { defineType } from "@io/core/graph/def";

import { core } from "../../core.js";
import { colorTypeModule } from "../../core/color/index.js";
import { numberTypeModule } from "../../core/number/index.js";
import { resourceKindTypeModule } from "../enums.js";

export const resourceTag = defineType({
  values: { key: "estii:resourceTag", name: "Resource Tag" },
  fields: {
    ...core.tag.fields,
    kind: resourceKindTypeModule.field({
      cardinality: "one",
      meta: { label: "Kind" },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    order: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Order" },
    }),
    color: colorTypeModule.field({
      cardinality: "one",
      meta: { label: "Color" },
    }),
    count: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Count" },
    }),
  },
});
