import { InputGroup, InputGroupInput } from "@io/web/input-group";
import { useEffect, useState } from "react";

import type { QuantityValue } from "../../../modules/core/quantity/index.js";
import { performValidatedMutation, usePredicateField } from "../../../runtime/react/index.js";
import {
  createFormattedFieldViewCapability,
  clearOrRejectRequiredValue,
  setPredicateValue,
  useFieldMutationCallbacks,
  validatePredicateValue,
  type AnyFieldProps,
} from "./shared.js";

function normalizeCommittedQuantity(value: unknown): QuantityValue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<QuantityValue>;
  if (typeof candidate.amount !== "number" || typeof candidate.unit !== "string") {
    return undefined;
  }
  return {
    amount: candidate.amount,
    unit: candidate.unit,
  };
}

function parseDraftAmount(raw: string): number | undefined {
  if (raw.trim().length === 0) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export const quantityFieldViewCapability = createFormattedFieldViewCapability("number/quantity");

export function QuantityFieldEditor({
  onMutationError,
  onMutationSuccess,
  predicate,
}: AnyFieldProps) {
  const callbacks = useFieldMutationCallbacks({ onMutationError, onMutationSuccess });
  const { value } = usePredicateField(predicate);
  const committedValue = normalizeCommittedQuantity(value);
  const [draftAmount, setDraftAmount] = useState(
    committedValue === undefined ? "" : String(committedValue.amount),
  );
  const [draftUnit, setDraftUnit] = useState(committedValue?.unit ?? "");
  const [isInvalid, setIsInvalid] = useState(false);

  useEffect(() => {
    if (committedValue === undefined) {
      setDraftAmount("");
      setDraftUnit("");
    } else {
      setDraftAmount(String(committedValue.amount));
      setDraftUnit(committedValue.unit);
    }
    setIsInvalid(false);
  }, [committedValue]);

  function commitQuantity(nextAmount: string, nextUnit: string): void {
    setDraftAmount(nextAmount);
    setDraftUnit(nextUnit);

    const normalizedUnit = nextUnit.trim();
    if (nextAmount === "" && normalizedUnit.length === 0) {
      const cleared = clearOrRejectRequiredValue(predicate, callbacks);
      setIsInvalid(!cleared);
      return;
    }

    const parsedAmount = parseDraftAmount(nextAmount);
    if (parsedAmount === undefined || normalizedUnit.length === 0) {
      setIsInvalid(nextAmount.trim().length > 0 || normalizedUnit.length > 0);
      return;
    }

    const committed = performValidatedMutation(
      callbacks,
      () => validatePredicateValue(predicate, { amount: parsedAmount, unit: normalizedUnit }),
      () => setPredicateValue(predicate, { amount: parsedAmount, unit: normalizedUnit }),
    );
    setIsInvalid(!committed);
  }

  return (
    <div className="flex min-w-0 items-center gap-2" data-web-field-kind="number/quantity">
      <InputGroup className="min-w-0 flex-1">
        <InputGroupInput
          aria-invalid={isInvalid || undefined}
          inputMode="decimal"
          onChange={(event) => commitQuantity(event.target.value, draftUnit)}
          step="any"
          type="number"
          value={draftAmount}
        />
      </InputGroup>
      <InputGroup className="w-28 shrink-0">
        <InputGroupInput
          aria-invalid={isInvalid || undefined}
          onChange={(event) => commitQuantity(draftAmount, event.target.value)}
          placeholder="unit"
          type="text"
          value={draftUnit}
        />
      </InputGroup>
    </div>
  );
}
