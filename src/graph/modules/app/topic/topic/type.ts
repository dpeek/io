import { defineType } from "@io/core/graph/def";

import {
  entityReferenceComboboxEditorKind,
  existingEntityReferenceField,
} from "../../../../graph/reference-policy.js";
import { core } from "../../../core.js";
import { booleanTypeModule } from "../../../core/index.js";
import { markdownTypeModule } from "../../../core/markdown/index.js";
import { numberTypeModule } from "../../../core/number/index.js";
import { slugTypeModule } from "../../../core/slug/index.js";
import { topicKindTypeModule } from "../topic-kind/index.js";

export const topic = defineType({
  values: { key: "app:topic", name: "Topic" },
  fields: {
    ...core.node.fields,
    kind: topicKindTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Kind",
        display: {
          kind: "badge",
        },
      },
      filter: {
        operators: ["is", "oneOf"] as const,
        defaultOperator: "is",
      },
    }),
    isArchived: booleanTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Is Archived",
      },
    }),
    slug: slugTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Slug",
      },
    }),
    content: markdownTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Content",
      },
      filter: {
        operators: ["contains", "prefix"] as const,
        defaultOperator: "contains",
      },
    }),
    parent: existingEntityReferenceField("app:topic", {
      cardinality: "one?",
      excludeSubject: true,
      label: "Parent",
    }),
    order: numberTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Order",
      },
    }),
    tags: existingEntityReferenceField(core.tag, {
      cardinality: "many",
      collection: "unordered",
      create: true,
      editorKind: entityReferenceComboboxEditorKind,
      label: "Tags",
    }),
    references: existingEntityReferenceField("app:topic", {
      cardinality: "many",
      collection: "unordered",
      label: "References",
    }),
  },
});
