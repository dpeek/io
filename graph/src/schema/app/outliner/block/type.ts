import { core } from "../../../../graph/core.js";
import { defineType } from "../../../../graph/schema.js";
import { defineReferenceField } from "../../../../graph/type-module.js";
import { booleanTypeModule } from "../../../../type/boolean/index.js";
import { numberTypeModule } from "../../../../type/number/index.js";
import { stringTypeModule } from "../../../../type/string/index.js";

export const block = defineType({
  values: { key: "app:block", name: "Outline Node" },
  fields: {
    ...core.node.fields,
    text: stringTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Text",
        editor: {
          kind: "textarea",
          multiline: true,
        },
      },
      filter: {
        operators: ["contains", "prefix"] as const,
        defaultOperator: "contains",
      },
    }),
    parent: defineReferenceField({
      range: "app:block",
      cardinality: "one?",
    }),
    order: numberTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Order",
      },
    }),
    collapsed: booleanTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Collapsed",
      },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
  },
});
