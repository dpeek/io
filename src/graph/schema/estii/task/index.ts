import { defineType } from "@io/core/graph/def";

import { core } from "../../core.js";
import { numberTypeModule } from "../../core/number/index.js";
import { estiiReferenceField } from "../reference-field.js";

export const task = defineType({
  values: { key: "estii:task", name: "Task" },
  fields: {
    ...core.node.fields,
    order: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Order" },
    }),
    owners: estiiReferenceField("estii:person", {
      cardinality: "many",
      collection: "unordered",
      label: "Owners",
    }),
    tags: estiiReferenceField(core.tag, {
      cardinality: "many",
      collection: "unordered",
      create: true,
      editorKind: "entity-reference-combobox",
      label: "Tags",
    }),
    estimates: estiiReferenceField("estii:estimate", {
      cardinality: "many",
      collection: "ordered",
      label: "Estimates",
    }),
    comments: estiiReferenceField("estii:comment", {
      cardinality: "many",
      collection: "ordered",
      label: "Comments",
    }),
  },
});
