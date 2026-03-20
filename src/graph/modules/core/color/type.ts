import { defineScalar, defineScalarModule } from "@io/core/graph/def";
import type { TypeModuleFilter, TypeModuleMeta } from "@io/core/graph/def";

import { graphIconSeeds } from "../icon/seed.js";

const colorLabel = "#2563eb";
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
    kind: "text",
    allowed: ["text"] as const,
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
} satisfies TypeModuleMeta<string, readonly ["text"], readonly ["text", "color"]>;

export const colorTypeModule = defineScalarModule({
  type: defineScalar({
    values: { key: "core:color", name: "Color", icon: graphIconSeeds.color },
    encode: parseColor,
    decode: parseColor,
  }),
  meta: colorMeta,
  filter: colorFilter,
});

export const colorType = colorTypeModule.type;
