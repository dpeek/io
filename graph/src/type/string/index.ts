import { defineScalarModule } from "../../graph/type-module.js";
import { stringFilter } from "../string/filter.js";
import { stringMeta } from "../string/meta.js";
import { stringType } from "../string/type.js";

export const stringTypeModule = defineScalarModule({
  type: stringType,
  meta: stringMeta,
  filter: stringFilter,
});

export { stringFilter, stringMeta, stringType };
