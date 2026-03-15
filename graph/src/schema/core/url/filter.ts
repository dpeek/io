import type { TypeModuleFilter } from "../../../graph/type-module.js";

function parseUrl(raw: string): URL {
  return new URL(raw);
}

export const urlFilter = {
  defaultOperator: "equals",
  operators: {
    equals: {
      label: "Equals",
      operand: {
        kind: "url",
        placeholder: "https://example.com",
      },
      parse: parseUrl,
      format: (operand: URL) => operand.toString(),
      test: (value: URL, operand: URL) => value.toString() === operand.toString(),
    },
    host: {
      label: "Host",
      operand: {
        kind: "string",
        placeholder: "example.com",
      },
      parse: (raw: string) => raw,
      format: (operand: string) => operand,
      test: (value: URL, operand: string) => value.host === operand,
    },
  },
} satisfies TypeModuleFilter<URL>;
