import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@io/web/select";
import { useEffect, useState } from "react";

import { normalizeRangeInput, type RangeValue } from "../../../modules/core/range/index.js";
import {
  getStructuredValueKindLabel,
  structuredValueKinds,
  type StructuredValueKind,
} from "../../../modules/core/structured-value.js";
import { performValidatedMutation, usePredicateField } from "../../../runtime/react/index.js";
import {
  createFormattedFieldViewCapability,
  clearOrRejectRequiredValue,
  setPredicateValue,
  useFieldMutationCallbacks,
  validatePredicateValue,
  type AnyFieldProps,
} from "./shared.js";
import {
  createStructuredValueDraft,
  normalizeStructuredValueDraftKind,
  parseStructuredValueDraft,
  StructuredValuePartEditorFields,
  structuredValueDraftDefaults,
  type StructuredValueDraft,
} from "./structured-value.js";

function normalizeCommittedRange(value: unknown): RangeValue | undefined {
  try {
    return normalizeRangeInput(value);
  } catch {
    return undefined;
  }
}

export const rangeFieldViewCapability = createFormattedFieldViewCapability("number/range");

export function RangeFieldEditor({ onMutationError, onMutationSuccess, predicate }: AnyFieldProps) {
  const callbacks = useFieldMutationCallbacks({ onMutationError, onMutationSuccess });
  const { value } = usePredicateField(predicate);
  const committedValue = normalizeCommittedRange(value);
  const [rangeKind, setRangeKind] = useState<StructuredValueKind>(
    committedValue?.kind ?? structuredValueDraftDefaults.range,
  );
  const [minDraft, setMinDraft] = useState<StructuredValueDraft>(
    createStructuredValueDraft(
      committedValue ? { kind: committedValue.kind, value: committedValue.min } : undefined,
      committedValue?.kind ?? structuredValueDraftDefaults.range,
    ),
  );
  const [maxDraft, setMaxDraft] = useState<StructuredValueDraft>(
    createStructuredValueDraft(
      committedValue ? { kind: committedValue.kind, value: committedValue.max } : undefined,
      committedValue?.kind ?? structuredValueDraftDefaults.range,
    ),
  );
  const [isInvalid, setIsInvalid] = useState(false);

  useEffect(() => {
    const nextKind = committedValue?.kind ?? structuredValueDraftDefaults.range;
    setRangeKind(nextKind);
    setMinDraft(
      createStructuredValueDraft(
        committedValue ? { kind: committedValue.kind, value: committedValue.min } : undefined,
        nextKind,
      ),
    );
    setMaxDraft(
      createStructuredValueDraft(
        committedValue ? { kind: committedValue.kind, value: committedValue.max } : undefined,
        nextKind,
      ),
    );
    setIsInvalid(false);
  }, [committedValue]);

  function commitRange(
    nextKind: StructuredValueKind,
    nextMin: StructuredValueDraft,
    nextMax: StructuredValueDraft,
  ): void {
    setRangeKind(nextKind);
    setMinDraft(nextMin);
    setMaxDraft(nextMax);

    try {
      const min = parseStructuredValueDraft({ ...nextMin, kind: nextKind });
      const max = parseStructuredValueDraft({ ...nextMax, kind: nextKind });

      if (!min && !max) {
        const cleared = clearOrRejectRequiredValue(predicate, callbacks);
        setIsInvalid(!cleared);
        return;
      }

      if (!min || !max) {
        setIsInvalid(true);
        return;
      }

      const nextValue = { kind: nextKind, min: min.value, max: max.value };
      const committed = performValidatedMutation(
        callbacks,
        () => validatePredicateValue(predicate, nextValue),
        () => setPredicateValue(predicate, nextValue),
      );
      setIsInvalid(!committed);
    } catch {
      setIsInvalid(true);
    }
  }

  function handleKindChange(nextValue: string | null): void {
    const nextKind = normalizeStructuredValueDraftKind(nextValue);
    setRangeKind(nextKind);
    setMinDraft(createStructuredValueDraft(undefined, nextKind));
    setMaxDraft(createStructuredValueDraft(undefined, nextKind));
    setIsInvalid(false);
  }

  return (
    <div className="grid min-w-0 gap-2" data-web-field-kind="number/range">
      <div className="flex min-w-0 items-center gap-2">
        <label className="text-muted-foreground w-12 shrink-0 text-[11px] font-medium tracking-[0.16em] uppercase">
          Kind
        </label>
        <Select onValueChange={handleKindChange} value={rangeKind}>
          <SelectTrigger aria-invalid={isInvalid || undefined} className="w-32 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {structuredValueKinds.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {getStructuredValueKindLabel(kind)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <label className="text-muted-foreground w-12 shrink-0 text-[11px] font-medium tracking-[0.16em] uppercase">
          Min
        </label>
        <div className="min-w-0 flex-1" data-web-range-slot="min">
          <StructuredValuePartEditorFields
            draft={{ ...minDraft, kind: rangeKind }}
            invalid={isInvalid}
            onChange={(next) => commitRange(rangeKind, { ...next, kind: rangeKind }, maxDraft)}
            showKindSelect={false}
          />
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <label className="text-muted-foreground w-12 shrink-0 text-[11px] font-medium tracking-[0.16em] uppercase">
          Max
        </label>
        <div className="min-w-0 flex-1" data-web-range-slot="max">
          <StructuredValuePartEditorFields
            draft={{ ...maxDraft, kind: rangeKind }}
            invalid={isInvalid}
            onChange={(next) => commitRange(rangeKind, minDraft, { ...next, kind: rangeKind })}
            showKindSelect={false}
          />
        </div>
      </div>
      {isInvalid ? <span className="sr-only">Invalid range value</span> : null}
    </div>
  );
}
