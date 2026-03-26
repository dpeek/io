import type { TypeModuleFilter } from "../../../type-module.js";
import { compareStructuredValueValues } from "../structured-value.js";
import { formatRange, parseRange, type RangeValue } from "./type.js";

export const rangeFilter = {
  defaultOperator: "equals",
  operators: {
    equals: {
      label: "Equals",
      operand: {
        kind: "string",
        placeholder: "quantity(5 kg) .. quantity(10 kg)",
      },
      parse: parseRange,
      format: (operand: RangeValue) => formatRange(operand),
      test: (value: RangeValue, operand: RangeValue) => {
        if (value.kind !== operand.kind) return false;

        try {
          return (
            compareStructuredValueValues(value.kind, value.min as never, operand.min as never) ===
              0 &&
            compareStructuredValueValues(value.kind, value.max as never, operand.max as never) === 0
          );
        } catch {
          return false;
        }
      },
    },
  },
} satisfies TypeModuleFilter<RangeValue>;
