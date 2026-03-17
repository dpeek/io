import { defineEnum } from "@io/core/graph/def";

import { defineDefaultEnumTypeModule } from "../../core/enum-module.js";

const milestoneDateRoundingType = defineEnum({
  values: { key: "estii:milestoneDateRounding", name: "Milestone Date Rounding" },
  options: {
    day: { name: "Day" },
    week: { name: "Week" },
    month: { name: "Month" },
  },
});

export const milestoneDateRoundingTypeModule =
  defineDefaultEnumTypeModule(milestoneDateRoundingType);
export const milestoneDateRounding = milestoneDateRoundingTypeModule.type;
