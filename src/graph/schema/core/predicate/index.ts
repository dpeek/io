import { defineType } from "@io/core/graph/def";

import { defineReferenceField } from "../../../graph/type-module.js";
import { cardinalityTypeModule } from "../cardinality/index.js";
import { iconReferenceField } from "../icon/index.js";
import { graphIconSeeds } from "../icon/seed.js";
import { node } from "../node/index.js";
import { stringTypeModule } from "../string/index.js";
import { coreType } from "../type/index.js";

export const predicate = defineType({
  values: { key: "core:predicate", name: "Predicate", icon: graphIconSeeds.edge },
  fields: {
    ...node.fields,
    key: stringTypeModule.field({
      cardinality: "one",
      icon: stringTypeModule.type.values.icon,
      meta: {
        label: "Key",
      },
      filter: {
        operators: ["equals", "prefix"] as const,
        defaultOperator: "equals",
      },
    }),
    range: defineReferenceField({
      range: coreType.values.key,
      cardinality: "one?",
    }),
    cardinality: cardinalityTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Cardinality",
      },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    icon: iconReferenceField(),
  },
});
