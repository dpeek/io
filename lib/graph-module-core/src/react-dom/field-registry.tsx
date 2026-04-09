import {
  formatPredicateValue,
  usePredicateField,
  type PredicateFieldViewCapability,
} from "@io/graph-react";
import { Checkbox } from "@io/web/checkbox";

import { colorFieldViewCapability } from "./fields/color.js";
import { CheckboxFieldEditor } from "./fields/checkbox.js";
import { DurationFieldEditor, durationFieldViewCapability } from "./fields/duration.js";
import { EnumComboboxEditor } from "./fields/enum-combobox.js";
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
import { DefaultFieldRow, getFieldState } from "./fields/shared.js";
import { svgFieldViewCapability } from "./fields/svg.js";
import { TextFieldEditor } from "./fields/text.js";
import type {
  PredicateFieldCapability,
  PredicateFieldControlCapability,
  PredicateFieldProps,
} from "./resolver.js";

type AnyFieldProps = PredicateFieldProps<any, any>;
type AnyFieldControlCapability = PredicateFieldControlCapability<any, any>;

function BooleanFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);

  if (Array.isArray(value)) {
    return <span data-web-field-status="unsupported">unsupported-display-kind:boolean</span>;
  }

  return (
    <Checkbox
      aria-label={formatPredicateValue(predicate, value)}
      checked={value === true}
      data-web-field-kind="boolean"
      disabled
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

/**
 * Wraps a bare control capability in the default browser field-row chrome.
 * Field mode keeps using editor metadata for lookup until richer authored
 * field-specific metadata lands.
 */
export function createDefaultWebFieldCapability(
  capability: AnyFieldControlCapability,
): PredicateFieldCapability<any, any> {
  const ControlComponent = capability.Component;

  function DefaultWebField(props: AnyFieldProps) {
    const state = getFieldState(props);

    return (
      <DefaultFieldRow fieldKind={capability.kind} state={state}>
        <ControlComponent {...props} mode="control" />
      </DefaultFieldRow>
    );
  }

  return { kind: capability.kind, Component: DefaultWebField };
}

/** Built-in browser field control capabilities for the built-in core DOM layer. */
export const genericWebFieldControlCapabilities = [
  ...genericBaseWebFieldEditorCapabilities,
  { kind: "number/duration", Component: DurationFieldEditor },
  { kind: "number/quantity", Component: QuantityFieldEditor },
  { kind: "number/range", Component: RangeFieldEditor },
  { kind: "number/rate", Component: RateFieldEditor },
  { kind: "money/amount", Component: MoneyFieldEditor },
  { kind: "entity-reference-combobox", Component: EntityReferenceComboboxEditor },
] satisfies readonly PredicateFieldControlCapability<any, any>[];

const fieldCapabilityOverrides = [
  { kind: "checkbox", Component: CheckboxFieldEditor },
  { kind: "text", Component: TextFieldEditor },
  { kind: "textarea", Component: TextFieldEditor },
  { kind: "select", Component: EnumComboboxEditor },
  { kind: "entity-reference-combobox", Component: EntityReferenceComboboxEditor },
] satisfies readonly PredicateFieldCapability<any, any>[];
const fieldCapabilityOverrideKinds = new Set(
  fieldCapabilityOverrides.map((capability) => capability.kind),
);

/** Built-in browser field-row capabilities derived from the shipped control registry. */
export const genericWebFieldCapabilities = [
  ...fieldCapabilityOverrides,
  ...genericWebFieldControlCapabilities
    .filter((capability) => !fieldCapabilityOverrideKinds.has(capability.kind))
    .map((capability) => createDefaultWebFieldCapability(capability)),
] satisfies readonly PredicateFieldCapability<any, any>[];

/** Compatibility alias while callers migrate from `editor` to `control`. */
export const genericWebFieldEditorCapabilities = genericWebFieldControlCapabilities;
