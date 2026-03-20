import { defineScalarModule } from "../../../graph/type-module.js";
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
  parseDuration,
};
export type { DurationUnitKey };
