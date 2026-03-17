import { defineEnum } from "@io/core/graph/def";

import { defineDefaultEnumTypeModule } from "../../core/enum-module.js";

const milestoneKindType = defineEnum({
  values: { key: "estii:milestoneKind", name: "Milestone Kind" },
  options: {
    none: { name: "None" },
    start: { name: "Start" },
    end: { name: "End" },
    halves: { name: "Halves" },
    thirds: { name: "Thirds" },
    quarters: { name: "Quarters" },
    fifths: { name: "Fifths" },
    sixths: { name: "Sixths" },
    fortnightly: { name: "Fortnightly" },
    fortnightlySplit: { key: "estii:milestoneKind.fortnightly_split", name: "Fortnightly split" },
    monthly: { name: "Monthly" },
    monthlySplit: { key: "estii:milestoneKind.monthly_split", name: "Monthly split" },
    quarterly: { name: "Quarterly" },
    quarterlySplit: { key: "estii:milestoneKind.quarterly_split", name: "Quarterly split" },
    custom: { name: "Custom" },
  },
});

export const milestoneKindTypeModule = defineDefaultEnumTypeModule(milestoneKindType);
export const milestoneKind = milestoneKindTypeModule.type;
