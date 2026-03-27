import type { TypeModuleFilter } from "@io/graph-module";
import type { TypeModuleMeta } from "@io/graph-module";
import { defineScalar } from "@io/graph-module";
import { defineScalarModule } from "@io/graph-module";

import { defineCoreIconSeed } from "../icon/seed.js";

const jsonIconSeed = defineCoreIconSeed("json", {
  name: "JSON",
  svg: `<svg viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none" width="24" height="24" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
  <path d="M14 2v4a2 2 0 0 0 2 2h4" />
  <path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1" />
  <path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1" />
</svg>`,
});

function formatJson(value: unknown): string {
  return JSON.stringify(value);
}

export const jsonFilter = {
  defaultOperator: "contains",
  operators: {
    contains: {
      label: "Contains",
      operand: {
        kind: "string",
      },
      parse: (raw: string) => raw,
      format: (operand: string) => operand,
      test: (value: unknown, operand: string) => formatJson(value).includes(operand),
    },
    equals: {
      label: "Equals",
      operand: {
        kind: "string",
      },
      parse: (raw: string) => raw,
      format: (operand: string) => operand,
      test: (value: unknown, operand: string) => formatJson(value) === operand,
    },
  },
} satisfies TypeModuleFilter<unknown>;

export const jsonMeta = {
  summary: {
    kind: "value",
    format: formatJson,
  },
  display: {
    kind: "text",
    allowed: ["text"] as const,
    format: formatJson,
  },
  editor: {
    kind: "textarea",
    allowed: ["text", "textarea"] as const,
    placeholder: '{"key":"value"}',
    multiline: true,
  },
} satisfies TypeModuleMeta<unknown, readonly ["text"], readonly ["text", "textarea"]>;

export const jsonType = defineScalar<unknown>({
  values: { key: "core:json", name: "JSON", icon: jsonIconSeed },
  encode: (value) => JSON.stringify(value),
  decode: (raw) => JSON.parse(raw) as unknown,
});

export const jsonTypeModule = defineScalarModule({
  type: jsonType,
  meta: jsonMeta,
  filter: jsonFilter,
});
