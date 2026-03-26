import type { TypeModuleMeta } from "../../../type-module.js";
import { formatRate, formatRateEditorValue, parseRate, type RateValue } from "./type.js";

export const rateMeta = {
  summary: {
    kind: "value",
    format: formatRate,
  },
  display: {
    kind: "number/rate",
    allowed: ["number/rate", "text"] as const,
    format: formatRate,
  },
  editor: {
    kind: "number/rate",
    allowed: ["number/rate", "text"] as const,
    placeholder: "money(125 USD) / duration(1 day)",
    parse: parseRate,
    format: formatRateEditorValue,
  },
} satisfies TypeModuleMeta<
  RateValue,
  readonly ["number/rate", "text"],
  readonly ["number/rate", "text"]
>;
