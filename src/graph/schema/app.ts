import { defineNamespace } from "../graph/schema.js";
import ids from "./app.json";
import { envVarsSchema } from "./app/env-vars/index.js";
import { topicSchema } from "./app/topic/index.js";

export const app = defineNamespace(ids, {
  ...envVarsSchema,
  ...topicSchema,
});
