import { defineEnum } from "@io/core/graph/def";

import { defineDefaultEnumTypeModule } from "../../core/enum-module.js";

const resourceKindType = defineEnum({
  values: { key: "estii:resourceKind", name: "Resource Kind" },
  options: {
    generic: { name: "Generic" },
    role: { name: "Role" },
    stream: { name: "Stream" },
    product: { name: "Product" },
  },
});

export const resourceKindTypeModule = defineDefaultEnumTypeModule(resourceKindType);
export const resourceKind = resourceKindTypeModule.type;
