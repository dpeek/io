import { defineScalarModule } from "@io/core/graph/def";

import { booleanFilter } from "./filter.js";
import { booleanMeta } from "./meta.js";
import { booleanType } from "./type.js";

export const booleanTypeModule = defineScalarModule({
  type: booleanType,
  meta: booleanMeta,
  filter: booleanFilter,
});

export { booleanFilter, booleanMeta, booleanType };
