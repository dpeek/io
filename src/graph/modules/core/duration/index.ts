import { defineScalarModule } from "../../../type-module.js";
import { durationFilter } from "./filter.js";
import { durationMeta } from "./meta.js";
import {
  chooseDurationUnit,
  convertDurationAmount,
  decomposeDuration,
  defaultDurationUnitKey,
  durationType,
  durationUnits,
  formatDuration,
  formatDurationAmount,
  formatDurationEditorValue,
  normalizeDurationInput,
  parseDuration,
  type DurationUnitKey,
} from "./type.js";

export const durationTypeModule = defineScalarModule({
  type: durationType,
  meta: durationMeta,
  filter: durationFilter,
});

export {
  chooseDurationUnit,
  convertDurationAmount,
  decomposeDuration,
  defaultDurationUnitKey,
  durationFilter,
  durationMeta,
  durationType,
  durationUnits,
  formatDuration,
  formatDurationAmount,
  formatDurationEditorValue,
  normalizeDurationInput,
  parseDuration,
};
export type { DurationUnitKey };
