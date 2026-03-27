import { defineScalar } from "@io/graph-module";
import type { EnumModuleValue } from "@io/graph-module";
import type { TypeModuleFilter } from "@io/graph-module";
import type { TypeModuleMeta } from "@io/graph-module";
import { defineScalarModule } from "@io/graph-module";

import { currency } from "./currency.js";
import { expectNumberInput, expectRecordInput, expectStringInput } from "./input.js";
import { numberType } from "./number.js";

export type MoneyCurrencyKey = EnumModuleValue<typeof currency>;

export type MoneyValue = Readonly<{
  amount: number;
  currency: MoneyCurrencyKey;
}>;

type CurrencyOption = {
  key: MoneyCurrencyKey;
  code: string;
  name?: string;
};

export const moneyCurrencies = Object.values(currency.options).map((option) => ({
  key: option.key as MoneyCurrencyKey,
  code: (option as { code: string }).code,
  name: option.name,
})) satisfies readonly CurrencyOption[];

export const defaultMoneyCurrencyKey = (moneyCurrencies[0]?.key ?? "usd") as MoneyCurrencyKey;

const currencyByKey = new Map<MoneyCurrencyKey, CurrencyOption>(
  moneyCurrencies.map((option) => [option.key, option]),
);

const currencyByToken = new Map<string, MoneyCurrencyKey>(
  moneyCurrencies.flatMap((option) => [
    [option.key, option.key] as const,
    [option.code.toLowerCase(), option.key] as const,
  ]),
);

function formatDecimal(value: number, maximumFractionDigits: number): string {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Number(value.toFixed(maximumFractionDigits));
  return String(rounded);
}

function getCurrencyOption(key: MoneyCurrencyKey): CurrencyOption {
  const option = currencyByKey.get(key);
  if (!option) {
    throw new Error(`Unknown currency "${key}".`);
  }
  return option;
}

function normalizeMoneyAmount(value: unknown): number {
  const amount = expectNumberInput(value);
  if (!Number.isFinite(amount)) {
    throw new Error("Money amounts must be finite.");
  }
  return amount;
}

function normalizeMoneyCurrency(value: unknown): MoneyCurrencyKey {
  const token = expectStringInput(value).trim().toLowerCase();
  const currencyKey = currencyByToken.get(token);
  if (!currencyKey) {
    throw new Error(`Unknown currency "${value}".`);
  }
  return currencyKey;
}

export function normalizeMoneyInput(value: unknown): MoneyValue {
  const input = expectRecordInput(value);
  return {
    amount: normalizeMoneyAmount(input.amount),
    currency: normalizeMoneyCurrency(input.currency),
  };
}

export function parseMoney(raw: string): MoneyValue {
  const normalized = raw.trim();
  const match = normalized.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))\s+([a-z]{3})$/i);
  if (!match) {
    throw new Error(`Invalid money value "${raw}"`);
  }

  return {
    amount: normalizeMoneyAmount(Number(match[1])),
    currency: normalizeMoneyCurrency(match[2]),
  };
}

export function decodeMoney(raw: string): MoneyValue {
  return normalizeMoneyInput(JSON.parse(raw) as unknown);
}

export function formatMoneyAmount(value: number): string {
  return formatDecimal(value, 6);
}

export function formatMoney(value: MoneyValue): string {
  return `${formatMoneyAmount(value.amount)} ${getCurrencyOption(value.currency).code}`;
}

export function formatMoneyEditorValue(value: MoneyValue): string {
  return formatMoney(value);
}

export const moneyType = defineScalar({
  values: { key: "core:money", name: "Money", icon: numberType.values.icon },
  encode: (value: MoneyValue) => JSON.stringify(normalizeMoneyInput(value)),
  decode: (raw) => decodeMoney(raw),
  validate: ({ value }) => {
    try {
      normalizeMoneyInput(value);
    } catch (error) {
      return {
        code: "money.invalid",
        message: error instanceof Error ? error.message : "Money values are invalid.",
      };
    }

    return undefined;
  },
});

export const moneyFilter = {
  defaultOperator: "equals",
  operators: {
    equals: {
      label: "Equals",
      operand: {
        kind: "string",
        placeholder: "12 USD",
      },
      parse: parseMoney,
      format: (operand: MoneyValue) => formatMoney(operand),
      test: (value: MoneyValue, operand: MoneyValue) =>
        value.amount === operand.amount && value.currency === operand.currency,
    },
  },
} satisfies TypeModuleFilter<MoneyValue>;

export const moneyMeta = {
  summary: {
    kind: "value",
    format: formatMoney,
  },
  display: {
    kind: "money/amount",
    allowed: ["money/amount", "text"] as const,
    format: formatMoney,
  },
  editor: {
    kind: "money/amount",
    allowed: ["money/amount", "text"] as const,
    inputMode: "decimal",
    placeholder: "12 USD",
    parse: parseMoney,
    format: formatMoneyEditorValue,
  },
} satisfies TypeModuleMeta<
  MoneyValue,
  readonly ["money/amount", "text"],
  readonly ["money/amount", "text"]
>;

export const moneyTypeModule = defineScalarModule({
  type: moneyType,
  meta: moneyMeta,
  filter: moneyFilter,
});
