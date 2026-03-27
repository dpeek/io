import { defineScalar } from "@io/graph-module";
import type { TypeModuleFilter } from "@io/graph-module";
import type { TypeModuleMeta } from "@io/graph-module";
import { defineScalarModule } from "@io/graph-module";

import { expectNumberInput } from "./input.js";
import { numberType } from "./number.js";

function formatDecimal(value: number, maximumFractionDigits: number): string {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Number(value.toFixed(maximumFractionDigits));
  return String(rounded);
}

export function normalizePercentInput(value: unknown): number {
  const percent = expectNumberInput(value);
  if (!Number.isFinite(percent)) {
    throw new Error("Percent values must be finite.");
  }
  return percent;
}

export function parsePercent(raw: string): number {
  const normalized = raw.trim().replace(/%$/, "").trim();
  if (normalized.length === 0) {
    throw new Error(`Invalid percent value "${raw}"`);
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid percent value "${raw}"`);
  }

  return value;
}

export function formatPercentInputValue(value: number): string {
  return formatDecimal(value, 2);
}

export function formatPercent(value: number): string {
  return `${formatPercentInputValue(value)}%`;
}

export const percentType = defineScalar({
  values: { key: "core:percent", name: "Percent", icon: numberType.values.icon },
  encode: (value: number) => String(normalizePercentInput(value)),
  decode: (raw) => parsePercent(raw),
  validate: ({ value }) => {
    if (!Number.isFinite(value)) {
      return {
        code: "percent.notFinite",
        message: "Percent values must be finite.",
      };
    }

    if (value < 0 || value > 100) {
      return {
        code: "percent.range",
        message: "Percent values must be between 0 and 100.",
      };
    }

    return undefined;
  },
});

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

export const percentMeta = {
  summary: {
    kind: "value",
    format: formatPercent,
  },
  display: {
    kind: "number/percent",
    allowed: ["number/percent", "number", "text"] as const,
    format: formatPercent,
  },
  editor: {
    kind: "number/percent",
    allowed: ["number/percent", "number", "text"] as const,
    inputMode: "decimal",
    placeholder: "0-100%",
    parse: parsePercent,
    format: formatPercentInputValue,
  },
} satisfies TypeModuleMeta<
  number,
  readonly ["number/percent", "number", "text"],
  readonly ["number/percent", "number", "text"]
>;

export const percentTypeModule = defineScalarModule({
  type: percentType,
  meta: percentMeta,
  filter: percentFilter,
});
