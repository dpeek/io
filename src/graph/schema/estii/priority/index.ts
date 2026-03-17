import { defineEnum } from "@io/core/graph/def";

import { defineDefaultEnumTypeModule } from "../../core/enum-module.js";

const priorityType = defineEnum({
  values: { key: "estii:priority", name: "Priority" },
  options: {
    none: { name: "None" },
    low: { name: "Low" },
    normal: { name: "Normal" },
    high: { name: "High" },
    critical: { name: "Critical" },
  },
});

export const priorityTypeModule = defineDefaultEnumTypeModule(priorityType);
export const priority = priorityTypeModule.type;
