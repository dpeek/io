import { defineScalarModule } from "../../graph/type-module.js";
import { booleanFilter } from "../boolean/filter.js";
import { booleanMeta } from "../boolean/meta.js";
import { booleanType } from "../boolean/type.js";

export const booleanTypeModule = defineScalarModule({
  type: booleanType,
  meta: booleanMeta,
  filter: booleanFilter,
});

export { booleanFilter, booleanMeta, booleanType };
