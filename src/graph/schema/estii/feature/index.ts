import { defineType } from "@io/core/graph/def";

import { core } from "../../core.js";
import { numberTypeModule } from "../../core/number/index.js";
import { featureCategoryTypeModule, priorityTypeModule, riskTypeModule } from "../enums.js";
import { estiiReferenceField } from "../reference-field.js";

export const feature = defineType({
  values: { key: "estii:feature", name: "Feature" },
  fields: {
    ...core.node.fields,
    order: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Order" },
    }),
    priority: priorityTypeModule.field({
      cardinality: "one",
      meta: { label: "Priority" },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    risk: riskTypeModule.field({
      cardinality: "one",
      meta: { label: "Risk" },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    category: featureCategoryTypeModule.field({
      cardinality: "one",
      meta: { label: "Category" },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    tags: estiiReferenceField(core.tag, {
      cardinality: "many",
      collection: "unordered",
      create: true,
      editorKind: "entity-reference-combobox",
      label: "Tags",
    }),
    tasks: estiiReferenceField("estii:task", {
      cardinality: "many",
      collection: "ordered",
      label: "Tasks",
    }),
  },
});
