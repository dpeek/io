import type { TypeModuleMeta } from "@io/core/graph/def";

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
