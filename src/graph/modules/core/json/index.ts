import { defineScalarModule } from "../../../type-module.js";
import { jsonFilter } from "./filter.js";
import { jsonMeta } from "./meta.js";
import { jsonType } from "./type.js";

export const jsonTypeModule = defineScalarModule({
  type: jsonType,
  meta: jsonMeta,
  filter: jsonFilter,
});

export { jsonFilter, jsonMeta, jsonType };
