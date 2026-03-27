import { defineScalar, defineScalarModule } from "@io/graph-module";
import type { TypeModuleFilter, TypeModuleMeta } from "@io/graph-module";

import { defineCoreIconSeed } from "../icon/seed.js";

const colorLabel = "#2563eb";

const colorIconSeed = defineCoreIconSeed("color", {
  name: "Color",
  svg: `<svg viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none" width="24" height="24" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <rect width="16" height="6" rx="2" x="2" y="2" />
  <path d="M10 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
  <rect width="4" height="6" rx="1" x="8" y="16" />
</svg>`,
});

const hexColorPattern = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/;

export function parseColor(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!hexColorPattern.test(value)) {
    throw new Error(`Invalid color value "${raw}"`);
  }
  return value;
}

export const colorFilter = {
  defaultOperator: "equals",
  operators: {
    equals: {
      label: "Equals",
      operand: {
        kind: "string",
        placeholder: colorLabel,
      },
      parse: parseColor,
      format: (operand: string) => operand,
      test: (value: string, operand: string) => value === operand,
    },
  },
} satisfies TypeModuleFilter<string>;

const colorMeta = {
  searchable: true,
  summary: {
    kind: "value",
    format: (value: string) => value,
  },
  display: {
    kind: "color",
    allowed: ["text", "color"] as const,
    format: (value: string) => value,
  },
  editor: {
    kind: "color",
    allowed: ["text", "color"] as const,
    placeholder: colorLabel,
    autocomplete: "off",
    parse: parseColor,
    format: (value: string) => value,
  },
} satisfies TypeModuleMeta<string, readonly ["text", "color"], readonly ["text", "color"]>;

export const colorTypeModule = defineScalarModule({
  type: defineScalar({
    values: { key: "core:color", name: "Color", icon: colorIconSeed },
    encode: parseColor,
    decode: parseColor,
  }),
  meta: colorMeta,
  filter: colorFilter,
});

export const colorType = colorTypeModule.type;
