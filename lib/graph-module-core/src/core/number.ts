import type { TypeModuleFilter } from "@io/graph-module";
import type { TypeModuleMeta } from "@io/graph-module";
import { defineScalar } from "@io/graph-module";
import { defineScalarModule } from "@io/graph-module";

import { defineCoreIconSeed } from "../icon/seed.js";
import { expectNumberInput } from "./input.js";

const numberIconSeed = defineCoreIconSeed("number", {
  name: "Number",
  svg: `<svg viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none" width="24" height="24" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <path d="M12 3v18" />
  <rect width="18" height="18" rx="2" x="3" y="3" />
  <path d="M3 9h18" />
  <path d="M3 15h18" />
</svg>`,
});

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

export const numberMeta = {
  summary: {
    kind: "value",
    format: (value: number) => String(value),
  },
  display: {
    kind: "number",
    allowed: ["number", "text"] as const,
    format: (value: number) => String(value),
  },
  editor: {
    kind: "number",
    allowed: ["number", "slider"] as const,
  },
} satisfies TypeModuleMeta<number, readonly ["number", "text"], readonly ["number", "slider"]>;

export const numberType = defineScalar({
  values: { key: "core:number", name: "Number", icon: numberIconSeed },
  encode: (value: number) => String(expectNumberInput(value)),
  decode: (raw) => Number(raw),
  validate: ({ value }) =>
    Number.isFinite(value)
      ? undefined
      : {
          code: "number.notFinite",
          message: "Number values must be finite.",
        },
});

export const numberTypeModule = defineScalarModule({
  type: numberType,
  meta: numberMeta,
  filter: numberFilter,
});
