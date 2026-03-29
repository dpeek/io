import { applyGraphIdMap, type ResolvedGraphNamespace } from "@io/graph-kernel";

export * from "./schema.js";
export * from "./env-var.js";
export * from "./document.js";

import { documentSchema } from "./document.js";
import { envVarSchema } from "./env-var.js";
import { workflowSchema, type WorkflowSchema } from "./schema.js";
import ids from "./workflow.json";

type WorkflowNamespaceInput = typeof documentSchema & typeof envVarSchema & WorkflowSchema;

export type WorkflowNamespace = ResolvedGraphNamespace<WorkflowNamespaceInput>;

export const workflow: WorkflowNamespace = applyGraphIdMap(ids, {
  ...documentSchema,
  ...envVarSchema,
  ...workflowSchema,
});
