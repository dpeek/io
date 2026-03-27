import { defineType } from "@io/graph-module";
import { defineReferenceField } from "@io/graph-module";

import { dateTypeModule } from "./date.js";
import { stringTypeModule } from "./string.js";

export const node = defineType({
  values: { key: "core:node", name: "Node" },
  fields: {
    type: defineReferenceField({
      range: "core:type",
      cardinality: "many",
    }),
    name: stringTypeModule.field({
      cardinality: "one",
      icon: stringTypeModule.type.values.icon,
      validate: ({ value }) =>
        typeof value === "string" && value.trim().length > 0
          ? undefined
          : {
              code: "string.blank",
              message: "Name must not be blank.",
            },
      meta: {
        label: "Name",
      },
    }),
    description: stringTypeModule.field({
      cardinality: "one?",
      icon: stringTypeModule.type.values.icon,
      meta: {
        label: "Description",
        editor: {
          kind: "textarea",
          multiline: true,
        },
      },
      filter: {
        operators: ["contains", "equals"] as const,
        defaultOperator: "contains",
      },
    }),
    createdAt: {
      ...dateTypeModule.field({
        icon: dateTypeModule.type.values.icon,
        meta: {
          label: "Created at",
        },
        cardinality: "one",
        onCreate: ({ incoming, now }) => incoming ?? now,
      }),
      createOptional: true as const,
    },
    updatedAt: {
      ...dateTypeModule.field({
        icon: dateTypeModule.type.values.icon,
        meta: {
          label: "Updated at",
        },
        cardinality: "one",
        onCreate: ({ incoming, now }) => incoming ?? now,
        onUpdate: ({ now, changedPredicateKeys }) =>
          [...changedPredicateKeys].some(
            (key) => !key.endsWith(":createdAt") && !key.endsWith(":updatedAt"),
          )
            ? now
            : undefined,
      }),
      createOptional: true as const,
    },
  },
});
