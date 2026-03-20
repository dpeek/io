import { defineScalarModule } from "../../../graph/type-module.js";
import { moneyFilter } from "./filter.js";
import { moneyMeta } from "./meta.js";
import {
  decodeMoney,
  defaultMoneyCurrencyKey,
  formatMoney,
  formatMoneyAmount,
  formatMoneyEditorValue,
  moneyCurrencies,
  moneyType,
  normalizeMoneyInput,
  parseMoney,
  type MoneyCurrencyKey,
  type MoneyValue,
} from "./type.js";

export const moneyTypeModule = defineScalarModule({
  type: moneyType,
  meta: moneyMeta,
  filter: moneyFilter,
});

export {
  decodeMoney,
  defaultMoneyCurrencyKey,
  formatMoney,
  formatMoneyAmount,
  formatMoneyEditorValue,
  moneyCurrencies,
  moneyFilter,
  moneyMeta,
  moneyType,
  normalizeMoneyInput,
  parseMoney,
};
export type { MoneyCurrencyKey, MoneyValue };
