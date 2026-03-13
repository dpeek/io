export type SaveEnvVarInput = {
  readonly id?: string;
  readonly name: string;
  readonly description?: string;
  readonly secretValue?: string;
};

export type SaveEnvVarResult = {
  readonly envVarId: string;
  readonly created: boolean;
  readonly rotated: boolean;
  readonly secretVersion?: number;
};

export const envVarNamePattern = /^[A-Z][A-Z0-9_]*$/;

export const envVarNameRequiredMessage = "Environment variable name is required.";

export const envVarNameBlankMessage = "Environment variable names must not be blank.";

export const envVarNameInvalidMessage =
  "Environment variable names must start with a letter and use only uppercase letters, numbers, and underscores.";

export const newEnvVarSecretRequiredMessage = "New environment variables require a secret value.";

export function buildSecretReferenceName(envVarName: string): string {
  return `${envVarName} secret`;
}
