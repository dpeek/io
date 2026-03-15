export {
  buildSecretReferenceName,
  envVarNameBlankMessage,
  envVarNameInvalidMessage,
  envVarNamePattern,
} from "@io/graph/schema/app/env-vars";

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

export const envVarNameRequiredMessage = "Environment variable name is required.";

export const newEnvVarSecretRequiredMessage = "New environment variables require a secret value.";
