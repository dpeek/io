import { defineType } from "@io/graph-module";
import { defineSecretField } from "@io/graph-module";
import { core, secretHandle, stringTypeModule } from "@io/graph-module-core";

export const envVarNamePattern = /^[A-Z][A-Z0-9_]*$/;

export const envVarNameBlankMessage = "Environment variable names must not be blank.";

export const envVarNameInvalidMessage =
  "Environment variable names must start with a letter and use only uppercase letters, numbers, and underscores.";

export const envVar = defineType({
  values: { key: "workflow:envVar", name: "Environment Variable" },
  fields: {
    ...core.node.fields,
    name: stringTypeModule.field({
      cardinality: "one",
      validate: ({ value }) => {
        if (typeof value !== "string" || value.trim().length === 0) {
          return {
            code: "string.blank",
            message: envVarNameBlankMessage,
          };
        }
        if (!envVarNamePattern.test(value)) {
          return {
            code: "envVar.name.invalid",
            message: envVarNameInvalidMessage,
          };
        }
        return undefined;
      },
      meta: {
        label: "Variable name",
      },
    }),
    secret: defineSecretField({
      range: secretHandle,
      cardinality: "one?",
      meta: {
        label: "Secret",
      },
      revealCapability: "secret:reveal",
      rotateCapability: "secret:rotate",
    }),
  },
});

export const envVarSchema = {
  envVar,
} as const;

export function buildSecretHandleName(envVarName: string): string {
  return `${envVarName} secret`;
}
