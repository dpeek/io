import { defineScalar } from "@io/core/graph/def";

import { graphIconSeeds } from "../icon/seed.js";
import { expectUrlInput } from "../input.js";

export const urlType = defineScalar({
  values: { key: "core:url", name: "URL", icon: graphIconSeeds.url },
  encode: (value: URL) => expectUrlInput(value).toString(),
  decode: (raw) => new URL(raw),
});
