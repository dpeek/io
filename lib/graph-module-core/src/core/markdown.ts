import type { TypeModuleMeta } from "@io/graph-module";
import { defineScalar } from "@io/graph-module";
import { defineScalarModule } from "@io/graph-module";

import { defineCoreIconSeed } from "../icon/seed.js";
import { expectStringInput } from "./input.js";
import { stringFilter } from "./string.js";

const markdownIconSeed = defineCoreIconSeed("markdown", {
  name: "Markdown",
  svg: `<svg viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none" width="24" height="24" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <line x1="4" x2="20" y1="9" y2="9" />
  <line x1="4" x2="20" y1="15" y2="15" />
  <line x1="10" x2="8" y1="3" y2="21" />
  <line x1="16" x2="14" y1="3" y2="21" />
</svg>`,
});

export const markdownMeta = {
  searchable: true,
  summary: {
    kind: "value",
    format: (value: string) => value,
  },
  display: {
    kind: "markdown",
    allowed: ["text", "markdown"] as const,
    format: (value: string) => value,
  },
  editor: {
    kind: "markdown",
    allowed: ["text", "textarea", "markdown"] as const,
    placeholder: "# Topic title",
    multiline: true,
  },
} satisfies TypeModuleMeta<
  string,
  readonly ["text", "markdown"],
  readonly ["text", "textarea", "markdown"]
>;

export const markdownType = defineScalar({
  values: { key: "core:markdown", name: "Markdown", icon: markdownIconSeed },
  encode: (value: string) => expectStringInput(value),
  decode: (raw) => raw,
});

export const markdownTypeModule = defineScalarModule({
  type: markdownType,
  meta: markdownMeta,
  filter: stringFilter,
});
