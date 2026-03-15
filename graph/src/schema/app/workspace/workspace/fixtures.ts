import type { CreateInputOfType } from "../../../../graph/client.js";

import { workspace } from "./type.js";

export type WorkspaceFixtureInput = CreateInputOfType<typeof workspace>;

export type WorkspaceFixtureClient = {
  readonly workspace: {
    create(input: WorkspaceFixtureInput): string;
  };
};

export function createWorkspaceFixture(
  graph: WorkspaceFixtureClient,
  input: WorkspaceFixtureInput,
): string {
  return graph.workspace.create(input);
}
