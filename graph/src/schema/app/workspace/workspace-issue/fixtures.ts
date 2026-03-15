import type { CreateInputOfType } from "../../../../graph/client.js";

import { workspaceIssue } from "./type.js";

export type WorkspaceIssueFixtureInput = CreateInputOfType<typeof workspaceIssue>;

export type WorkspaceIssueFixtureClient = {
  readonly workspaceIssue: {
    create(input: WorkspaceIssueFixtureInput): string;
  };
};

export function createWorkspaceIssueFixture(
  graph: WorkspaceIssueFixtureClient,
  input: WorkspaceIssueFixtureInput,
): string {
  return graph.workspaceIssue.create(input);
}
