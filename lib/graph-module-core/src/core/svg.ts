import type { TypeModuleMeta } from "@io/graph-module";
import { defineScalar } from "@io/graph-module";
import { defineScalarModule } from "@io/graph-module";

import { defineCoreIconSeed } from "../icon/seed.js";
import { expectStringInput } from "./input.js";
import { stringFilter } from "./string.js";

const svgIconSeed = defineCoreIconSeed("svg", {
  name: "SVG",
  svg: `<svg viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none" width="24" height="24" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <path d="M18 16l4-4-4-4" />
  <path d="M6 8 2 12l4 4" />
  <path d="M14.5 4l-5 16" />
</svg>`,
});

export const svgMeta = {
  searchable: false,
  summary: {
    kind: "value",
    format: (value: string) => value,
  },
  display: {
    kind: "svg",
    allowed: ["text", "svg"] as const,
    format: (value: string) => value,
  },
  editor: {
    kind: "svg",
    allowed: ["text", "textarea", "svg"] as const,
    placeholder: '<svg viewBox="0 0 24 24">...</svg>',
    multiline: true,
  },
} satisfies TypeModuleMeta<string, readonly ["text", "svg"], readonly ["text", "textarea", "svg"]>;

export const svgType = defineScalar({
  values: { key: "core:svg", name: "SVG", icon: svgIconSeed },
  encode: (value: string) => expectStringInput(value),
  decode: (raw) => raw,
});

export const svgTypeModule = defineScalarModule({
  type: svgType,
  meta: svgMeta,
  filter: stringFilter,
});
