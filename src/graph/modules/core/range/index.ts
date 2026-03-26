import { defineScalarModule } from "../../../type-module.js";
import { rangeFilter } from "./filter.js";
import { rangeMeta } from "./meta.js";
import {
  decodeRange,
  formatRange,
  formatRangeEditorValue,
  normalizeRangeInput,
  parseRange,
  rangeType,
  type RangeValue,
} from "./type.js";

export const rangeTypeModule = defineScalarModule({
  type: rangeType,
  meta: rangeMeta,
  filter: rangeFilter,
});

export {
  decodeRange,
  formatRange,
  formatRangeEditorValue,
  normalizeRangeInput,
  parseRange,
  rangeFilter,
  rangeMeta,
  rangeType,
};
export type { RangeValue };
