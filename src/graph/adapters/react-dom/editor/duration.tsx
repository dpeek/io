import { InputGroup, InputGroupInput } from "@io/web/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@io/web/select";
import { useEffect, useState } from "react";

import {
  convertDurationAmount,
  decomposeDuration,
  defaultDurationUnitKey,
  durationUnits,
  formatDurationAmount,
  type DurationUnitKey,
} from "../../../modules/core/duration/index.js";
import { performValidatedMutation, usePredicateField } from "../../../runtime/react/index.js";
import {
  createFormattedFieldViewCapability,
  clearOrRejectRequiredValue,
  setPredicateValue,
  useFieldMutationCallbacks,
  validatePredicateValue,
  type AnyFieldProps,
} from "./shared.js";

const durationUnitKeys = new Set(durationUnits.map((unit) => unit.key));

function isDurationUnitKey(value: string): value is DurationUnitKey {
  return durationUnitKeys.has(value as DurationUnitKey);
}

function normalizeCommittedDuration(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function parseDraftAmount(raw: string): number | undefined {
  if (raw.trim().length === 0) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export const durationFieldViewCapability = createFormattedFieldViewCapability("number/duration");

export function DurationFieldEditor({
  onMutationError,
  onMutationSuccess,
  predicate,
}: AnyFieldProps) {
  const callbacks = useFieldMutationCallbacks({ onMutationError, onMutationSuccess });
  const { value } = usePredicateField(predicate);
  const committedValue = normalizeCommittedDuration(value);
  const [draftAmount, setDraftAmount] = useState(
    committedValue === undefined ? "" : decomposeDuration(committedValue).amount,
  );
  const [draftUnit, setDraftUnit] = useState<DurationUnitKey>(
    committedValue === undefined
      ? defaultDurationUnitKey
      : decomposeDuration(committedValue).unit.key,
  );
  const [isInvalid, setIsInvalid] = useState(false);

  useEffect(() => {
    if (committedValue === undefined) {
      setDraftAmount("");
      setDraftUnit(defaultDurationUnitKey);
    } else {
      const next = decomposeDuration(committedValue);
      setDraftAmount(next.amount);
      setDraftUnit(next.unit.key);
    }
    setIsInvalid(false);
  }, [committedValue]);

  function commitDuration(nextAmount: string, nextUnit: DurationUnitKey): void {
    setDraftAmount(nextAmount);
    setDraftUnit(nextUnit);

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

    const nextValue = convertDurationAmount(parsedAmount, nextUnit);
    const committed = performValidatedMutation(
      callbacks,
      () => validatePredicateValue(predicate, nextValue),
      () => setPredicateValue(predicate, nextValue),
    );
    setIsInvalid(!committed);
  }

  function handleUnitChange(nextValue: string | null): void {
    const nextUnit = nextValue && isDurationUnitKey(nextValue) ? nextValue : defaultDurationUnitKey;
    const parsedAmount = parseDraftAmount(draftAmount);

    if (parsedAmount === undefined) {
      setDraftUnit(nextUnit);
      setIsInvalid(draftAmount.trim().length > 0);
      return;
    }

    const nextDuration = convertDurationAmount(parsedAmount, draftUnit);
    const normalizedAmount = formatDurationAmount(nextDuration, nextUnit);
    commitDuration(normalizedAmount, nextUnit);
  }

  return (
    <div className="flex min-w-0 items-center gap-2" data-web-field-kind="number/duration">
      <InputGroup className="min-w-0 flex-1">
        <InputGroupInput
          aria-invalid={isInvalid || undefined}
          inputMode="decimal"
          onChange={(event) => commitDuration(event.target.value, draftUnit)}
          step="any"
          type="number"
          value={draftAmount}
        />
      </InputGroup>
      <Select onValueChange={handleUnitChange} value={draftUnit}>
        <SelectTrigger className="w-24 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {durationUnits.map((unit) => (
            <SelectItem key={unit.key} value={unit.key}>
              {unit.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
