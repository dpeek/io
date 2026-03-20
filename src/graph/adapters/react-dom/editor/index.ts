import type { PredicateFieldEditorCapability } from "../../../runtime/react/index.js";
import { CheckboxFieldEditor } from "./checkbox.js";
import { ColorFieldEditor } from "./color.js";
import { DateFieldEditor } from "./date.js";
import { DurationFieldEditor } from "./duration.js";
import { EnumComboboxEditor } from "./enum-combobox.js";
import { MarkdownFieldEditor } from "./markdown.js";
import { NumberFieldEditor } from "./number.js";
import { PercentFieldEditor } from "./percent.js";
import { EntityReferenceComboboxEditor } from "./reference.js";
import { SvgFieldEditor } from "./svg.js";
import { TextFieldEditor } from "./text.js";
import { UrlFieldEditor } from "./url.js";

export const genericWebFieldEditorCapabilities = [
  { kind: "checkbox", Component: CheckboxFieldEditor },
  { kind: "color", Component: ColorFieldEditor },
  { kind: "text", Component: TextFieldEditor },
  { kind: "textarea", Component: TextFieldEditor },
  { kind: "markdown", Component: MarkdownFieldEditor },
  { kind: "svg", Component: SvgFieldEditor },
  { kind: "date", Component: DateFieldEditor },
  { kind: "number", Component: NumberFieldEditor },
  { kind: "number/duration", Component: DurationFieldEditor },
  { kind: "number/percent", Component: PercentFieldEditor },
  { kind: "url", Component: UrlFieldEditor },
  { kind: "select", Component: EnumComboboxEditor },
  { kind: "entity-reference-combobox", Component: EntityReferenceComboboxEditor },
] satisfies readonly PredicateFieldEditorCapability<any, any>[];
