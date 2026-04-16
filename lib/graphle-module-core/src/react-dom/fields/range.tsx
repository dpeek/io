import { performValidatedMutation, usePredicateField } from "@dpeek/graphle-react";
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldTitle,
} from "@dpeek/graphle-web-ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dpeek/graphle-web-ui/select";
import { useEffect, useState } from "react";

import { normalizeRangeInput, type RangeValue } from "../../core/range.js";
import {
  getStructuredValueKindLabel,
  structuredValueKinds,
  type StructuredValueKind,
} from "../../core/structured-value.js";
import {
  clearOrRejectRequiredValue,
  createFormattedFieldViewCapability,
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
    <div className="grid min-w-0 gap-3" data-web-field-kind="number/range">
      <FieldGroup className="gap-3">
        <Field data-invalid={isInvalid || undefined} orientation="responsive">
          <FieldTitle className="text-muted-foreground w-12 shrink-0 text-[11px] font-medium tracking-[0.16em] uppercase">
            Kind
          </FieldTitle>
          <FieldContent className="min-w-0">
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
          </FieldContent>
        </Field>
        <Field data-invalid={isInvalid || undefined} orientation="responsive">
          <FieldTitle className="text-muted-foreground w-12 shrink-0 text-[11px] font-medium tracking-[0.16em] uppercase">
            Min
          </FieldTitle>
          <FieldContent className="min-w-0" data-web-range-slot="min">
            <StructuredValuePartEditorFields
              draft={{ ...minDraft, kind: rangeKind }}
              invalid={isInvalid}
              onChange={(next) => commitRange(rangeKind, { ...next, kind: rangeKind }, maxDraft)}
              showKindSelect={false}
            />
          </FieldContent>
        </Field>
        <Field data-invalid={isInvalid || undefined} orientation="responsive">
          <FieldTitle className="text-muted-foreground w-12 shrink-0 text-[11px] font-medium tracking-[0.16em] uppercase">
            Max
          </FieldTitle>
          <FieldContent className="min-w-0" data-web-range-slot="max">
            <StructuredValuePartEditorFields
              draft={{ ...maxDraft, kind: rangeKind }}
              invalid={isInvalid}
              onChange={(next) => commitRange(rangeKind, minDraft, { ...next, kind: rangeKind })}
              showKindSelect={false}
            />
          </FieldContent>
        </Field>
      </FieldGroup>
      {isInvalid ? (
        <FieldError>Enter a complete range with valid minimum and maximum values.</FieldError>
      ) : null}
    </div>
  );
}
