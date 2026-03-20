import {
  envVar,
  envVarNameBlankMessage,
  envVarNameInvalidMessage,
  envVarNamePattern,
} from "./env-var.js";

export const envVarsSchema = {
  envVar,
} as const;

function buildSecretHandleName(envVarName: string): string {
  return `${envVarName} secret`;
}

export {
  buildSecretHandleName,
  envVar,
  envVarNameBlankMessage,
  envVarNameInvalidMessage,
  envVarNamePattern,
};
