import { defineType } from "@io/core/graph/def";

import { core } from "../../core.js";
import { emailTypeModule } from "../../core/email/index.js";

export const person = defineType({
  values: { key: "estii:person", name: "Person" },
  fields: {
    ...core.node.fields,
    email: emailTypeModule.field({
      cardinality: "one?",
      meta: { label: "Email" },
    }),
  },
});
