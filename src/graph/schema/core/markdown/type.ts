import { defineScalar } from "@io/core/graph/def";

import { graphIconSeeds } from "../icon/seed.js";
import { expectStringInput } from "../input.js";

export const markdownType = defineScalar({
  values: { key: "core:markdown", name: "Markdown", icon: graphIconSeeds.markdown },
  encode: (value: string) => expectStringInput(value),
  decode: (raw) => raw,
});
