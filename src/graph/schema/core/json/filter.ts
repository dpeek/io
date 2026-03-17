import type { TypeModuleFilter } from "../../../graph/type-module.js";

function formatJson(value: unknown): string {
  return JSON.stringify(value);
}

export const jsonFilter = {
  defaultOperator: "contains",
  operators: {
    contains: {
      label: "Contains",
      operand: {
        kind: "string",
      },
      parse: (raw: string) => raw,
      format: (operand: string) => operand,
      test: (value: unknown, operand: string) => formatJson(value).includes(operand),
    },
    equals: {
      label: "Equals",
      operand: {
        kind: "string",
      },
      parse: (raw: string) => raw,
      format: (operand: string) => operand,
      test: (value: unknown, operand: string) => formatJson(value) === operand,
    },
  },
} satisfies TypeModuleFilter<unknown>;
