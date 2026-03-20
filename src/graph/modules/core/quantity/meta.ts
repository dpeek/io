import type { TypeModuleMeta } from "../../../graph/type-module.js";
import {
  formatQuantity,
  formatQuantityEditorValue,
  parseQuantity,
  type QuantityValue,
} from "./type.js";

export const quantityMeta = {
  summary: {
    kind: "value",
    format: formatQuantity,
  },
  display: {
    kind: "number/quantity",
    allowed: ["number/quantity", "text"] as const,
    format: formatQuantity,
  },
  editor: {
    kind: "number/quantity",
    allowed: ["number/quantity", "text"] as const,
    inputMode: "decimal",
    placeholder: "5 kg",
    parse: parseQuantity,
    format: formatQuantityEditorValue,
  },
} satisfies TypeModuleMeta<
  QuantityValue,
  readonly ["number/quantity", "text"],
  readonly ["number/quantity", "text"]
>;
