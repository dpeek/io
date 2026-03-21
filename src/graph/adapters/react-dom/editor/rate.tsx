import { useEffect, useState } from "react";

import { normalizeRateInput, type RateValue } from "../../../modules/core/rate/index.js";
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
  parseStructuredValueDraft,
  StructuredValuePartEditorFields,
  structuredValueDraftDefaults,
  type StructuredValueDraft,
} from "./structured-value.js";

function normalizeCommittedRate(value: unknown): RateValue | undefined {
  try {
    return normalizeRateInput(value);
  } catch {
    return undefined;
  }
}

export const rateFieldViewCapability = createFormattedFieldViewCapability("number/rate");

export function RateFieldEditor({ onMutationError, onMutationSuccess, predicate }: AnyFieldProps) {
  const callbacks = useFieldMutationCallbacks({ onMutationError, onMutationSuccess });
  const { value } = usePredicateField(predicate);
  const committedValue = normalizeCommittedRate(value);
  const [numeratorDraft, setNumeratorDraft] = useState<StructuredValueDraft>(
    createStructuredValueDraft(committedValue?.numerator, structuredValueDraftDefaults.numerator),
  );
  const [denominatorDraft, setDenominatorDraft] = useState<StructuredValueDraft>(
    createStructuredValueDraft(
      committedValue?.denominator,
      structuredValueDraftDefaults.denominator,
    ),
  );
  const [isInvalid, setIsInvalid] = useState(false);

  useEffect(() => {
    setNumeratorDraft(
      createStructuredValueDraft(committedValue?.numerator, structuredValueDraftDefaults.numerator),
    );
    setDenominatorDraft(
      createStructuredValueDraft(
        committedValue?.denominator,
        structuredValueDraftDefaults.denominator,
      ),
    );
    setIsInvalid(false);
  }, [committedValue]);

  function commitRate(
    nextNumerator: StructuredValueDraft,
    nextDenominator: StructuredValueDraft,
  ): void {
    setNumeratorDraft(nextNumerator);
    setDenominatorDraft(nextDenominator);

    try {
      const numerator = parseStructuredValueDraft(nextNumerator);
      const denominator = parseStructuredValueDraft(nextDenominator);

      if (!numerator && !denominator) {
        const cleared = clearOrRejectRequiredValue(predicate, callbacks);
        setIsInvalid(!cleared);
        return;
      }

      if (!numerator || !denominator) {
        setIsInvalid(true);
        return;
      }

      const nextValue = { numerator, denominator };
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

  return (
    <div className="grid min-w-0 gap-2" data-web-field-kind="number/rate">
      <div data-web-rate-slot="numerator">
        <StructuredValuePartEditorFields
          draft={numeratorDraft}
          invalid={isInvalid}
          onChange={(next) => commitRate(next, denominatorDraft)}
        />
      </div>
      <div className="text-muted-foreground px-1 text-[11px] font-medium tracking-[0.16em] uppercase">
        per
      </div>
      <div data-web-rate-slot="denominator">
        <StructuredValuePartEditorFields
          draft={denominatorDraft}
          invalid={isInvalid}
          onChange={(next) => commitRate(numeratorDraft, next)}
        />
      </div>
      {isInvalid ? <span className="sr-only">Invalid rate value</span> : null}
    </div>
  );
}
