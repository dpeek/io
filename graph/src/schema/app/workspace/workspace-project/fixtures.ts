import type { CreateInputOfType } from "../../../../graph/client.js";

import { workspaceProject } from "./type.js";

export type WorkspaceProjectFixtureInput = CreateInputOfType<typeof workspaceProject>;

export type WorkspaceProjectFixtureClient = {
  readonly workspaceProject: {
    create(input: WorkspaceProjectFixtureInput): string;
  };
};

export function createWorkspaceProjectFixture(
  graph: WorkspaceProjectFixtureClient,
  input: WorkspaceProjectFixtureInput,
): string {
  return graph.workspaceProject.create(input);
}
