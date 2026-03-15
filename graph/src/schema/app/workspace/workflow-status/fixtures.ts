import type { CreateInputOfType } from "../../../../graph/client.js";

import { workflowStatus } from "./type.js";

export type WorkspaceWorkflowStatusFixtureInput = CreateInputOfType<typeof workflowStatus>;

export type WorkspaceWorkflowStatusFixtureClient = {
  readonly workflowStatus: {
    create(input: WorkspaceWorkflowStatusFixtureInput): string;
  };
};

export function createWorkspaceWorkflowStatusFixture(
  graph: WorkspaceWorkflowStatusFixtureClient,
  input: WorkspaceWorkflowStatusFixtureInput,
): string {
  return graph.workflowStatus.create(input);
}
