import { defineEnum } from "@io/core/graph/def";

import { defineDefaultEnumTypeModule } from "../../core/enum-module.js";

const riskType = defineEnum({
  values: { key: "estii:risk", name: "Risk" },
  options: {
    none: { name: "None" },
    low: { name: "Low" },
    normal: { name: "Normal" },
    high: { name: "High" },
  },
});

export const riskTypeModule = defineDefaultEnumTypeModule(riskType);
export const risk = riskTypeModule.type;
