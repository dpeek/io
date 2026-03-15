import { core } from "../../../../graph/core.js";
import { defineType } from "../../../../graph/schema.js";
import { slugTypeModule } from "../../../../type/slug.js";
import { stringTypeModule } from "../../../../type/string/index.js";

export const workspaceLabel = defineType({
  values: { key: "app:workspaceLabel", name: "Workspace Label" },
  fields: {
    ...core.node.fields,
    key: slugTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Key",
      },
      filter: {
        operators: ["equals", "prefix"] as const,
        defaultOperator: "equals",
      },
    }),
    color: stringTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Color",
      },
    }),
  },
});
