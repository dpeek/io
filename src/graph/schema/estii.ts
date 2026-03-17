import { defineNamespace } from "../graph/schema.js";
import ids from "./estii.json";
import { estiiEnumSchema } from "./estii/enums.js";
import { estiiSchema } from "./estii/types.js";

export const estii = defineNamespace(ids, {
  ...estiiEnumSchema,
  ...estiiSchema,
});
