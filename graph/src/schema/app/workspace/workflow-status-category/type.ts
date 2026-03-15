import { defineEnum } from "../../../../graph/schema.js";
import { defineDefaultEnumTypeModule } from "../../../../type/enum-module.js";

const workflowStatusCategoryType = defineEnum({
  values: { key: "app:workflowStatusCategory", name: "Workflow Status Category" },
  options: {
    backlog: {
      name: "Backlog",
      description: "Still being shaped or waiting for release.",
    },
    unstarted: {
      name: "Unstarted",
      description: "Ready to pick up but not started yet.",
    },
    started: {
      name: "Started",
      description: "Actively being worked right now.",
    },
    completed: {
      name: "Completed",
      description: "Finished and accepted.",
    },
    canceled: {
      name: "Canceled",
      description: "Closed without delivery.",
    },
  },
});

export const workflowStatusCategoryTypeModule =
  defineDefaultEnumTypeModule(workflowStatusCategoryType);

export const workflowStatusCategory = workflowStatusCategoryTypeModule.type;
