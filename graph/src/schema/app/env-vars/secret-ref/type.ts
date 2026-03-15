import { core } from "../../../../graph/core.js";
import { defineType } from "../../../../graph/schema.js";
import { numberTypeModule } from "../../../../type/number/index.js";
import { dateTypeModule } from "../../../core/date/index.js";

export const secretRef = defineType({
  values: { key: "app:secretRef", name: "Secret Reference" },
  fields: {
    ...core.node.fields,
    version: numberTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Secret version",
      },
    }),
    lastRotatedAt: dateTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Last rotated",
      },
    }),
  },
});
