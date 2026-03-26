import type { TypeModuleMeta } from "../../../type-module.js";

export const stringMeta = {
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
    kind: "text",
    allowed: ["text", "textarea"] as const,
    placeholder: "Enter text",
  },
} satisfies TypeModuleMeta<string, readonly ["text"], readonly ["text", "textarea"]>;
