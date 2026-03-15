import { block, outlinerSchema } from "@io/graph/schema/app/outliner";

import { defineAppExperimentGraph } from "../contracts.js";
import { seedOutlinerExperiment } from "./seed.js";

export { block };

export const outlinerExperimentSchema = outlinerSchema;

export const outlinerExperimentGraph = defineAppExperimentGraph({
  key: "outliner",
  label: "Outliner",
  description: "Ordered block schema and keyboard-first outline proof surface.",
  schema: outlinerExperimentSchema,
  seed: seedOutlinerExperiment,
});
