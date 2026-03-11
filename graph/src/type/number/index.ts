import { defineScalarModule } from "../../graph/type-module.js";
import { numberFilter } from "../number/filter.js";
import { numberMeta } from "../number/meta.js";
import { numberType } from "../number/type.js";

export const numberTypeModule = defineScalarModule({
  type: numberType,
  meta: numberMeta,
  filter: numberFilter,
});

export { numberFilter, numberMeta, numberType };
