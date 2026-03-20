import { defineEnum } from "@io/core/graph/def";

export const topicKindType = defineEnum({
  values: { key: "app:topicKind", name: "Topic Kind" },
  options: {
    module: {
      name: "Module",
      description: "Describes a stable product or package area.",
    },
    concept: {
      name: "Concept",
      description: "Captures a cross-cutting idea or invariant.",
    },
    workflow: {
      name: "Workflow",
      description: "Describes a repeatable execution path or procedure.",
    },
    decision: {
      name: "Decision",
      description: "Records an architectural or product choice and rationale.",
    },
    runbook: {
      name: "Runbook",
      description: "Documents an operational procedure for humans or agents.",
    },
    note: {
      name: "Note",
      description: "Stores shorter supporting context or scratch knowledge.",
    },
  },
});
