import { defineScalarModule } from "../../../graph/type-module.js";
import { urlFilter } from "./filter.js";
import { urlMeta } from "./meta.js";
import { urlType } from "./type.js";

export const urlTypeModule = defineScalarModule({
  type: urlType,
  meta: urlMeta,
  filter: urlFilter,
});

export { urlFilter, urlMeta, urlType };
