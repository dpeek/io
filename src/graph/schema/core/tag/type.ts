import { defineType } from "@io/core/graph/def";

import { colorTypeModule } from "../color/index.js";
import { graphIconSeeds } from "../icon/seed.js";
import { node } from "../node/index.js";
import { slugTypeModule } from "../slug/index.js";

export const tag = defineType({
  values: { key: "core:tag", name: "Tag", icon: graphIconSeeds.tag },
  fields: {
    ...node.fields,
    key: slugTypeModule.field({
      cardinality: "one",
      icon: graphIconSeeds.string,
      meta: {
        label: "Key",
      },
      filter: {
        operators: ["equals", "prefix"] as const,
        defaultOperator: "equals",
      },
    }),
    color: colorTypeModule.field({
      cardinality: "one",
      icon: graphIconSeeds.color,
      meta: {
        label: "Color",
      },
    }),
  },
});
