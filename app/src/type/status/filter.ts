import type { TypeModuleFilter } from "../../graph/type-module.js";
import type { EnumModuleValue } from "../../graph/type-module.js";
import { statusType } from "./type.js";

type StatusValue = EnumModuleValue<typeof statusType>;

const validStatusValues = new Set<StatusValue>([
  statusType.values.active.key,
  statusType.values.paused.key,
]);

function parseStatusValue(raw: string): StatusValue {
  if (!validStatusValues.has(raw as StatusValue)) {
    throw new Error(`Invalid status value "${raw}"`);
  }
  return raw as StatusValue;
}

export const statusFilter = {
  defaultOperator: "is",
  operators: {
    is: {
      label: "Is",
      operand: {
        kind: "enum",
        selection: "one",
      },
      parse: parseStatusValue,
      format: (operand: StatusValue) => operand,
      test: (value: StatusValue, operand: StatusValue) => value === operand,
    },
    oneOf: {
      label: "Is one of",
      operand: {
        kind: "enum",
        selection: "many",
      },
      parse: (raw: string) => raw.split(",").map((value) => parseStatusValue(value.trim())),
      format: (operand: StatusValue[]) => operand.join(","),
      test: (value: StatusValue, operand: StatusValue[]) => operand.includes(value),
    },
  },
} satisfies TypeModuleFilter<StatusValue>;
