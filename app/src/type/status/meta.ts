import type { EnumModuleValue } from "../../graph/type-module.js";
import { statusType } from "./type.js";

type StatusValue = EnumModuleValue<typeof statusType>;

const statusLabels: Record<StatusValue, string> = {
  [statusType.values.active.key]: statusType.values.active.name ?? statusType.values.active.key,
  [statusType.values.paused.key]: statusType.values.paused.name ?? statusType.values.paused.key,
};

export const statusMeta = {
  searchable: true,
  summary: {
    kind: "value",
    format: (value: StatusValue) => statusLabels[value] ?? value,
  },
  display: {
    kind: "text",
    allowed: ["text", "badge"] as const,
    format: (value: StatusValue) => statusLabels[value] ?? value,
  },
  editor: {
    kind: "select",
    allowed: ["select", "segmented-control"] as const,
  },
} satisfies import("../../graph/type-module.js").TypeModuleMeta<
  StatusValue,
  readonly ["text", "badge"],
  readonly ["select", "segmented-control"]
>;
