import type { TypeModuleMeta } from "../../../type-module.js";

export const numberMeta = {
  summary: {
    kind: "value",
    format: (value: number) => String(value),
  },
  display: {
    kind: "number",
    allowed: ["number", "text"] as const,
    format: (value: number) => String(value),
  },
  editor: {
    kind: "number",
    allowed: ["number", "slider"] as const,
  },
} satisfies TypeModuleMeta<number, readonly ["number", "text"], readonly ["number", "slider"]>;
