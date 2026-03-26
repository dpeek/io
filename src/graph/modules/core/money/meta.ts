import type { TypeModuleMeta } from "../../../type-module.js";
import { formatMoney, formatMoneyEditorValue, parseMoney, type MoneyValue } from "./type.js";

export const moneyMeta = {
  summary: {
    kind: "value",
    format: formatMoney,
  },
  display: {
    kind: "money/amount",
    allowed: ["money/amount", "text"] as const,
    format: formatMoney,
  },
  editor: {
    kind: "money/amount",
    allowed: ["money/amount", "text"] as const,
    inputMode: "decimal",
    placeholder: "12 USD",
    parse: parseMoney,
    format: formatMoneyEditorValue,
  },
} satisfies TypeModuleMeta<
  MoneyValue,
  readonly ["money/amount", "text"],
  readonly ["money/amount", "text"]
>;
