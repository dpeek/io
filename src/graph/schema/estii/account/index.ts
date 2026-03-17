import { defineType } from "@io/core/graph/def";

import { core } from "../../core.js";
import { numberTypeModule } from "../../core/number/index.js";

export const account = defineType({
  values: { key: "estii:account", name: "Account" },
  fields: {
    ...core.node.fields,
    order: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Order" },
    }),
  },
});
