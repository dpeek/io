import { describe, expect, it } from "bun:test";

import {
  workspaceCommands,
  workspaceManagementWorkflow,
  workspaceObjectViews,
  workspaceSchema,
  workspaceWorkflows,
} from "@io/graph/schema/app/workspace";

import {
  workspaceExperimentCommands,
  workspaceExperimentGraph,
  workspaceExperimentObjectViews,
  workspaceExperimentSchema,
  workspaceExperimentWorkflows,
} from "./graph.js";

describe("workspace experiment graph", () => {
  it("wires the promoted workspace slice through the experiment-local graph module", () => {
    expect(workspaceExperimentSchema).toBe(workspaceSchema);
    expect(workspaceExperimentObjectViews).toBe(workspaceObjectViews);
    expect(workspaceExperimentCommands).toBe(workspaceCommands);
    expect(workspaceExperimentWorkflows).toBe(workspaceWorkflows);
    expect(workspaceExperimentWorkflows).toContain(workspaceManagementWorkflow);
    expect(workspaceExperimentGraph.schema).toBe(workspaceExperimentSchema);
  });
});
