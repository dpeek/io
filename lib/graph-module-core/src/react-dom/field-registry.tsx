import {
  formatPredicateValue,
  usePredicateField,
  type PredicateFieldEditorCapability,
  type PredicateFieldProps,
  type PredicateFieldViewCapability,
} from "@io/graph-react";

import { colorFieldViewCapability } from "./fields/color.js";
import { DurationFieldEditor, durationFieldViewCapability } from "./fields/duration.js";
import { genericWebFieldEditorCapabilities as genericBaseWebFieldEditorCapabilities } from "./fields/index.js";
import { markdownFieldViewCapability } from "./fields/markdown.js";
import { MoneyFieldEditor, moneyFieldViewCapability } from "./fields/money.js";
import { percentFieldViewCapability } from "./fields/percent.js";
import { QuantityFieldEditor, quantityFieldViewCapability } from "./fields/quantity.js";
import { RangeFieldEditor, rangeFieldViewCapability } from "./fields/range.js";
import { RateFieldEditor, rateFieldViewCapability } from "./fields/rate.js";
import {
  EntityReferenceComboboxEditor,
  entityReferenceListViewCapability,
} from "./fields/reference.js";
import { svgFieldViewCapability } from "./fields/svg.js";

type AnyFieldProps = PredicateFieldProps<any, any>;

function BooleanFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);

  if (Array.isArray(value)) {
    return <span data-web-field-status="unsupported">unsupported-display-kind:boolean</span>;
  }

  return (
    <input
      aria-label={formatPredicateValue(predicate, value)}
      checked={value === true}
      data-web-field-kind="boolean"
      disabled
      readOnly
      type="checkbox"
    />
  );
}

function TextFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  return <span data-web-field-kind="text">{formatPredicateValue(predicate, value)}</span>;
}

function NumberFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  return <span data-web-field-kind="number">{formatPredicateValue(predicate, value)}</span>;
}

function DateFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  if (!(value instanceof Date)) {
    return <span data-web-field-kind="date">{formatPredicateValue(predicate, value)}</span>;
  }

  const formatted = formatPredicateValue(predicate, value);
  return (
    <time data-web-field-kind="date" dateTime={value.toISOString()}>
      {formatted}
    </time>
  );
}

function LinkFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  if (!(value instanceof URL)) {
    return <span data-web-field-kind="link">{formatPredicateValue(predicate, value)}</span>;
  }

  const href = value.toString();
  return (
    <a data-web-field-kind="link" href={href}>
      {formatPredicateValue(predicate, value)}
    </a>
  );
}

function ExternalLinkFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  if (!(value instanceof URL)) {
    return (
      <span data-web-field-kind="external-link">{formatPredicateValue(predicate, value)}</span>
    );
  }

  const href = value.toString();
  return (
    <a data-web-field-kind="external-link" href={href} rel="noreferrer" target="_blank">
      {formatPredicateValue(predicate, value)}
    </a>
  );
}

function BadgeFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  return <span data-web-field-kind="badge">{formatPredicateValue(predicate, value)}</span>;
}

/** Built-in browser field view capabilities for `@io/graph-module-core/react-dom`. */
export const genericWebFieldViewCapabilities = [
  { kind: "boolean", Component: BooleanFieldView },
  colorFieldViewCapability,
  { kind: "text", Component: TextFieldView },
  markdownFieldViewCapability,
  svgFieldViewCapability,
  { kind: "date", Component: DateFieldView },
  { kind: "number", Component: NumberFieldView },
  percentFieldViewCapability,
  { kind: "link", Component: LinkFieldView },
  { kind: "external-link", Component: ExternalLinkFieldView },
  { kind: "badge", Component: BadgeFieldView },
  durationFieldViewCapability,
  quantityFieldViewCapability,
  rangeFieldViewCapability,
  rateFieldViewCapability,
  moneyFieldViewCapability,
  entityReferenceListViewCapability,
] satisfies readonly PredicateFieldViewCapability<any, any>[];

/** Built-in browser field editor capabilities for the built-in core DOM layer. */
export const genericWebFieldEditorCapabilities = [
  ...genericBaseWebFieldEditorCapabilities,
  { kind: "number/duration", Component: DurationFieldEditor },
  { kind: "number/quantity", Component: QuantityFieldEditor },
  { kind: "number/range", Component: RangeFieldEditor },
  { kind: "number/rate", Component: RateFieldEditor },
  { kind: "money/amount", Component: MoneyFieldEditor },
  { kind: "entity-reference-combobox", Component: EntityReferenceComboboxEditor },
] satisfies readonly PredicateFieldEditorCapability<any, any>[];
