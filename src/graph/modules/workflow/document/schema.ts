export * from "./type.js";

import { document, documentBlock, documentBlockKind, documentPlacement } from "./type.js";

export const documentSchema = {
  document,
  documentBlockKind,
  documentBlock,
  documentPlacement,
} as const;
