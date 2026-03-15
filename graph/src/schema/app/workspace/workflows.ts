import type { WorkflowSpec } from "../../../graph/contracts.js";

import { workspace } from "./workspace/index.js";
import {
  saveWorkspaceIssueCommand,
  workspaceIssue,
  workspaceIssueObjectView,
} from "./workspace-issue/index.js";
import {
  saveWorkspaceLabelCommand,
  workspaceLabel,
  workspaceLabelObjectView,
} from "./workspace-label/index.js";
import {
  saveWorkspaceProjectCommand,
  workspaceProject,
  workspaceProjectObjectView,
} from "./workspace-project/index.js";

export const workspaceManagementWorkflow = {
  key: "app:workspace:management",
  label: "Manage workspace planning",
  description:
    "Review issue details, tune project grouping, and curate reusable labels inside the seeded workspace model.",
  subjects: [
    workspace.values.key,
    workspaceIssue.values.key,
    workspaceProject.values.key,
    workspaceLabel.values.key,
  ],
  steps: [
    {
      key: "triage-issues",
      title: "Review issue details",
      description: "Inspect issue status, project links, and dependencies from the workspace board.",
      objectView: workspaceIssueObjectView.key,
      command: saveWorkspaceIssueCommand.key,
    },
    {
      key: "shape-projects",
      title: "Adjust project grouping",
      description: "Keep project context and target dates aligned with the active issue set.",
      objectView: workspaceProjectObjectView.key,
      command: saveWorkspaceProjectCommand.key,
    },
    {
      key: "curate-labels",
      title: "Curate label catalog",
      description: "Maintain reusable planning labels without leaving the workspace surface.",
      objectView: workspaceLabelObjectView.key,
      command: saveWorkspaceLabelCommand.key,
    },
  ],
  commands: [
    saveWorkspaceIssueCommand.key,
    saveWorkspaceProjectCommand.key,
    saveWorkspaceLabelCommand.key,
  ],
} satisfies WorkflowSpec;

export const workspaceWorkflows = [workspaceManagementWorkflow] as const;
