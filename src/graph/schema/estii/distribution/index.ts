import { defineEnum } from "@io/core/graph/def";

import { defineDefaultEnumTypeModule } from "../../core/enum-module.js";

const distributionType = defineEnum({
  values: { key: "estii:distribution", name: "Distribution" },
  options: {
    left: { name: "Left" },
    right: { name: "Right" },
    middle: { name: "Middle" },
    cycle: { name: "Cycle" },
  },
});

export const distributionTypeModule = defineDefaultEnumTypeModule(distributionType);
export const distribution = distributionTypeModule.type;
