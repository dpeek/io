import type { TypeModuleFilter } from "@io/graph-module";
import type { TypeModuleMeta } from "@io/graph-module";
import { defineScalar } from "@io/graph-module";
import { defineScalarModule } from "@io/graph-module";

import { defineCoreIconSeed } from "../icon/seed.js";
import { expectBooleanInput } from "./input.js";

const booleanIconSeed = defineCoreIconSeed("boolean", {
  name: "Boolean",
  svg: `<svg viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none" width="24" height="24" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <path d="M9 11l3 3 10-10" />
  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
</svg>`,
});

function parseBoolean(raw: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`Invalid boolean value "${raw}"`);
}

export const booleanFilter = {
  defaultOperator: "is",
  operators: {
    is: {
      label: "Is",
      operand: {
        kind: "boolean",
      },
      parse: parseBoolean,
      format: (operand: boolean) => String(operand),
      test: (value: boolean, operand: boolean) => value === operand,
    },
    isNot: {
      label: "Is not",
      operand: {
        kind: "boolean",
      },
      parse: parseBoolean,
      format: (operand: boolean) => String(operand),
      test: (value: boolean, operand: boolean) => value !== operand,
    },
  },
} satisfies TypeModuleFilter<boolean>;

export const booleanMeta = {
  summary: {
    kind: "value",
    format: (value: boolean) => (value ? "True" : "False"),
  },
  display: {
    kind: "boolean",
    allowed: ["boolean", "text"] as const,
    format: (value: boolean) => (value ? "True" : "False"),
  },
  editor: {
    kind: "checkbox",
    allowed: ["checkbox", "switch"] as const,
  },
} satisfies TypeModuleMeta<boolean, readonly ["boolean", "text"], readonly ["checkbox", "switch"]>;

export const booleanType = defineScalar({
  values: { key: "core:boolean", name: "Boolean", icon: booleanIconSeed },
  encode: (value: boolean) => String(expectBooleanInput(value)),
  decode: (raw) => {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new Error(`Invalid boolean value "${raw}"`);
  },
});

export const booleanTypeModule = defineScalarModule({
  type: booleanType,
  meta: booleanMeta,
  filter: booleanFilter,
});
