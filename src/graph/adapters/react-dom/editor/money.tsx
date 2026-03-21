import { InputGroup, InputGroupInput } from "@io/web/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@io/web/select";
import { useEffect, useState } from "react";

import {
  defaultMoneyCurrencyKey,
  moneyCurrencies,
  type MoneyCurrencyKey,
  type MoneyValue,
} from "../../../modules/core/money/index.js";
import { performValidatedMutation, usePredicateField } from "../../../runtime/react/index.js";
import {
  createFormattedFieldViewCapability,
  clearOrRejectRequiredValue,
  setPredicateValue,
  useFieldMutationCallbacks,
  validatePredicateValue,
  type AnyFieldProps,
} from "./shared.js";

const moneyCurrencyKeys = new Set(moneyCurrencies.map((currency) => currency.key));

function isMoneyCurrencyKey(value: string): value is MoneyCurrencyKey {
  return moneyCurrencyKeys.has(value as MoneyCurrencyKey);
}

function normalizeCommittedMoney(value: unknown): MoneyValue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<MoneyValue>;
  if (typeof candidate.amount !== "number" || typeof candidate.currency !== "string") {
    return undefined;
  }
  if (!isMoneyCurrencyKey(candidate.currency)) return undefined;
  return {
    amount: candidate.amount,
    currency: candidate.currency,
  };
}

function parseDraftAmount(raw: string): number | undefined {
  if (raw.trim().length === 0) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export const moneyFieldViewCapability = createFormattedFieldViewCapability("money/amount");

export function MoneyFieldEditor({ onMutationError, onMutationSuccess, predicate }: AnyFieldProps) {
  const callbacks = useFieldMutationCallbacks({ onMutationError, onMutationSuccess });
  const { value } = usePredicateField(predicate);
  const committedValue = normalizeCommittedMoney(value);
  const [draftAmount, setDraftAmount] = useState(
    committedValue === undefined ? "" : String(committedValue.amount),
  );
  const [draftCurrency, setDraftCurrency] = useState<MoneyCurrencyKey>(
    committedValue?.currency ?? defaultMoneyCurrencyKey,
  );
  const [isInvalid, setIsInvalid] = useState(false);

  useEffect(() => {
    if (committedValue === undefined) {
      setDraftAmount("");
      setDraftCurrency(defaultMoneyCurrencyKey);
    } else {
      setDraftAmount(String(committedValue.amount));
      setDraftCurrency(committedValue.currency);
    }
    setIsInvalid(false);
  }, [committedValue]);

  function commitMoney(nextAmount: string, nextCurrency: MoneyCurrencyKey): void {
    setDraftAmount(nextAmount);
    setDraftCurrency(nextCurrency);

    if (nextAmount === "") {
      const cleared = clearOrRejectRequiredValue(predicate, callbacks);
      setIsInvalid(!cleared);
      return;
    }

    const parsedAmount = parseDraftAmount(nextAmount);
    if (parsedAmount === undefined) {
      setIsInvalid(true);
      return;
    }

    const committed = performValidatedMutation(
      callbacks,
      () => validatePredicateValue(predicate, { amount: parsedAmount, currency: nextCurrency }),
      () => setPredicateValue(predicate, { amount: parsedAmount, currency: nextCurrency }),
    );
    setIsInvalid(!committed);
  }

  function handleCurrencyChange(nextValue: string | null): void {
    const nextCurrency =
      nextValue && isMoneyCurrencyKey(nextValue) ? nextValue : defaultMoneyCurrencyKey;
    const parsedAmount = parseDraftAmount(draftAmount);

    if (parsedAmount === undefined) {
      setDraftCurrency(nextCurrency);
      setIsInvalid(draftAmount.trim().length > 0);
      return;
    }

    commitMoney(draftAmount, nextCurrency);
  }

  return (
    <div className="flex min-w-0 items-center gap-2" data-web-field-kind="money/amount">
      <InputGroup className="min-w-0 flex-1">
        <InputGroupInput
          aria-invalid={isInvalid || undefined}
          inputMode="decimal"
          onChange={(event) => commitMoney(event.target.value, draftCurrency)}
          step="any"
          type="number"
          value={draftAmount}
        />
      </InputGroup>
      <Select onValueChange={handleCurrencyChange} value={draftCurrency}>
        <SelectTrigger className="w-40 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {moneyCurrencies.map((currency) => (
            <SelectItem key={currency.key} value={currency.key}>
              {currency.code} · {currency.name ?? currency.key.toUpperCase()}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
