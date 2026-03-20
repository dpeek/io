import type { TypeModuleFilter } from "../../../graph/type-module.js";
import { formatQuantity, parseQuantity, type QuantityValue } from "./type.js";

export const quantityFilter = {
  defaultOperator: "equals",
  operators: {
    equals: {
      label: "Equals",
      operand: {
        kind: "string",
        placeholder: "5 kg",
      },
      parse: parseQuantity,
      format: (operand: QuantityValue) => formatQuantity(operand),
      test: (value: QuantityValue, operand: QuantityValue) =>
        value.amount === operand.amount && value.unit === operand.unit,
    },
  },
} satisfies TypeModuleFilter<QuantityValue>;
