import type { TypeModuleMeta } from "../../../graph/type-module.js";
import { formatDuration, formatDurationEditorValue, parseDuration } from "./type.js";

export const durationMeta = {
  summary: {
    kind: "value",
    format: formatDuration,
  },
  display: {
    kind: "number/duration",
    allowed: ["number/duration", "text"] as const,
    format: formatDuration,
  },
  editor: {
    kind: "number/duration",
    allowed: ["number/duration", "text"] as const,
    inputMode: "decimal",
    placeholder: "30 min",
    parse: parseDuration,
    format: formatDurationEditorValue,
  },
} satisfies TypeModuleMeta<
  number,
  readonly ["number/duration", "text"],
  readonly ["number/duration", "text"]
>;
