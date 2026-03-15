export * from "./env-var/index.js";
export * from "./secret-ref/index.js";
export * from "./shared.js";

import { envVar } from "./env-var/index.js";
import { secretRef } from "./secret-ref/index.js";

export const envVarsSchema = {
  envVar,
  secretRef,
} as const;
