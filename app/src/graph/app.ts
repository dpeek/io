import { defineNamespace } from "@io/graph";

import { appGraphDefinitions } from "../experiments/graph.js";
export { company, person, status } from "../experiments/company/graph.js";
export { envVar, secretRef } from "@io/graph/schema/app/env-vars";
export { block } from "@io/graph/schema/app/outliner";
export {
  workflowStatus,
  workflowStatusCategory,
  workspace,
  workspaceIssue,
  workspaceLabel,
  workspaceProject,
} from "@io/graph/schema/app/workspace";
import ids from "./app.json";

export const app = defineNamespace(ids, appGraphDefinitions);
