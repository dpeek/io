import { defineScalar } from "@io/core/graph/def";

import { graphIconSeeds } from "../icon/seed.js";
import { expectNumberInput } from "../input.js";

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
  values: { key: "core:percent", name: "Percent", icon: graphIconSeeds.number },
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
