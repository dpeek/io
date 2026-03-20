import { defineScalar } from "@io/core/graph/def";

import { graphIconSeeds } from "../icon/index.js";

export const jsonType = defineScalar<unknown>({
  values: { key: "core:json", name: "JSON", icon: graphIconSeeds.json },
  encode: (value) => JSON.stringify(value),
  decode: (raw) => JSON.parse(raw) as unknown,
});
