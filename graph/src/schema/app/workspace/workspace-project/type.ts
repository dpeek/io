import { core } from "../../../../graph/core.js";
import { defineType } from "../../../../graph/schema.js";
import { slugTypeModule } from "../../../../type/slug.js";
import { stringTypeModule } from "../../../../type/string/index.js";
import { dateTypeModule } from "../../../core/date/index.js";

export const workspaceProject = defineType({
  values: { key: "app:workspaceProject", name: "Workspace Project" },
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
    targetDate: dateTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Target date",
      },
      filter: {
        operators: ["on", "before", "after"] as const,
        defaultOperator: "on",
      },
    }),
  },
});
