export {
  workflowStatus,
  workflowStatusCategory,
  workspace,
  workspaceIssue,
  workspaceLabel,
  workspaceProject,
} from "../schema/app/workspace/index.js";

import { workspaceSchema } from "../schema/app/workspace/index.js";

export const workspaceTaxonomy = workspaceSchema;
