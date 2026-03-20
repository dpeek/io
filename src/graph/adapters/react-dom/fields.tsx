import { MarkdownRenderer } from "@io/web/markdown";

import {
  formatPredicateValue,
  getPredicateEntityReferenceSelection,
  usePredicateField,
  type PredicateFieldProps,
  type PredicateFieldViewCapability,
} from "../../runtime/react/index.js";
import { normalizeTextValue } from "./editor/shared.js";
import { SvgPreview } from "./editor/svg-preview.js";
import { EntityReferenceSummary } from "./entity-reference-ui.js";

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

function MarkdownFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  const content = normalizeTextValue(value);

  return (
    <div data-web-field-kind="markdown">
      <MarkdownRenderer className="topic-markdown" content={content} />
    </div>
  );
}

function SvgFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  const content = normalizeTextValue(value);

  return (
    <div data-web-field-kind="svg">
      <SvgPreview content={content} />
    </div>
  );
}

function NumberFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  return <span data-web-field-kind="number">{formatPredicateValue(predicate, value)}</span>;
}

function DurationFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  return (
    <span data-web-field-kind="number/duration">{formatPredicateValue(predicate, value)}</span>
  );
}

function PercentFieldView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  return <span data-web-field-kind="number/percent">{formatPredicateValue(predicate, value)}</span>;
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

function EntityReferenceListView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  const references = getPredicateEntityReferenceSelection(predicate, value);

  return (
    <ul data-web-field-kind="entity-reference-list">
      {references.map(({ entity, id }) => (
        <li data-web-reference-id={id} key={id}>
          <EntityReferenceSummary entity={entity} />
        </li>
      ))}
    </ul>
  );
}

export const genericWebFieldViewCapabilities = [
  { kind: "boolean", Component: BooleanFieldView },
  { kind: "text", Component: TextFieldView },
  { kind: "markdown", Component: MarkdownFieldView },
  { kind: "svg", Component: SvgFieldView },
  { kind: "date", Component: DateFieldView },
  { kind: "number", Component: NumberFieldView },
  { kind: "number/duration", Component: DurationFieldView },
  { kind: "number/percent", Component: PercentFieldView },
  { kind: "link", Component: LinkFieldView },
  { kind: "external-link", Component: ExternalLinkFieldView },
  { kind: "badge", Component: BadgeFieldView },
  { kind: "entity-reference-list", Component: EntityReferenceListView },
] satisfies readonly PredicateFieldViewCapability<any, any>[];

export { genericWebFieldEditorCapabilities } from "./editor/index.js";
