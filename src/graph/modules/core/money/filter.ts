import type { TypeModuleFilter } from "../../../type-module.js";
import { formatMoney, parseMoney, type MoneyValue } from "./type.js";

export const moneyFilter = {
  defaultOperator: "equals",
  operators: {
    equals: {
      label: "Equals",
      operand: {
        kind: "string",
        placeholder: "12 USD",
      },
      parse: parseMoney,
      format: (operand: MoneyValue) => formatMoney(operand),
      test: (value: MoneyValue, operand: MoneyValue) =>
        value.amount === operand.amount && value.currency === operand.currency,
    },
  },
} satisfies TypeModuleFilter<MoneyValue>;
