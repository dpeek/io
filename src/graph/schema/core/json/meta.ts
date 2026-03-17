import type { TypeModuleMeta } from "../../../graph/type-module.js";

function formatJson(value: unknown): string {
  return JSON.stringify(value);
}

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
