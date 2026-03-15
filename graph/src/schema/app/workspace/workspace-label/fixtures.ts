import type { CreateInputOfType } from "../../../../graph/client.js";

import { workspaceLabel } from "./type.js";

export type WorkspaceLabelFixtureInput = CreateInputOfType<typeof workspaceLabel>;

export type WorkspaceLabelFixtureClient = {
  readonly workspaceLabel: {
    create(input: WorkspaceLabelFixtureInput): string;
  };
};

export function createWorkspaceLabelFixture(
  graph: WorkspaceLabelFixtureClient,
  input: WorkspaceLabelFixtureInput,
): string {
  return graph.workspaceLabel.create(input);
}
