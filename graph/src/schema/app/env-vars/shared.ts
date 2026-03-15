export const envVarNamePattern = /^[A-Z][A-Z0-9_]*$/;

export const envVarNameBlankMessage = "Environment variable names must not be blank.";

export const envVarNameInvalidMessage =
  "Environment variable names must start with a letter and use only uppercase letters, numbers, and underscores.";

export function buildSecretReferenceName(envVarName: string): string {
  return `${envVarName} secret`;
}
