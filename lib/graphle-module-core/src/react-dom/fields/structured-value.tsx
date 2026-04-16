import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@dpeek/graphle-web-ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dpeek/graphle-web-ui/select";

import {
  convertDurationAmount,
  defaultDurationUnitKey,
  decomposeDuration,
  durationUnits,
  normalizeDurationInput,
  type DurationUnitKey,
} from "../../core/duration.js";
import {
  defaultMoneyCurrencyKey,
  moneyCurrencies,
  normalizeMoneyInput,
  type MoneyCurrencyKey,
} from "../../core/money.js";
import { normalizePercentInput } from "../../core/percent.js";
import { normalizeQuantityInput } from "../../core/quantity.js";
import {
  formatStructuredEditorPrimaryValue,
  normalizeDurationUnitKey,
  normalizeMoneyCurrencyKey,
  normalizeStructuredValueDraftKind,
  structuredValueKindOptions,
  type StructuredValueKind,
  type StructuredValuePart,
} from "../../core/structured-value.js";

export type StructuredValueDraft = Readonly<{
  kind: StructuredValueKind;
  primary: string;
  secondary: string;
}>;

export function createStructuredValueDraft(
  value: StructuredValuePart | undefined,
  fallbackKind: StructuredValueKind,
): StructuredValueDraft {
  const kind = value?.kind ?? fallbackKind;

  switch (kind) {
    case "duration": {
      const durationValue =
        value?.kind === "duration" ? (value as StructuredValuePart<"duration">) : undefined;
      return {
        kind,
        primary: formatStructuredEditorPrimaryValue(durationValue),
        secondary: durationValue
          ? decomposeDuration(durationValue.value).unit.key
          : defaultDurationUnitKey,
      };
    }
    case "money": {
      const moneyValue =
        value?.kind === "money" ? (value as StructuredValuePart<"money">) : undefined;
      return {
        kind,
        primary: formatStructuredEditorPrimaryValue(moneyValue),
        secondary: moneyValue ? moneyValue.value.currency : defaultMoneyCurrencyKey,
      };
    }
    case "percent": {
      const percentValue =
        value?.kind === "percent" ? (value as StructuredValuePart<"percent">) : undefined;
      return {
        kind,
        primary: formatStructuredEditorPrimaryValue(percentValue),
        secondary: "",
      };
    }
    case "quantity": {
      const quantityValue =
        value?.kind === "quantity" ? (value as StructuredValuePart<"quantity">) : undefined;
      return {
        kind,
        primary: formatStructuredEditorPrimaryValue(quantityValue),
        secondary: quantityValue ? quantityValue.value.unit : "",
      };
    }
  }
}

export function hasStructuredValueDraftInput(value: StructuredValueDraft): boolean {
  if (value.kind === "quantity") {
    return value.primary.trim().length > 0 || value.secondary.trim().length > 0;
  }

  return value.primary.trim().length > 0;
}

export function parseStructuredValueDraft(
  value: StructuredValueDraft,
): StructuredValuePart | undefined {
  const primary = value.primary.trim();

  switch (value.kind) {
    case "duration": {
      if (primary.length === 0) return undefined;
      const amount = Number(primary);
      if (!Number.isFinite(amount)) {
        throw new Error("Duration values must be numeric.");
      }
      return {
        kind: value.kind,
        value: normalizeDurationInput(
          convertDurationAmount(amount, normalizeDurationUnitKey(value.secondary)),
        ),
      };
    }
    case "money": {
      if (primary.length === 0) return undefined;
      const amount = Number(primary);
      if (!Number.isFinite(amount)) {
        throw new Error("Money values must be numeric.");
      }
      return {
        kind: value.kind,
        value: normalizeMoneyInput({
          amount,
          currency: normalizeMoneyCurrencyKey(value.secondary),
        }),
      };
    }
    case "percent": {
      if (primary.length === 0) return undefined;
      const percent = Number(primary);
      if (!Number.isFinite(percent)) {
        throw new Error("Percent values must be numeric.");
      }
      return {
        kind: value.kind,
        value: normalizePercentInput(percent),
      };
    }
    case "quantity": {
      const unit = value.secondary.trim();
      if (primary.length === 0 && unit.length === 0) return undefined;
      if (primary.length === 0 || unit.length === 0) {
        throw new Error("Quantity values need both amount and unit.");
      }
      const amount = Number(primary);
      if (!Number.isFinite(amount)) {
        throw new Error("Quantity values must be numeric.");
      }
      return {
        kind: value.kind,
        value: normalizeQuantityInput({ amount, unit }),
      };
    }
  }
}

type StructuredValuePartEditorFieldsProps = {
  draft: StructuredValueDraft;
  invalid?: boolean;
  kindOptions?: readonly StructuredValueKind[];
  onChange: (value: StructuredValueDraft) => void;
  showKindSelect?: boolean;
};

export function StructuredValuePartEditorFields({
  draft,
  invalid = false,
  kindOptions = structuredValueKindOptions.map((option) => option.kind),
  onChange,
  showKindSelect = true,
}: StructuredValuePartEditorFieldsProps) {
  return (
    <div className="flex min-w-0 items-center gap-2" data-web-structured-value-kind={draft.kind}>
      {showKindSelect ? (
        <Select
          onValueChange={(value) =>
            onChange(
              createStructuredValueDraft(undefined, normalizeStructuredValueDraftKind(value)),
            )
          }
          value={draft.kind}
        >
          <SelectTrigger aria-invalid={invalid || undefined} className="w-32 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {kindOptions.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {structuredValueKindOptions.find((option) => option.kind === kind)?.label ?? kind}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {draft.kind === "duration" ? (
        <DurationValueFields draft={draft} invalid={invalid} onChange={onChange} />
      ) : draft.kind === "money" ? (
        <MoneyValueFields draft={draft} invalid={invalid} onChange={onChange} />
      ) : draft.kind === "percent" ? (
        <PercentValueFields draft={draft} invalid={invalid} onChange={onChange} />
      ) : (
        <QuantityValueFields draft={draft} invalid={invalid} onChange={onChange} />
      )}
    </div>
  );
}

function DurationValueFields({
  draft,
  invalid,
  onChange,
}: {
  draft: StructuredValueDraft;
  invalid: boolean;
  onChange: (value: StructuredValueDraft) => void;
}) {
  const unit = normalizeDurationUnitKey(draft.secondary);

  return (
    <>
      <InputGroup className="min-w-0 flex-1">
        <InputGroupInput
          aria-invalid={invalid || undefined}
          inputMode="decimal"
          onChange={(event) => onChange({ ...draft, primary: event.target.value })}
          step="any"
          type="number"
          value={draft.primary}
        />
      </InputGroup>
      <Select
        onValueChange={(value) =>
          onChange({ ...draft, secondary: normalizeDurationUnitKey(value) })
        }
        value={unit}
      >
        <SelectTrigger aria-invalid={invalid || undefined} className="w-24 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {durationUnits.map((option) => (
            <SelectItem key={option.key} value={option.key}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

function MoneyValueFields({
  draft,
  invalid,
  onChange,
}: {
  draft: StructuredValueDraft;
  invalid: boolean;
  onChange: (value: StructuredValueDraft) => void;
}) {
  const currency = normalizeMoneyCurrencyKey(draft.secondary);

  return (
    <>
      <InputGroup className="min-w-0 flex-1">
        <InputGroupInput
          aria-invalid={invalid || undefined}
          inputMode="decimal"
          onChange={(event) => onChange({ ...draft, primary: event.target.value })}
          step="any"
          type="number"
          value={draft.primary}
        />
      </InputGroup>
      <Select
        onValueChange={(value) =>
          onChange({ ...draft, secondary: normalizeMoneyCurrencyKey(value) })
        }
        value={currency}
      >
        <SelectTrigger aria-invalid={invalid || undefined} className="w-40 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {moneyCurrencies.map((option) => (
            <SelectItem key={option.key} value={option.key}>
              {option.code} · {option.name ?? option.key.toUpperCase()}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

function PercentValueFields({
  draft,
  invalid,
  onChange,
}: {
  draft: StructuredValueDraft;
  invalid: boolean;
  onChange: (value: StructuredValueDraft) => void;
}) {
  return (
    <InputGroup className="min-w-0 flex-1">
      <InputGroupInput
        aria-invalid={invalid || undefined}
        inputMode="decimal"
        max={100}
        min={0}
        onChange={(event) => onChange({ ...draft, primary: event.target.value })}
        step="any"
        type="number"
        value={draft.primary}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupText>%</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  );
}

function QuantityValueFields({
  draft,
  invalid,
  onChange,
}: {
  draft: StructuredValueDraft;
  invalid: boolean;
  onChange: (value: StructuredValueDraft) => void;
}) {
  return (
    <>
      <InputGroup className="min-w-0 flex-1">
        <InputGroupInput
          aria-invalid={invalid || undefined}
          inputMode="decimal"
          onChange={(event) => onChange({ ...draft, primary: event.target.value })}
          step="any"
          type="number"
          value={draft.primary}
        />
      </InputGroup>
      <InputGroup className="w-28 shrink-0">
        <InputGroupInput
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange({ ...draft, secondary: event.target.value })}
          placeholder="unit"
          type="text"
          value={draft.secondary}
        />
      </InputGroup>
    </>
  );
}

export const structuredValueDraftDefaults = {
  denominator: "duration" as const,
  numerator: "quantity" as const,
  range: "quantity" as const,
};

export { normalizeStructuredValueDraftKind };
export type { DurationUnitKey, MoneyCurrencyKey };
