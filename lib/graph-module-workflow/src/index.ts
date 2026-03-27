import { applyGraphIdMap as applyIdMap } from "@io/graph-kernel";

export * from "./schema.js";
export * from "./env-var.js";
export * from "./document.js";

import { documentSchema } from "./document.js";
import { envVarSchema } from "./env-var.js";
import { workflowSchema } from "./schema.js";
import ids from "./workflow.json";

export const workflow = applyIdMap(ids, {
  ...documentSchema,
  ...envVarSchema,
  ...workflowSchema,
});
