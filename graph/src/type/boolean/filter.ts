import type { TypeModuleFilter } from "../../graph/type-module.js";

function parseBoolean(raw: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`Invalid boolean value "${raw}"`);
}

export const booleanFilter = {
  defaultOperator: "is",
  operators: {
    is: {
      label: "Is",
      operand: {
        kind: "boolean",
      },
      parse: parseBoolean,
      format: (operand: boolean) => String(operand),
      test: (value: boolean, operand: boolean) => value === operand,
    },
    isNot: {
      label: "Is not",
      operand: {
        kind: "boolean",
      },
      parse: parseBoolean,
      format: (operand: boolean) => String(operand),
      test: (value: boolean, operand: boolean) => value !== operand,
    },
  },
} satisfies TypeModuleFilter<boolean>;
