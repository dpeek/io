import { createIdMap } from "../graph/identity.js";
import { defineNamespace } from "../graph/schema.js";
import { kitchenSinkEnumSchema } from "./test/enums.js";
import { kitchenSinkScalarSchema } from "./test/scalars.js";
import { kitchenSinkTypeSchema } from "./test/types.js";

export * from "./test/index.js";

export const kitchenSinkSchema = {
  ...kitchenSinkEnumSchema,
  ...kitchenSinkScalarSchema,
  ...kitchenSinkTypeSchema,
} as const;

export const kitchenSinkIdMap = createIdMap(kitchenSinkSchema).map;

export const kitchenSink = defineNamespace(kitchenSinkIdMap, kitchenSinkSchema);
