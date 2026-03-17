import { defineEnum } from "@io/core/graph/def";

import { defineDefaultEnumTypeModule } from "../../core/enum-module.js";

const featureCategoryType = defineEnum({
  values: { key: "estii:featureCategory", name: "Feature Category" },
  options: {
    feature: { name: "Feature" },
    overhead: { name: "Overhead" },
    service: { name: "Service" },
    expense: { name: "Expense" },
  },
});

export const featureCategoryTypeModule = defineDefaultEnumTypeModule(featureCategoryType);
export const featureCategory = featureCategoryTypeModule.type;
