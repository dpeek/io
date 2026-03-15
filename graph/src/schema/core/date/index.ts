import { defineScalarModule } from "../../../graph/type-module.js";
import { dateFilter } from "./filter.js";
import { dateMeta } from "./meta.js";
import { dateType } from "./type.js";

export const dateTypeModule = defineScalarModule({
  type: dateType,
  meta: dateMeta,
  filter: dateFilter,
});

export { dateFilter, dateMeta, dateType };
