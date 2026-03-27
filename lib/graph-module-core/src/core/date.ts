import type { TypeModuleFilter } from "@io/graph-module";
import type { TypeModuleMeta } from "@io/graph-module";
import { defineScalar } from "@io/graph-module";
import { defineScalarModule } from "@io/graph-module";

import { defineCoreIconSeed } from "../icon/seed.js";
import { expectDateInput } from "./input.js";

const dateIconSeed = defineCoreIconSeed("date", {
  name: "Date",
  svg: `<svg viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none" width="24" height="24" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <path d="M8 2v4" />
  <path d="M16 2v4" />
  <rect width="18" height="18" rx="2" x="3" y="4" />
  <path d="M3 10h18" />
</svg>`,
});

export function parseDate(raw: string): Date {
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) {
    throw new Error(`Invalid date value "${raw}"`);
  }
  return value;
}

export function formatDate(value: Date): string {
  return expectDateInput(value).toISOString();
}

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

export const dateType = defineScalar({
  values: { key: "core:date", name: "Date", icon: dateIconSeed },
  encode: formatDate,
  decode: parseDate,
});

export const dateTypeModule = defineScalarModule({
  type: dateType,
  meta: dateMeta,
  filter: dateFilter,
});
