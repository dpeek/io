import { defineScalarModule } from "../../../graph/type-module.js";
import { stringFilter } from "../string/filter.js";
import { svgMeta } from "./meta.js";
import { svgType } from "./type.js";

export const svgTypeModule = defineScalarModule({
  type: svgType,
  meta: svgMeta,
  filter: stringFilter,
});

export { svgMeta, svgType };
