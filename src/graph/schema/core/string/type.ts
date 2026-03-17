import { defineScalar } from "@io/core/graph/def";

import { graphIconSeeds } from "../icon/seed.js";
import { expectStringInput } from "../input.js";

export const stringType = defineScalar({
  values: { key: "core:string", name: "String", icon: graphIconSeeds.string },
  encode: (value: string) => expectStringInput(value),
  decode: (raw) => raw,
});
