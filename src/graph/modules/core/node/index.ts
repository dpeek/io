import { defineType } from "@io/core/graph/def";

import { defineReferenceField } from "../../../type-module.js";
import { dateTypeModule } from "../date/index.js";
import { graphIconSeeds } from "../icon/seed.js";
import { stringTypeModule } from "../string/index.js";

export const node = defineType({
  values: { key: "core:node", name: "Node" },
  fields: {
    type: defineReferenceField({
      range: "core:type",
      cardinality: "many",
    }),
    name: stringTypeModule.field({
      cardinality: "one",
      icon: graphIconSeeds.string,
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
      icon: graphIconSeeds.string,
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
        icon: graphIconSeeds.date,
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
        icon: graphIconSeeds.date,
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
