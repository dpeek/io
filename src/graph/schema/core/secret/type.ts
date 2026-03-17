import { defineType } from "@io/core/graph/def";

import { dateTypeModule } from "../date/index.js";
import { graphIconSeeds } from "../icon/index.js";
import { node } from "../node/index.js";
import { numberTypeModule } from "../number/index.js";

const replicatedAuthority = {
  visibility: "replicated",
  write: "server-command",
} as const;

export const secretHandle = defineType({
  values: { key: "core:secretHandle", name: "Secret Handle", icon: graphIconSeeds.secret },
  fields: {
    ...node.fields,
    name: {
      ...node.fields.name,
      authority: replicatedAuthority,
    },
    createdAt: {
      ...node.fields.createdAt,
      authority: replicatedAuthority,
    },
    updatedAt: {
      ...node.fields.updatedAt,
      authority: replicatedAuthority,
    },
    version: numberTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Secret version",
      },
      authority: replicatedAuthority,
    }),
    lastRotatedAt: dateTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Last rotated",
      },
      authority: replicatedAuthority,
    }),
  },
});
