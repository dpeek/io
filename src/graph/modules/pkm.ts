import { applyGraphIdMap as applyIdMap } from "@io/graph-kernel";

import ids from "./pkm.json";
import { documentSchema } from "./pkm/document/schema.js";

export const pkm = applyIdMap(ids, {
  ...documentSchema,
});
