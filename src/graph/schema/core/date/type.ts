import { defineScalar } from "@io/core/graph/def";

import { graphIconSeeds } from "../icon/seed.js";
import { formatDate, parseDate } from "./parse.js";

export const dateType = defineScalar({
  values: { key: "core:date", name: "Date", icon: graphIconSeeds.date },
  encode: formatDate,
  decode: parseDate,
});
