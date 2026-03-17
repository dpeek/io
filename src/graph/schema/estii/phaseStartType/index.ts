import { defineEnum } from "@io/core/graph/def";

import { defineDefaultEnumTypeModule } from "../../core/enum-module.js";

const phaseStartTypeType = defineEnum({
  values: { key: "estii:phaseStartType", name: "Phase Start Type" },
  options: {
    auto: { name: "Auto" },
    deal: { name: "Deal" },
    phase: { name: "Phase" },
    date: { name: "Date" },
  },
});

export const phaseStartTypeTypeModule = defineDefaultEnumTypeModule(phaseStartTypeType);
export const phaseStartType = phaseStartTypeTypeModule.type;
