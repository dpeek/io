import type { TypeModuleMeta } from "../../../type-module.js";
import { formatRange, formatRangeEditorValue, parseRange, type RangeValue } from "./type.js";

export const rangeMeta = {
  summary: {
    kind: "value",
    format: formatRange,
  },
  display: {
    kind: "number/range",
    allowed: ["number/range", "text"] as const,
    format: formatRange,
  },
  editor: {
    kind: "number/range",
    allowed: ["number/range", "text"] as const,
    placeholder: "quantity(5 kg) .. quantity(10 kg)",
    parse: parseRange,
    format: formatRangeEditorValue,
  },
} satisfies TypeModuleMeta<
  RangeValue,
  readonly ["number/range", "text"],
  readonly ["number/range", "text"]
>;
