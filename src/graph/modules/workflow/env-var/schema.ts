import {
  envVar,
  envVarNameBlankMessage,
  envVarNameInvalidMessage,
  envVarNamePattern,
} from "./type.js";

export const envVarSchema = {
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
