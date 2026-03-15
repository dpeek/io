import {
  workflowStatus,
  workflowStatusCategory,
  workspace,
  workspaceIssue,
  workspaceLabel,
  workspaceProject,
  workspaceSchema,
} from "@io/graph/schema/app/workspace";

import { defineAppExperimentGraph } from "../contracts.js";
import { seedWorkspaceExperiment } from "./seed.js";

export {
  workflowStatus,
  workflowStatusCategory,
  workspace,
  workspaceIssue,
  workspaceLabel,
  workspaceProject,
};

export const workspaceExperimentSchema = workspaceSchema;

export const workspaceExperimentGraph = defineAppExperimentGraph({
  key: "workspaceModel",
  label: "Workspace model",
  description: "Linear-like workspace schema and planning seed data for management proofs.",
  schema: workspaceExperimentSchema,
  seed: seedWorkspaceExperiment,
});
