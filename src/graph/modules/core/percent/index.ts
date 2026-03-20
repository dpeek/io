import { defineScalarModule } from "../../../graph/type-module.js";
import { percentFilter } from "./filter.js";
import { percentMeta } from "./meta.js";
import {
  formatPercent,
  formatPercentInputValue,
  normalizePercentInput,
  parsePercent,
  percentType,
} from "./type.js";

export const percentTypeModule = defineScalarModule({
  type: percentType,
  meta: percentMeta,
  filter: percentFilter,
});

export {
  formatPercent,
  formatPercentInputValue,
  normalizePercentInput,
  parsePercent,
  percentFilter,
  percentMeta,
  percentType,
};
