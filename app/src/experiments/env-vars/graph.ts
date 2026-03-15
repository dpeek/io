import { envVar, envVarsSchema, secretRef } from "@io/graph/schema/app/env-vars";

import { defineAppExperimentGraph } from "../contracts.js";

export { envVar, secretRef };

export const envVarsExperimentSchema = envVarsSchema;

export const envVarsExperimentGraph = defineAppExperimentGraph({
  key: "envVars",
  label: "Environment variables",
  description: "Authority-backed env-var metadata and secret reference modeling.",
  schema: envVarsExperimentSchema,
});
