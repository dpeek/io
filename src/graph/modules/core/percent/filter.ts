import type { TypeModuleFilter } from "../../../graph/type-module.js";
import { formatPercentInputValue, parsePercent } from "./type.js";

export const percentFilter = {
  defaultOperator: "gte",
  operators: {
    equals: {
      label: "Equals",
      operand: {
        kind: "number",
        inputMode: "decimal",
      },
      parse: parsePercent,
      format: formatPercentInputValue,
      test: (value: number, operand: number) => value === operand,
    },
    gte: {
      label: "At least",
      operand: {
        kind: "number",
        inputMode: "decimal",
      },
      parse: parsePercent,
      format: formatPercentInputValue,
      test: (value: number, operand: number) => value >= operand,
    },
    lte: {
      label: "At most",
      operand: {
        kind: "number",
        inputMode: "decimal",
      },
      parse: parsePercent,
      format: formatPercentInputValue,
      test: (value: number, operand: number) => value <= operand,
    },
  },
} satisfies TypeModuleFilter<number>;
