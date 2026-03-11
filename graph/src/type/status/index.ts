import { defineEnumModule } from "../../graph/type-module.js";
import { statusFilter } from "../status/filter.js";
import { statusMeta } from "../status/meta.js";
import { statusType } from "../status/type.js";

export const statusTypeModule = defineEnumModule({
  type: statusType,
  meta: statusMeta,
  filter: statusFilter,
});

export { statusFilter, statusMeta, statusType };
