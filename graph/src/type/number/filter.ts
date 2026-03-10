import type { TypeModuleFilter } from "../../graph/type-module.js";

function parseNumber(raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid number value "${raw}"`);
  }
  return value;
}

export const numberFilter = {
  defaultOperator: "equals",
  operators: {
    equals: {
      label: "Equals",
      operand: {
        kind: "number",
        inputMode: "numeric",
      },
      parse: parseNumber,
      format: (operand: number) => String(operand),
      test: (value: number, operand: number) => value === operand,
    },
    lt: {
      label: "Less than",
      operand: {
        kind: "number",
        inputMode: "numeric",
      },
      parse: parseNumber,
      format: (operand: number) => String(operand),
      test: (value: number, operand: number) => value < operand,
    },
    gt: {
      label: "Greater than",
      operand: {
        kind: "number",
        inputMode: "numeric",
      },
      parse: parseNumber,
      format: (operand: number) => String(operand),
      test: (value: number, operand: number) => value > operand,
    },
  },
} satisfies TypeModuleFilter<number>;
