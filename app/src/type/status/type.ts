import { defineEnum } from "@io/graph";

export const statusType = defineEnum({
  values: { key: "app:status", name: "Status" },
  options: {
    active: {
      name: "Active",
      description: "Entity is active",
    },
    paused: {
      name: "Paused",
      description: "Temporarily inactive",
    },
  },
});
