import type { TypeModuleMeta } from "../../../graph/type-module.js";

export const urlMeta = {
  searchable: true,
  summary: {
    kind: "value",
    format: (value: URL) => value.toString(),
  },
  display: {
    kind: "link",
    allowed: ["link", "external-link", "text"] as const,
    format: (value: URL) => value.toString(),
  },
  editor: {
    kind: "url",
    allowed: ["url", "text"] as const,
    placeholder: "https://example.com",
  },
} satisfies TypeModuleMeta<
  URL,
  readonly ["link", "external-link", "text"],
  readonly ["url", "text"]
>;
