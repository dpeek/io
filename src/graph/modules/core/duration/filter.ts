import type { TypeModuleFilter } from "../../../type-module.js";
import { formatDuration, parseDuration } from "./type.js";

export const durationFilter = {
  defaultOperator: "equals",
  operators: {
    equals: {
      label: "Equals",
      operand: {
        kind: "string",
        placeholder: "30 min",
      },
      parse: parseDuration,
      format: formatDuration,
      test: (value: number, operand: number) => value === operand,
    },
    lt: {
      label: "Shorter than",
      operand: {
        kind: "string",
        placeholder: "30 min",
      },
      parse: parseDuration,
      format: formatDuration,
      test: (value: number, operand: number) => value < operand,
    },
    gt: {
      label: "Longer than",
      operand: {
        kind: "string",
        placeholder: "30 min",
      },
      parse: parseDuration,
      format: formatDuration,
      test: (value: number, operand: number) => value > operand,
    },
  },
} satisfies TypeModuleFilter<number>;
