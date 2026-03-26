import type { TypeModuleFilter } from "../../../type-module.js";
import { structuredValuePartEquals } from "../structured-value.js";
import { formatRate, parseRate, type RateValue } from "./type.js";

export const rateFilter = {
  defaultOperator: "equals",
  operators: {
    equals: {
      label: "Equals",
      operand: {
        kind: "string",
        placeholder: "money(125 USD) / duration(1 day)",
      },
      parse: parseRate,
      format: (operand: RateValue) => formatRate(operand),
      test: (value: RateValue, operand: RateValue) =>
        structuredValuePartEquals(value.numerator, operand.numerator) &&
        structuredValuePartEquals(value.denominator, operand.denominator),
    },
  },
} satisfies TypeModuleFilter<RateValue>;
