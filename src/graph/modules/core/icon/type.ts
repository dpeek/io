import { defineType } from "@io/core/graph/def";

import { normalizeSvgMarkup, validateSvgMarkup } from "../../../icon.js";
import { node } from "../node/index.js";
import { slugTypeModule } from "../slug/index.js";
import { svgTypeModule } from "../svg/index.js";
import { graphIconSeeds } from "./seed.js";

export const icon = defineType({
  values: { key: "core:icon", name: "Icon", icon: graphIconSeeds.icon },
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
    svg: svgTypeModule.field({
      cardinality: "one",
      meta: {
        label: "SVG",
      },
      onCreate: ({ incoming }) => normalizeSvgMarkup(incoming),
      onUpdate: ({ incoming }) => normalizeSvgMarkup(incoming),
      validate: ({ value }) => validateSvgMarkup({ value }),
    }),
  },
});
