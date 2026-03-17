import { defineEnum } from "@io/core/graph/def";

import { defineDefaultEnumTypeModule } from "../../core/enum-module.js";

const milestonePeriodType = defineEnum({
  values: { key: "estii:milestonePeriod", name: "Milestone Period" },
  options: {
    week: { name: "Week" },
    fortnight: { name: "Fortnight" },
    month: { name: "Month" },
    quarter: { name: "Quarter" },
  },
});

export const milestonePeriodTypeModule = defineDefaultEnumTypeModule(milestonePeriodType);
export const milestonePeriod = milestonePeriodTypeModule.type;
