export * from "./dealStatus/index.js";
export * from "./milestoneDateRounding/index.js";
export * from "./milestoneKind/index.js";
export * from "./milestonePeriod/index.js";
export * from "./breakdownType/index.js";
export * from "./distribution/index.js";
export * from "./phaseStartType/index.js";
export * from "./featureCategory/index.js";
export * from "./priority/index.js";
export * from "./risk/index.js";
export * from "./formula/index.js";
export * from "./resourceKind/index.js";

import { breakdownType } from "./breakdownType/index.js";
import { dealStatus } from "./dealStatus/index.js";
import { distribution } from "./distribution/index.js";
import { featureCategory } from "./featureCategory/index.js";
import { formula } from "./formula/index.js";
import { milestoneDateRounding } from "./milestoneDateRounding/index.js";
import { milestoneKind } from "./milestoneKind/index.js";
import { milestonePeriod } from "./milestonePeriod/index.js";
import { phaseStartType } from "./phaseStartType/index.js";
import { priority } from "./priority/index.js";
import { resourceKind } from "./resourceKind/index.js";
import { risk } from "./risk/index.js";

export const estiiEnumSchema = {
  dealStatus,
  milestoneDateRounding,
  milestoneKind,
  milestonePeriod,
  breakdownType,
  distribution,
  phaseStartType,
  featureCategory,
  priority,
  risk,
  formula,
  resourceKind,
} as const;
