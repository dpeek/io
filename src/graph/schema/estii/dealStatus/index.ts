import { defineEnum } from "@io/core/graph/def";

import { defineDefaultEnumTypeModule } from "../../core/enum-module.js";

const dealStatusType = defineEnum({
  values: { key: "estii:dealStatus", name: "Deal Status" },
  options: {
    draft: { name: "Draft" },
    approved: { name: "Approved" },
    progressed: { name: "Progressed" },
    won: { name: "Won" },
    lost: { name: "Lost" },
    abandoned: { name: "Abandoned" },
  },
});

export const dealStatusTypeModule = defineDefaultEnumTypeModule(dealStatusType);
export const dealStatus = dealStatusTypeModule.type;
