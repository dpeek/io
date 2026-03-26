import { defineScalarModule } from "../../../type-module.js";
import { rateFilter } from "./filter.js";
import { rateMeta } from "./meta.js";
import {
  decodeRate,
  formatRate,
  formatRateEditorValue,
  normalizeRateInput,
  parseRate,
  rateType,
  type RateValue,
} from "./type.js";

export const rateTypeModule = defineScalarModule({
  type: rateType,
  meta: rateMeta,
  filter: rateFilter,
});

export {
  decodeRate,
  formatRate,
  formatRateEditorValue,
  normalizeRateInput,
  parseRate,
  rateFilter,
  rateMeta,
  rateType,
};
export type { RateValue };
