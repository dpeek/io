import type { TypeModuleMeta } from "../../../graph/type-module.js";

export const markdownMeta = {
  searchable: true,
  summary: {
    kind: "value",
    format: (value: string) => value,
  },
  display: {
    kind: "markdown",
    allowed: ["text", "markdown"] as const,
    format: (value: string) => value,
  },
  editor: {
    kind: "markdown",
    allowed: ["text", "textarea", "markdown"] as const,
    placeholder: "# Topic title",
    multiline: true,
  },
} satisfies TypeModuleMeta<
  string,
  readonly ["text", "markdown"],
  readonly ["text", "textarea", "markdown"]
>;
