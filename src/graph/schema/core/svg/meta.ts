import type { TypeModuleMeta } from "../../../graph/type-module.js";

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
