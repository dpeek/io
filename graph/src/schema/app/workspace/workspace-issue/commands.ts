import type { GraphCommandSpec } from "../../../../graph/contracts.js";

import { workspaceIssue } from "./type.js";

export type SaveWorkspaceIssueCommandInput = {
  readonly blockedBy?: readonly string[];
  readonly description?: string;
  readonly dueDate?: Date;
  readonly identifier: string;
  readonly labels?: readonly string[];
  readonly name: string;
  readonly parent?: string;
  readonly priority?: number;
  readonly project?: string;
  readonly status: string;
};

export type SaveWorkspaceIssueCommandOutput = {
  readonly issueId: string;
};

export const saveWorkspaceIssueCommand = {
  key: "app:workspaceIssue:save",
  label: "Save workspace issue",
  subject: workspaceIssue.values.key,
  execution: "optimisticVerify",
  input: {
    name: "Shape the backlog",
    identifier: "OPE-231",
    status: "status-1",
    description: "Carry reusable workspace issue semantics beside the schema.",
    project: "project-1",
    priority: 0,
    dueDate: new Date("2026-03-31T00:00:00.000Z"),
    labels: ["label-1"],
    parent: "issue-0",
    blockedBy: ["issue-2"],
  },
  output: {
    issueId: "issue-1",
  },
  policy: {
    capabilities: ["workspace.issue.write"],
    touchesPredicates: [
      workspaceIssue.fields.name.key,
      workspaceIssue.fields.identifier.key,
      workspaceIssue.fields.description.key,
      workspaceIssue.fields.status.key,
      workspaceIssue.fields.project.key,
      workspaceIssue.fields.priority.key,
      workspaceIssue.fields.dueDate.key,
      workspaceIssue.fields.labels.key,
      workspaceIssue.fields.parent.key,
      workspaceIssue.fields.blockedBy.key,
    ],
  },
} satisfies GraphCommandSpec<SaveWorkspaceIssueCommandInput, SaveWorkspaceIssueCommandOutput>;
