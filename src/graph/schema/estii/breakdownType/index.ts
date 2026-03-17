import { defineEnum } from "@io/core/graph/def";

import { defineDefaultEnumTypeModule } from "../../core/enum-module.js";

const breakdownTypeType = defineEnum({
  values: { key: "estii:breakdownType", name: "Breakdown Type" },
  options: {
    priority: { name: "Priority" },
    category: { name: "Category" },
    feature: { name: "Feature" },
    tag: { name: "Tag" },
    risk: { name: "Risk" },
    role: { name: "Role" },
    roleTag: { key: "estii:breakdownType.role_tag", name: "Role tag" },
    stream: { name: "Stream" },
    product: { name: "Product" },
    productTag: { key: "estii:breakdownType.product_tag", name: "Product tag" },
  },
});

export const breakdownTypeTypeModule = defineDefaultEnumTypeModule(breakdownTypeType);
export const breakdownType = breakdownTypeTypeModule.type;
