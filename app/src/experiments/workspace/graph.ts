import {
  workflowStatus,
  workflowStatusCategory,
  workspace,
  workspaceCommands,
  workspaceIssue,
  workspaceIssueObjectView,
  workspaceLabel,
  workspaceLabelObjectView,
  workspaceObjectViews,
  workspaceProject,
  workspaceProjectObjectView,
  workspaceSchema,
  workspaceManagementWorkflow,
  workspaceWorkflows,
} from "@io/graph/schema/app/workspace";

import { defineAppExperimentGraph } from "../contracts.js";
import { seedWorkspaceExperiment } from "./seed.js";

export {
  workflowStatus,
  workflowStatusCategory,
  workspace,
  workspaceCommands,
  workspaceIssue,
  workspaceIssueObjectView,
  workspaceLabel,
  workspaceLabelObjectView,
  workspaceObjectViews,
  workspaceProject,
  workspaceProjectObjectView,
  workspaceManagementWorkflow,
  workspaceWorkflows,
};

export const workspaceExperimentSchema = workspaceSchema;
export const workspaceExperimentObjectViews = workspaceObjectViews;
export const workspaceExperimentCommands = workspaceCommands;
export const workspaceExperimentWorkflows = workspaceWorkflows;

export const workspaceExperimentGraph = defineAppExperimentGraph({
  key: "workspaceModel",
  label: "Workspace model",
  description: "Linear-like workspace schema and planning seed data for management proofs.",
  schema: workspaceExperimentSchema,
  seed: seedWorkspaceExperiment,
});
