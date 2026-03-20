import { defineScalar } from "@io/core/graph/def";

import { graphIconSeeds } from "../icon/seed.js";
import { expectBooleanInput } from "../input.js";

export const booleanType = defineScalar({
  values: { key: "core:boolean", name: "Boolean", icon: graphIconSeeds.boolean },
  encode: (value: boolean) => String(expectBooleanInput(value)),
  decode: (raw) => {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new Error(`Invalid boolean value "${raw}"`);
  },
});
