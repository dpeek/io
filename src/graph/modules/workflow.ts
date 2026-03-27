import { applyGraphIdMap as applyIdMap } from "@io/graph-kernel";

export * from "./workflow/schema.js";
export * from "./workflow/env-var/schema.js";
export * from "./workflow/document/schema.js";

import ids from "./workflow.json";
import { documentSchema } from "./workflow/document/schema.js";
import { envVarSchema } from "./workflow/env-var/schema.js";
import { workflowSchema } from "./workflow/schema.js";

export const workflow = applyIdMap(ids, {
  ...documentSchema,
  ...envVarSchema,
  ...workflowSchema,
});
