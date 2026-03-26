import { applyGraphIdMap as applyIdMap } from "@io/graph-kernel";

import ids from "./ops.json";
import { envVarSchema } from "./ops/env-var/schema.js";
import { workflowSchema } from "./ops/workflow/schema.js";

export const ops = applyIdMap(ids, {
  ...envVarSchema,
  ...workflowSchema,
});
