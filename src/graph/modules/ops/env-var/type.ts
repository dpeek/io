import { defineType } from "@io/core/graph/def";

import { defineSecretField } from "../../../type-module.js";
import { core } from "../../core.js";
import { secretHandle } from "../../core/secret/index.js";
import { stringTypeModule } from "../../core/string/index.js";

export const envVarNamePattern = /^[A-Z][A-Z0-9_]*$/;

export const envVarNameBlankMessage = "Environment variable names must not be blank.";

export const envVarNameInvalidMessage =
  "Environment variable names must start with a letter and use only uppercase letters, numbers, and underscores.";

export const envVar = defineType({
  values: { key: "ops:envVar", name: "Environment Variable" },
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
