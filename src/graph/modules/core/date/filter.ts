import type { TypeModuleFilter } from "../../../graph/type-module.js";
import { formatDate, parseDate } from "./parse.js";

export const dateFilter = {
  defaultOperator: "on",
  operators: {
    on: {
      label: "On",
      operand: {
        kind: "date",
        placeholder: "2026-03-10T12:00:00.000Z",
      },
      parse: parseDate,
      format: formatDate,
      test: (value: Date, operand: Date) => value.getTime() === operand.getTime(),
    },
    before: {
      label: "Before",
      operand: {
        kind: "date",
        placeholder: "2026-03-10T12:00:00.000Z",
      },
      parse: parseDate,
      format: formatDate,
      test: (value: Date, operand: Date) => value.getTime() < operand.getTime(),
    },
    after: {
      label: "After",
      operand: {
        kind: "date",
        placeholder: "2026-03-10T12:00:00.000Z",
      },
      parse: parseDate,
      format: formatDate,
      test: (value: Date, operand: Date) => value.getTime() > operand.getTime(),
    },
  },
} satisfies TypeModuleFilter<Date>;
