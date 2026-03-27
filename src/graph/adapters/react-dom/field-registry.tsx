import {
  formatPredicateValue,
  usePredicateField,
  type PredicateFieldProps,
  type PredicateFieldViewCapability,
} from "@io/graph-react";

import { colorFieldViewCapability } from "./fields/color.js";
import { durationFieldViewCapability } from "./fields/duration.js";
import { markdownFieldViewCapability } from "./fields/markdown.js";
import { moneyFieldViewCapability } from "./fields/money.js";
import { percentFieldViewCapability } from "./fields/percent.js";
import { quantityFieldViewCapability } from "./fields/quantity.js";
import { rangeFieldViewCapability } from "./fields/range.js";
import { rateFieldViewCapability } from "./fields/rate.js";
import { entityReferenceListViewCapability } from "./fields/reference.js";
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

export const genericWebFieldViewCapabilities = [
  { kind: "boolean", Component: BooleanFieldView },
  colorFieldViewCapability,
  { kind: "text", Component: TextFieldView },
  markdownFieldViewCapability,
  svgFieldViewCapability,
  { kind: "date", Component: DateFieldView },
  { kind: "number", Component: NumberFieldView },
  durationFieldViewCapability,
  percentFieldViewCapability,
  quantityFieldViewCapability,
  rangeFieldViewCapability,
  rateFieldViewCapability,
  moneyFieldViewCapability,
  { kind: "link", Component: LinkFieldView },
  { kind: "external-link", Component: ExternalLinkFieldView },
  { kind: "badge", Component: BadgeFieldView },
  entityReferenceListViewCapability,
] satisfies readonly PredicateFieldViewCapability<any, any>[];

export { genericWebFieldEditorCapabilities } from "./fields/index.js";
