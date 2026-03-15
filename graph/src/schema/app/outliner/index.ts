export * from "./block/index.js";

import { block } from "./block/index.js";

export const outlinerSchema = {
  block,
} as const;
