import { defineNamespace } from "../runtime/schema.js";
import ids from "./ops.json";
import { envVarSchema } from "./ops/env-var/schema.js";
import { workflowSchema } from "./ops/workflow/schema.js";

export const ops = defineNamespace(ids, {
  ...envVarSchema,
  ...workflowSchema,
});
