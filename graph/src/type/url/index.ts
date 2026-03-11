import { defineScalarModule } from "../../graph/type-module.js";
import { urlFilter } from "../url/filter.js";
import { urlMeta } from "../url/meta.js";
import { urlType } from "../url/type.js";

export const urlTypeModule = defineScalarModule({
  type: urlType,
  meta: urlMeta,
  filter: urlFilter,
});

export { urlFilter, urlMeta, urlType };
