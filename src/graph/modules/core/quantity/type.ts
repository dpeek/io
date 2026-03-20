import { defineScalar } from "@io/core/graph/def";

import { graphIconSeeds } from "../icon/seed.js";
import { expectNumberInput, expectRecordInput, expectStringInput } from "../input.js";

export type QuantityValue = Readonly<{
  amount: number;
  unit: string;
}>;

function formatDecimal(value: number, maximumFractionDigits: number): string {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Number(value.toFixed(maximumFractionDigits));
  return String(rounded);
}

function normalizeQuantityUnit(value: unknown): string {
  const unit = expectStringInput(value).trim();
  if (unit.length === 0) {
    throw new Error("Quantity units must not be blank.");
  }
  return unit;
}

function normalizeQuantityAmount(value: unknown): number {
  const amount = expectNumberInput(value);
  if (!Number.isFinite(amount)) {
    throw new Error("Quantity amounts must be finite.");
  }
  return amount;
}

export function normalizeQuantityInput(value: unknown): QuantityValue {
  const input = expectRecordInput(value);
  return {
    amount: normalizeQuantityAmount(input.amount),
    unit: normalizeQuantityUnit(input.unit),
  };
}

export function parseQuantity(raw: string): QuantityValue {
  const normalized = raw.trim();
  const match = normalized.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))\s+(.+)$/);
  if (!match) {
    throw new Error(`Invalid quantity value "${raw}"`);
  }

  return {
    amount: normalizeQuantityAmount(Number(match[1])),
    unit: normalizeQuantityUnit(match[2]),
  };
}

export function decodeQuantity(raw: string): QuantityValue {
  return normalizeQuantityInput(JSON.parse(raw) as unknown);
}

export function formatQuantityAmount(value: number): string {
  return formatDecimal(value, 6);
}

export function formatQuantity(value: QuantityValue): string {
  return `${formatQuantityAmount(value.amount)} ${value.unit}`;
}

export function formatQuantityEditorValue(value: QuantityValue): string {
  return formatQuantity(value);
}

export const quantityType = defineScalar({
  values: { key: "core:quantity", name: "Quantity", icon: graphIconSeeds.number },
  encode: (value: QuantityValue) => JSON.stringify(normalizeQuantityInput(value)),
  decode: (raw) => decodeQuantity(raw),
  validate: ({ value }) => {
    try {
      normalizeQuantityInput(value);
    } catch (error) {
      return {
        code: "quantity.invalid",
        message: error instanceof Error ? error.message : "Quantity values are invalid.",
      };
    }

    return undefined;
  },
});
