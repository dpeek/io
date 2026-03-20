import type { TypeModuleMeta } from "../../../graph/type-module.js";
import { formatDate } from "./parse.js";

export const dateMeta = {
  searchable: true,
  summary: {
    kind: "value",
    format: formatDate,
  },
  display: {
    kind: "date",
    allowed: ["date", "text"] as const,
    format: formatDate,
  },
  editor: {
    kind: "date",
    allowed: ["date", "text"] as const,
    placeholder: "2026-03-10T12:00:00.000Z",
  },
} satisfies TypeModuleMeta<Date, readonly ["date", "text"], readonly ["date", "text"]>;
