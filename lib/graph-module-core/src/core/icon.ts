import { defineType } from "@io/graph-module";
import { entityReferenceComboboxEditorKind, existingEntityReferenceField } from "@io/graph-module";

import { defineCoreIconSeed } from "../icon/seed.js";
import { node } from "./node.js";
import { slugTypeModule } from "./slug.js";
import { sanitizeSvgMarkup } from "./svg-sanitization.js";
import { stringTypeModule } from "./string.js";
import { svgTypeModule } from "./svg.js";

const iconTypeIconSeed = defineCoreIconSeed("icon", {
  name: "Icon",
  svg: `<svg viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none" width="24" height="24" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
  <circle cx="10" cy="8" r="2" />
  <path d="M20 13.7l-2.1-2.1c-0.8-0.8-2-0.8-2.8 0L9.7 17" />
</svg>`,
});

function normalizeSvgMarkup(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const result = sanitizeSvgMarkup(value);
  return result.ok ? result.svg : value;
}

function validateSvgMarkup(input: { value: unknown }) {
  if (typeof input.value !== "string") return undefined;
  const result = sanitizeSvgMarkup(input.value);
  return result.ok ? undefined : result.issues;
}

export const icon = defineType({
  values: { key: "core:icon", name: "Icon", icon: iconTypeIconSeed },
  fields: {
    ...node.fields,
    key: slugTypeModule.field({
      cardinality: "one",
      icon: stringTypeModule.type.values.icon,
      meta: {
        label: "Key",
      },
      filter: {
        operators: ["equals", "prefix"] as const,
        defaultOperator: "equals",
      },
    }),
    svg: svgTypeModule.field({
      cardinality: "one",
      meta: {
        label: "SVG",
      },
      onCreate: ({ incoming }) => normalizeSvgMarkup(incoming),
      onUpdate: ({ incoming }) => normalizeSvgMarkup(incoming),
      validate: ({ value }) => validateSvgMarkup({ value }),
    }),
  },
});

export function iconReferenceField(label = "Icon") {
  return existingEntityReferenceField(icon, {
    cardinality: "one?",
    editorKind: entityReferenceComboboxEditorKind,
    label,
  });
}

export * from "../icon/seed.js";
