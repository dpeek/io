import { core } from "../../../../graph/core.js";
import { defineType } from "../../../../graph/schema.js";
import { numberTypeModule } from "../../../../type/number/index.js";
import { slugTypeModule } from "../../../../type/slug.js";
import { stringTypeModule } from "../../../../type/string/index.js";
import { workflowStatusCategoryTypeModule } from "../workflow-status-category/index.js";

export const workflowStatus = defineType({
  values: { key: "app:workflowStatus", name: "Workflow Status" },
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
    category: workflowStatusCategoryTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Category",
        display: {
          kind: "badge",
        },
      },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    order: numberTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Order",
      },
      filter: {
        operators: ["equals", "lt", "gt"] as const,
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
