import { defineEnum } from "@io/core/graph/def";

import { defineDefaultEnumTypeModule } from "../../modules/core/enum-module.js";

const kitchenSinkStatusType = defineEnum({
  values: { key: "kitchen:status", name: "Kitchen Sink Status" },
  options: {
    draft: {
      name: "Draft",
      description: "Work has not started.",
      order: 0,
    },
    inReview: {
      key: "kitchen:status.in_review",
      name: "In review",
      description: "Work is under review.",
      docs: "Used by the kitchen sink test schema.",
      order: 1,
    },
    approved: {
      name: "Approved",
      description: "Work is ready to ship.",
      order: 2,
    },
    archived: {
      name: "Archived",
      description: "Work is closed.",
      order: 3,
      deprecated: true,
    },
  },
});

export const kitchenSinkStatusTypeModule = defineDefaultEnumTypeModule(kitchenSinkStatusType);
export const kitchenSinkStatus = kitchenSinkStatusTypeModule.type;

const kitchenSinkSeverityType = defineEnum({
  values: { key: "kitchen:severity", name: "Kitchen Sink Severity" },
  options: {
    low: {
      name: "Low",
      description: "Routine work.",
      order: 0,
    },
    medium: {
      name: "Medium",
      description: "Normal priority work.",
      order: 1,
    },
    high: {
      name: "High",
      description: "Urgent work.",
      order: 2,
    },
    blocker: {
      key: "kitchen:severity.blocker",
      name: "Blocker",
      description: "Work cannot proceed.",
      order: 3,
    },
  },
});

export const kitchenSinkSeverityTypeModule = defineDefaultEnumTypeModule(kitchenSinkSeverityType);
export const kitchenSinkSeverity = kitchenSinkSeverityTypeModule.type;

export const kitchenSinkEnumSchema = {
  status: kitchenSinkStatus,
  severity: kitchenSinkSeverity,
} as const;
