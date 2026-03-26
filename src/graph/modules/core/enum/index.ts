import { defineType } from "@io/core/graph/def";

import { defineReferenceField } from "../../../type-module.js";
import { graphIconSeeds } from "../icon/seed.js";
import { node } from "../node/index.js";
import { coreType } from "../type/index.js";

export const enumType = defineType({
  values: { key: "core:enum", name: "Enum", icon: graphIconSeeds.enum },
  fields: {
    ...node.fields,
    member: defineReferenceField({
      range: coreType.values.key,
      cardinality: "many",
    }),
  },
});
