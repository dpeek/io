import {
  defaultDurationUnitKey,
  decomposeDuration,
  durationUnits,
  formatDuration,
  normalizeDurationInput,
  parseDuration,
  type DurationUnitKey,
} from "./duration.js";
import { expectRecordInput, expectStringInput } from "./input.js";
import {
  defaultMoneyCurrencyKey,
  formatMoney,
  moneyCurrencies,
  normalizeMoneyInput,
  parseMoney,
  type MoneyCurrencyKey,
  type MoneyValue,
} from "./money.js";
import {
  formatPercent,
  formatPercentInputValue,
  normalizePercentInput,
  parsePercent,
} from "./percent.js";
import {
  formatQuantity,
  normalizeQuantityInput,
  parseQuantity,
  type QuantityValue,
} from "./quantity.js";

export const structuredValueKinds = ["duration", "money", "percent", "quantity"] as const;

export type StructuredValueKind = (typeof structuredValueKinds)[number];

export type StructuredValueByKind = {
  duration: number;
  money: MoneyValue;
  percent: number;
  quantity: QuantityValue;
};

export type StructuredValuePart<K extends StructuredValueKind = StructuredValueKind> = Readonly<{
  kind: K;
  value: StructuredValueByKind[K];
}>;

export const structuredValueKindLabels: Record<StructuredValueKind, string> = {
  duration: "Duration",
  money: "Money",
  percent: "Percent",
  quantity: "Quantity",
};

export const structuredValueKindOptions = structuredValueKinds.map((kind) => ({
  kind,
  label: structuredValueKindLabels[kind],
})) satisfies readonly Readonly<{
  kind: StructuredValueKind;
  label: string;
}>[];

const structuredValueKindSet = new Set<StructuredValueKind>(structuredValueKinds);

const durationUnitKeys = new Set(durationUnits.map((unit) => unit.key));

const moneyCurrencyKeys = new Set(moneyCurrencies.map((currency) => currency.key));

export function isStructuredValueKind(value: string): value is StructuredValueKind {
  return structuredValueKindSet.has(value as StructuredValueKind);
}

export function getStructuredValueKindLabel(kind: StructuredValueKind): string {
  return structuredValueKindLabels[kind];
}

export function normalizeStructuredValueKind(value: unknown): StructuredValueKind {
  const token = expectStringInput(value).trim().toLowerCase();
  if (!isStructuredValueKind(token)) {
    throw new Error(`Unknown structured value kind "${token}".`);
  }
  return token;
}

export function normalizeStructuredValueValue<K extends StructuredValueKind>(
  kind: K,
  value: unknown,
): StructuredValueByKind[K] {
  switch (kind) {
    case "duration":
      return normalizeDurationInput(value) as StructuredValueByKind[K];
    case "money":
      return normalizeMoneyInput(value) as StructuredValueByKind[K];
    case "percent":
      return normalizePercentInput(value) as StructuredValueByKind[K];
    case "quantity":
      return normalizeQuantityInput(value) as StructuredValueByKind[K];
  }
}

export function normalizeStructuredValuePart(value: unknown): StructuredValuePart {
  const input = expectRecordInput(value);
  const kind = normalizeStructuredValueKind(input.kind);
  return {
    kind,
    value: normalizeStructuredValueValue(kind, input.value),
  };
}

export function formatStructuredValue<K extends StructuredValueKind>(
  kind: K,
  value: StructuredValueByKind[K],
): string {
  switch (kind) {
    case "duration":
      return formatDuration(value as number);
    case "money":
      return formatMoney(value as MoneyValue);
    case "percent":
      return formatPercent(value as number);
    case "quantity":
      return formatQuantity(value as QuantityValue);
  }
}

export function formatStructuredValuePart(value: StructuredValuePart): string {
  return formatStructuredValue(value.kind, value.value as never);
}

export function formatStructuredValueLiteral<K extends StructuredValueKind>(
  kind: K,
  value: StructuredValueByKind[K],
): string {
  return `${kind}(${formatStructuredValue(kind, value)})`;
}

export function formatStructuredValuePartLiteral(value: StructuredValuePart): string {
  return formatStructuredValueLiteral(value.kind, value.value as never);
}

export function parseStructuredValuePart(raw: string): StructuredValuePart {
  const normalized = raw.trim();
  const match = normalized.match(/^([a-z]+)\((.*)\)$/i);
  if (!match) {
    throw new Error(`Invalid structured value "${raw}"`);
  }

  const kind = normalizeStructuredValueKind(match[1]);
  const inner = match[2]?.trim() ?? "";
  switch (kind) {
    case "duration":
      return { kind, value: parseDuration(inner) };
    case "money":
      return { kind, value: parseMoney(inner) };
    case "percent":
      return { kind, value: parsePercent(inner) };
    case "quantity":
      return { kind, value: parseQuantity(inner) };
  }
}

export function splitTopLevel(raw: string, delimiter: string): readonly [string, string] {
  const normalized = raw.trim();
  let depth = 0;

  for (let index = 0; index <= normalized.length - delimiter.length; index += 1) {
    const token = normalized[index];
    if (token === "(") {
      depth += 1;
      continue;
    }
    if (token === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0 || normalized.slice(index, index + delimiter.length) !== delimiter) {
      continue;
    }

    const left = normalized.slice(0, index).trim();
    const right = normalized.slice(index + delimiter.length).trim();
    if (left.length > 0 && right.length > 0) {
      return [left, right];
    }
  }

  throw new Error(`Could not split "${raw}" by "${delimiter}".`);
}

export function compareStructuredValueValues<K extends StructuredValueKind>(
  kind: K,
  left: StructuredValueByKind[K],
  right: StructuredValueByKind[K],
): number {
  switch (kind) {
    case "duration":
    case "percent":
      return (left as number) - (right as number);
    case "money": {
      const leftMoney = left as MoneyValue;
      const rightMoney = right as MoneyValue;
      if (leftMoney.currency !== rightMoney.currency) {
        throw new Error("Money values must share the same currency.");
      }
      return leftMoney.amount - rightMoney.amount;
    }
    case "quantity": {
      const leftQuantity = left as QuantityValue;
      const rightQuantity = right as QuantityValue;
      if (leftQuantity.unit !== rightQuantity.unit) {
        throw new Error("Quantity values must share the same unit.");
      }
      return leftQuantity.amount - rightQuantity.amount;
    }
  }
}

export function structuredValuePartEquals(
  left: StructuredValuePart,
  right: StructuredValuePart,
): boolean {
  if (left.kind !== right.kind) return false;

  try {
    return compareStructuredValueValues(left.kind, left.value as never, right.value as never) === 0;
  } catch {
    return false;
  }
}

export function getStructuredValueMagnitude(value: StructuredValuePart): number {
  switch (value.kind) {
    case "duration":
    case "percent":
      return value.value as number;
    case "money":
      return (value.value as MoneyValue).amount;
    case "quantity":
      return (value.value as QuantityValue).amount;
  }
}

export function normalizeStructuredValueDraftKind(value: string | null): StructuredValueKind {
  return value && isStructuredValueKind(value) ? value : "quantity";
}

export function normalizeDurationUnitKey(value: string | null): DurationUnitKey {
  return value && durationUnitKeys.has(value as DurationUnitKey)
    ? (value as DurationUnitKey)
    : defaultDurationUnitKey;
}

export function normalizeMoneyCurrencyKey(value: string | null): MoneyCurrencyKey {
  return value && moneyCurrencyKeys.has(value as MoneyCurrencyKey)
    ? (value as MoneyCurrencyKey)
    : defaultMoneyCurrencyKey;
}

export function formatStructuredEditorPrimaryValue(value: StructuredValuePart | undefined): string {
  if (!value) return "";

  switch (value.kind) {
    case "duration":
      return decomposeDuration(value.value as number).amount;
    case "money":
      return String((value.value as MoneyValue).amount);
    case "percent":
      return formatPercentInputValue(value.value as number);
    case "quantity":
      return String((value.value as QuantityValue).amount);
  }
}
