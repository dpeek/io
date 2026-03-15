import { core } from "../../../../graph/core.js";
import { defineType } from "../../../../graph/schema.js";
import { defineReferenceField } from "../../../../graph/type-module.js";
import { stringTypeModule } from "../../../../type/string/index.js";
import {
  envVarNameBlankMessage,
  envVarNameInvalidMessage,
  envVarNamePattern,
} from "../shared.js";
import { secretRef } from "../secret-ref/index.js";

export const envVar = defineType({
  values: { key: "app:envVar", name: "Environment Variable" },
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
    secret: defineReferenceField({
      range: secretRef,
      cardinality: "one?",
      meta: {
        label: "Secret reference",
      },
    }),
  },
});
