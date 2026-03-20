import { defineScalarModule } from "../../../graph/type-module.js";
import { stringFilter } from "../string/filter.js";
import { markdownMeta } from "./meta.js";
import { markdownType } from "./type.js";

export const markdownTypeModule = defineScalarModule({
  type: markdownType,
  meta: markdownMeta,
  filter: stringFilter,
});

export { markdownMeta, markdownType };
