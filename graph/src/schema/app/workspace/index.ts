export * from "./workflow-status-category/index.js";
export * from "./workflow-status/index.js";
export * from "./workspace/index.js";
export * from "./workspace-issue/index.js";
export * from "./workspace-label/index.js";
export * from "./workspace-project/index.js";

import { workflowStatusCategory } from "./workflow-status-category/index.js";
import { workflowStatus } from "./workflow-status/index.js";
import { workspace } from "./workspace/index.js";
import { workspaceIssue } from "./workspace-issue/index.js";
import { workspaceLabel } from "./workspace-label/index.js";
import { workspaceProject } from "./workspace-project/index.js";

export const workspaceSchema = {
  workflowStatus,
  workflowStatusCategory,
  workspace,
  workspaceIssue,
  workspaceLabel,
  workspaceProject,
} as const;
