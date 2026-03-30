import type { AnyTypeOutput } from "@io/graph-kernel";
import type { QueryFilterOperator, QueryLiteral, QueryParameterType } from "@io/graph-client";
import type { QuerySurfaceFieldKind } from "@io/graph-projection";

import { booleanTypeModule } from "../core/boolean.js";
import { colorTypeModule, parseColor } from "../core/color.js";
import { dateTypeModule, formatDate, parseDate } from "../core/date.js";
import {
  durationTypeModule,
  formatDurationEditorValue,
  normalizeDurationInput,
  parseDuration,
} from "../core/duration.js";
import { emailTypeModule, parseEmail } from "../core/email.js";
import {
  moneyTypeModule,
  formatMoneyEditorValue,
  normalizeMoneyInput,
  parseMoney,
} from "../core/money.js";
import { numberTypeModule } from "../core/number.js";
import { parsePercent, percentTypeModule, normalizePercentInput } from "../core/percent.js";
import {
  quantityTypeModule,
  formatQuantityEditorValue,
  normalizeQuantityInput,
  parseQuantity,
} from "../core/quantity.js";
import {
  rangeTypeModule,
  formatRangeEditorValue,
  normalizeRangeInput,
  parseRange,
} from "../core/range.js";
import {
  rateTypeModule,
  formatRateEditorValue,
  normalizeRateInput,
  parseRate,
} from "../core/rate.js";
import { stringTypeModule } from "../core/string.js";
import { urlTypeModule } from "../core/url.js";

type QueryEditorFieldModule = {
  readonly meta: Record<string, unknown>;
  readonly type: AnyTypeOutput;
};

export const queryEditorUnsupportedFieldKindValues = [
  "enum-list",
  "entity-ref-list",
  "date-list",
  "boolean-list",
  "text-list",
  "number-list",
  "url-list",
  "email-list",
  "color-list",
  "percent-list",
  "duration-list",
  "money-list",
  "quantity-list",
  "range-list",
  "rate-list",
] as const;

export type QueryEditorUnsupportedFieldKind =
  (typeof queryEditorUnsupportedFieldKindValues)[number];

export type QueryEditorSupportedFieldKind = Exclude<
  QuerySurfaceFieldKind,
  QueryEditorUnsupportedFieldKind
>;

const queryEditorFieldModuleByKind = Object.freeze({
  boolean: booleanTypeModule,
  color: colorTypeModule,
  date: dateTypeModule,
  duration: durationTypeModule,
  email: emailTypeModule,
  money: moneyTypeModule,
  number: numberTypeModule,
  percent: percentTypeModule,
  quantity: quantityTypeModule,
  range: rangeTypeModule,
  rate: rateTypeModule,
  text: stringTypeModule,
  url: urlTypeModule,
} satisfies Partial<Record<QuerySurfaceFieldKind, QueryEditorFieldModule>>);

type SingleQueryEditorParameterType = Exclude<
  QueryParameterType,
  | "string-list"
  | "number-list"
  | "boolean-list"
  | "date-list"
  | "enum-list"
  | "entity-ref-list"
  | "url-list"
  | "email-list"
  | "color-list"
  | "percent-list"
  | "duration-list"
  | "money-list"
  | "quantity-list"
  | "range-list"
  | "rate-list"
>;

const queryEditorUnsupportedFieldKindSet = new Set<QueryEditorUnsupportedFieldKind>(
  queryEditorUnsupportedFieldKindValues,
);

export function isQueryEditorFieldKindSupported(
  kind: QuerySurfaceFieldKind,
): kind is QueryEditorSupportedFieldKind {
  return !queryEditorUnsupportedFieldKindSet.has(kind as QueryEditorUnsupportedFieldKind);
}

export function getQueryEditorBaseFieldKind(
  kind: QuerySurfaceFieldKind,
): QueryEditorSupportedFieldKind {
  switch (kind) {
    case "enum-list":
      return "enum";
    case "entity-ref-list":
      return "entity-ref";
    case "date-list":
      return "date";
    case "boolean-list":
      return "boolean";
    case "text-list":
      return "text";
    case "number-list":
      return "number";
    case "url-list":
      return "url";
    case "email-list":
      return "email";
    case "color-list":
      return "color";
    case "percent-list":
      return "percent";
    case "duration-list":
      return "duration";
    case "money-list":
      return "money";
    case "quantity-list":
      return "quantity";
    case "range-list":
      return "range";
    case "rate-list":
      return "rate";
    case "enum":
    case "entity-ref":
    case "date":
    case "boolean":
    case "text":
    case "number":
    case "url":
    case "email":
    case "color":
    case "percent":
    case "duration":
    case "money":
    case "quantity":
    case "range":
    case "rate":
      return kind;
  }
}

export function describeUnsupportedQueryEditorFieldKind(
  kind: QuerySurfaceFieldKind,
): string | undefined {
  if (isQueryEditorFieldKindSupported(kind)) {
    return undefined;
  }

  return (
    `Field kind "${kind}" is excluded from the first /query authoring surface. ` +
    "List-valued predicate families need dedicated membership semantics instead of scalar comparisons."
  );
}

export function getQueryEditorFieldModuleForKind(
  kind: QuerySurfaceFieldKind,
): QueryEditorFieldModule | undefined {
  switch (getQueryEditorBaseFieldKind(kind)) {
    case "boolean":
      return queryEditorFieldModuleByKind.boolean;
    case "color":
      return queryEditorFieldModuleByKind.color;
    case "date":
      return queryEditorFieldModuleByKind.date;
    case "duration":
      return queryEditorFieldModuleByKind.duration;
    case "email":
      return queryEditorFieldModuleByKind.email;
    case "money":
      return queryEditorFieldModuleByKind.money;
    case "number":
      return queryEditorFieldModuleByKind.number;
    case "percent":
      return queryEditorFieldModuleByKind.percent;
    case "quantity":
      return queryEditorFieldModuleByKind.quantity;
    case "range":
      return queryEditorFieldModuleByKind.range;
    case "rate":
      return queryEditorFieldModuleByKind.rate;
    case "text":
      return queryEditorFieldModuleByKind.text;
    case "url":
      return queryEditorFieldModuleByKind.url;
    case "entity-ref":
    case "enum":
      return undefined;
  }
}

export function getQueryEditorFieldKindForParameterType(
  type: SingleQueryEditorParameterType,
): QueryEditorSupportedFieldKind {
  switch (type) {
    case "string":
      return "text";
    case "date":
      return "date";
    case "enum":
      return "enum";
    case "entity-ref":
      return "entity-ref";
    case "url":
      return "url";
    case "email":
      return "email";
    case "color":
      return "color";
    case "number":
      return "number";
    case "percent":
      return "percent";
    case "duration":
      return "duration";
    case "money":
      return "money";
    case "quantity":
      return "quantity";
    case "range":
      return "range";
    case "rate":
      return "rate";
    case "boolean":
      return "boolean";
  }
}

export function getQueryEditorFieldKindForFilterOperator(
  kind: QuerySurfaceFieldKind,
  operator: QueryFilterOperator,
): QueryEditorSupportedFieldKind {
  const resolvedKind = getQueryEditorBaseFieldKind(kind);
  if (
    (resolvedKind === "url" || resolvedKind === "email") &&
    (operator === "contains" || operator === "starts-with")
  ) {
    return "text";
  }

  return resolvedKind;
}

function requireNonEmptyString(rawValue: unknown, label: string): string {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    throw new Error(`${label} requires a non-empty string value.`);
  }
  return rawValue.trim();
}

function coerceNumberValue(rawValue: unknown, label: string): number {
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return rawValue;
  }
  if (typeof rawValue === "string" && rawValue.trim().length > 0) {
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new Error(`${label} requires a numeric value.`);
}

function coercePercentValue(rawValue: unknown, label: string): number {
  try {
    if (typeof rawValue === "number") {
      return normalizePercentInput(rawValue);
    }
    if (typeof rawValue === "string" && rawValue.trim().length > 0) {
      return parsePercent(rawValue);
    }
  } catch {
    // fall through to the shared error below
  }
  throw new Error(`${label} requires a percent value.`);
}

function coerceBooleanValue(rawValue: unknown, label: string): boolean {
  if (typeof rawValue === "boolean") {
    return rawValue;
  }
  if (typeof rawValue === "string") {
    const normalized = rawValue.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  throw new Error(`${label} requires a boolean value.`);
}

function coerceSingleFieldLiteralValue(
  kind: QuerySurfaceFieldKind,
  rawValue: unknown,
  label: string,
): QueryLiteral {
  switch (getQueryEditorBaseFieldKind(kind)) {
    case "text":
    case "enum":
    case "entity-ref":
      return requireNonEmptyString(rawValue, label);
    case "date":
      return formatDate(parseDate(requireNonEmptyString(rawValue, label)));
    case "url":
      return new URL(requireNonEmptyString(rawValue, label)).toString();
    case "email":
      return parseEmail(requireNonEmptyString(rawValue, label));
    case "color":
      return parseColor(requireNonEmptyString(rawValue, label));
    case "duration":
      return formatDurationEditorValue(parseDuration(requireNonEmptyString(rawValue, label)));
    case "money":
      return formatMoneyEditorValue(parseMoney(requireNonEmptyString(rawValue, label)));
    case "quantity":
      return formatQuantityEditorValue(parseQuantity(requireNonEmptyString(rawValue, label)));
    case "range":
      return formatRangeEditorValue(parseRange(requireNonEmptyString(rawValue, label)));
    case "rate":
      return formatRateEditorValue(parseRate(requireNonEmptyString(rawValue, label)));
    case "number":
      return coerceNumberValue(rawValue, label);
    case "percent":
      return coercePercentValue(rawValue, label);
    case "boolean":
      return coerceBooleanValue(rawValue, label);
  }
}

function coerceLiteralListValue<T extends QueryLiteral>(
  rawValue: unknown,
  label: string,
  itemCoercer: (entry: unknown, entryLabel: string) => T,
): readonly T[] {
  if (!Array.isArray(rawValue) || rawValue.length === 0) {
    throw new Error(`${label} requires at least one value.`);
  }

  return rawValue.map((entry) => itemCoercer(entry, label));
}

export function coerceQueryEditorFieldLiteralValue(
  kind: QuerySurfaceFieldKind,
  rawValue: QueryLiteral | undefined,
  label: string,
  isList: boolean,
): QueryLiteral {
  if (!isList) {
    return coerceSingleFieldLiteralValue(kind, rawValue, label);
  }

  return coerceLiteralListValue(rawValue, label, (entry, entryLabel) =>
    coerceSingleFieldLiteralValue(kind, entry, entryLabel),
  ) as QueryLiteral;
}

export function coerceQueryEditorParameterDefaultValue(
  type: QueryParameterType,
  rawValue: QueryLiteral | undefined,
  label: string,
): QueryLiteral {
  switch (type) {
    case "string":
    case "date":
    case "enum":
    case "entity-ref":
    case "url":
    case "email":
    case "color":
    case "duration":
    case "money":
    case "quantity":
    case "range":
    case "rate":
    case "number":
    case "percent":
    case "boolean":
      return coerceSingleFieldLiteralValue(
        getQueryEditorFieldKindForParameterType(type),
        rawValue,
        label,
      );
    case "string-list":
    case "date-list":
    case "enum-list":
    case "entity-ref-list":
    case "url-list":
    case "email-list":
    case "color-list":
    case "duration-list":
    case "money-list":
    case "quantity-list":
    case "range-list":
    case "rate-list":
      return coerceLiteralListValue(
        rawValue,
        label,
        (entry, entryLabel) =>
          coerceSingleFieldLiteralValue(
            getQueryEditorFieldKindForParameterType(
              type.slice(0, -5) as SingleQueryEditorParameterType,
            ),
            entry,
            entryLabel,
          ) as string,
      );
    case "number-list":
      return coerceLiteralListValue(rawValue, label, (entry, entryLabel) =>
        coerceNumberValue(entry, entryLabel),
      );
    case "percent-list":
      return coerceLiteralListValue(rawValue, label, (entry, entryLabel) =>
        coercePercentValue(entry, entryLabel),
      );
    case "boolean-list":
      return coerceLiteralListValue(rawValue, label, (entry, entryLabel) =>
        coerceBooleanValue(entry, entryLabel),
      );
  }
}

function tryDecodeSingleFieldEditorValue(
  kind: QuerySurfaceFieldKind,
  rawValue: QueryLiteral | undefined,
): unknown {
  if (rawValue === undefined || rawValue === "") {
    return undefined;
  }

  switch (getQueryEditorBaseFieldKind(kind)) {
    case "text":
    case "enum":
    case "entity-ref":
      return requireNonEmptyString(rawValue, kind);
    case "date":
      return parseDate(requireNonEmptyString(rawValue, kind));
    case "url":
      return new URL(requireNonEmptyString(rawValue, kind));
    case "email":
      return parseEmail(requireNonEmptyString(rawValue, kind));
    case "color":
      return parseColor(requireNonEmptyString(rawValue, kind));
    case "duration":
      return parseDuration(requireNonEmptyString(rawValue, kind));
    case "money":
      return parseMoney(requireNonEmptyString(rawValue, kind));
    case "quantity":
      return parseQuantity(requireNonEmptyString(rawValue, kind));
    case "range":
      return parseRange(requireNonEmptyString(rawValue, kind));
    case "rate":
      return parseRate(requireNonEmptyString(rawValue, kind));
    case "number":
      return coerceNumberValue(rawValue, kind);
    case "percent":
      return coercePercentValue(rawValue, kind);
    case "boolean":
      return coerceBooleanValue(rawValue, kind);
  }
}

export function decodeQueryEditorFieldValueForEditor(
  kind: QuerySurfaceFieldKind,
  rawValue: QueryLiteral | undefined,
): unknown {
  try {
    return tryDecodeSingleFieldEditorValue(kind, rawValue);
  } catch {
    return undefined;
  }
}

export function decodeQueryEditorParameterValueForEditor(
  type: SingleQueryEditorParameterType,
  rawValue: QueryLiteral | undefined,
): unknown {
  return decodeQueryEditorFieldValueForEditor(
    getQueryEditorFieldKindForParameterType(type),
    rawValue,
  );
}

function encodeSingleFieldEditorValue(kind: QuerySurfaceFieldKind, value: unknown): QueryLiteral {
  switch (getQueryEditorBaseFieldKind(kind)) {
    case "text":
    case "enum":
    case "entity-ref":
      return requireNonEmptyString(value, kind);
    case "date":
      if (!(value instanceof Date)) {
        throw new Error("Expected a Date value.");
      }
      return formatDate(value);
    case "url":
      if (!(value instanceof URL)) {
        throw new Error("Expected a URL value.");
      }
      return value.toString();
    case "email":
      return parseEmail(requireNonEmptyString(value, kind));
    case "color":
      return parseColor(requireNonEmptyString(value, kind));
    case "duration":
      return formatDurationEditorValue(normalizeDurationInput(value));
    case "money":
      return formatMoneyEditorValue(normalizeMoneyInput(value));
    case "quantity":
      return formatQuantityEditorValue(normalizeQuantityInput(value));
    case "range":
      return formatRangeEditorValue(normalizeRangeInput(value));
    case "rate":
      return formatRateEditorValue(normalizeRateInput(value));
    case "number":
      return coerceNumberValue(value, kind);
    case "percent":
      return coercePercentValue(value, kind);
    case "boolean":
      return coerceBooleanValue(value, kind);
  }
}

export function encodeQueryEditorFieldValueFromEditor(
  kind: QuerySurfaceFieldKind,
  value: unknown,
): QueryLiteral | undefined {
  if (value === undefined) {
    return undefined;
  }
  return encodeSingleFieldEditorValue(kind, value);
}

export function encodeQueryEditorParameterValueFromEditor(
  type: SingleQueryEditorParameterType,
  value: unknown,
): QueryLiteral | undefined {
  return encodeQueryEditorFieldValueFromEditor(
    getQueryEditorFieldKindForParameterType(type),
    value,
  );
}
