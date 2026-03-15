export * from "./workflow-status-category/index.js";
export * from "./workflow-status/index.js";
export * from "./workflows.js";
export * from "./workspace/index.js";
export * from "./workspace-issue/index.js";
export * from "./workspace-label/index.js";
export * from "./workspace-project/index.js";

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
import { workflowStatusCategory } from "./workflow-status-category/index.js";
import { workflowStatus } from "./workflow-status/index.js";
import { workspace } from "./workspace/index.js";

export const workspaceSchema = {
  workflowStatus,
  workflowStatusCategory,
  workspace,
  workspaceIssue,
  workspaceLabel,
  workspaceProject,
} as const;

export const workspaceObjectViews = [
  workspaceIssueObjectView,
  workspaceProjectObjectView,
  workspaceLabelObjectView,
] as const;

export const workspaceCommands = [
  saveWorkspaceIssueCommand,
  saveWorkspaceProjectCommand,
  saveWorkspaceLabelCommand,
] as const;
