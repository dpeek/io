import type { TypeModuleMeta } from "../../../graph/type-module.js";
import { formatPercent, formatPercentInputValue, parsePercent } from "./type.js";

export const percentMeta = {
  summary: {
    kind: "value",
    format: formatPercent,
  },
  display: {
    kind: "number/percent",
    allowed: ["number/percent", "number", "text"] as const,
    format: formatPercent,
  },
  editor: {
    kind: "number/percent",
    allowed: ["number/percent", "number", "text"] as const,
    inputMode: "decimal",
    placeholder: "0-100%",
    parse: parsePercent,
    format: formatPercentInputValue,
  },
} satisfies TypeModuleMeta<
  number,
  readonly ["number/percent", "number", "text"],
  readonly ["number/percent", "number", "text"]
>;
