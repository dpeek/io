import { defineScalar } from "@io/graph-module";
import type { TypeModuleFilter } from "@io/graph-module";
import type { TypeModuleMeta } from "@io/graph-module";
import { defineScalarModule } from "@io/graph-module";

import { expectRecordInput } from "./input.js";
import { numberType } from "./number.js";
import {
  formatStructuredValuePart,
  formatStructuredValuePartLiteral,
  getStructuredValueMagnitude,
  normalizeStructuredValuePart,
  parseStructuredValuePart,
  splitTopLevel,
  type StructuredValuePart,
} from "./structured-value.js";
import { structuredValuePartEquals } from "./structured-value.js";

export type RateValue = Readonly<{
  numerator: StructuredValuePart;
  denominator: StructuredValuePart;
}>;

function validateRateDenominator(value: StructuredValuePart): void {
  if (getStructuredValueMagnitude(value) <= 0) {
    throw new Error("Rate denominators must be greater than zero.");
  }
}

export function normalizeRateInput(value: unknown): RateValue {
  const input = expectRecordInput(value);
  const denominator = normalizeStructuredValuePart(input.denominator);
  validateRateDenominator(denominator);

  return {
    numerator: normalizeStructuredValuePart(input.numerator),
    denominator,
  };
}

export function parseRate(raw: string): RateValue {
  try {
    const [numeratorRaw, denominatorRaw] = splitTopLevel(raw, "/");
    const denominator = parseStructuredValuePart(denominatorRaw);
    validateRateDenominator(denominator);

    return {
      numerator: parseStructuredValuePart(numeratorRaw),
      denominator,
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Rate denominators")) {
      throw error;
    }
    throw new Error(`Invalid rate value "${raw}"`);
  }
}

export function decodeRate(raw: string): RateValue {
  return normalizeRateInput(JSON.parse(raw) as unknown);
}

export function formatRate(value: RateValue): string {
  return `${formatStructuredValuePart(value.numerator)} / ${formatStructuredValuePart(value.denominator)}`;
}

export function formatRateEditorValue(value: RateValue): string {
  return `${formatStructuredValuePartLiteral(value.numerator)} / ${formatStructuredValuePartLiteral(
    value.denominator,
  )}`;
}

export const rateType = defineScalar({
  values: { key: "core:rate", name: "Rate", icon: numberType.values.icon },
  encode: (value: RateValue) => JSON.stringify(normalizeRateInput(value)),
  decode: (raw) => decodeRate(raw),
  validate: ({ value }) => {
    try {
      normalizeRateInput(value);
    } catch (error) {
      return {
        code: "rate.invalid",
        message: error instanceof Error ? error.message : "Rate values are invalid.",
      };
    }

    return undefined;
  },
});

export const rateFilter = {
  defaultOperator: "equals",
  operators: {
    equals: {
      label: "Equals",
      operand: {
        kind: "string",
        placeholder: "money(125 USD) / duration(1 day)",
      },
      parse: parseRate,
      format: (operand: RateValue) => formatRate(operand),
      test: (value: RateValue, operand: RateValue) =>
        structuredValuePartEquals(value.numerator, operand.numerator) &&
        structuredValuePartEquals(value.denominator, operand.denominator),
    },
  },
} satisfies TypeModuleFilter<RateValue>;

export const rateMeta = {
  summary: {
    kind: "value",
    format: formatRate,
  },
  display: {
    kind: "number/rate",
    allowed: ["number/rate", "text"] as const,
    format: formatRate,
  },
  editor: {
    kind: "number/rate",
    allowed: ["number/rate", "text"] as const,
    placeholder: "money(125 USD) / duration(1 day)",
    parse: parseRate,
    format: formatRateEditorValue,
  },
} satisfies TypeModuleMeta<
  RateValue,
  readonly ["number/rate", "text"],
  readonly ["number/rate", "text"]
>;

export const rateTypeModule = defineScalarModule({
  type: rateType,
  meta: rateMeta,
  filter: rateFilter,
});
