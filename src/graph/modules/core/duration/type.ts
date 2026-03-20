import { defineScalar } from "@io/core/graph/def";

import { graphIconSeeds } from "../icon/seed.js";
import { expectNumberInput } from "../input.js";

export type DurationUnitKey = "ms" | "s" | "m" | "h" | "d" | "w";

type DurationUnit = Readonly<{
  key: DurationUnitKey;
  label: string;
  factor: number;
  aliases: readonly string[];
}>;

const durationUnitsAscending = [
  {
    key: "ms",
    label: "ms",
    factor: 1,
    aliases: ["ms", "millisecond", "milliseconds"],
  },
  {
    key: "s",
    label: "sec",
    factor: 1000,
    aliases: ["s", "sec", "secs", "second", "seconds"],
  },
  {
    key: "m",
    label: "min",
    factor: 60 * 1000,
    aliases: ["m", "min", "mins", "minute", "minutes"],
  },
  {
    key: "h",
    label: "hr",
    factor: 60 * 60 * 1000,
    aliases: ["h", "hr", "hrs", "hour", "hours"],
  },
  {
    key: "d",
    label: "day",
    factor: 24 * 60 * 60 * 1000,
    aliases: ["d", "day", "days"],
  },
  {
    key: "w",
    label: "wk",
    factor: 7 * 24 * 60 * 60 * 1000,
    aliases: ["w", "wk", "wks", "week", "weeks"],
  },
] as const satisfies readonly DurationUnit[];

const durationUnitsDescending = [...durationUnitsAscending].reverse();
const durationUnitByKey = new Map(durationUnitsAscending.map((unit) => [unit.key, unit]));
const durationUnitByAlias: ReadonlyMap<string, DurationUnit> = new Map(
  durationUnitsAscending.flatMap((unit) => unit.aliases.map((alias) => [alias, unit] as const)),
);

export const durationUnits = durationUnitsAscending;
export const defaultDurationUnitKey: DurationUnitKey = "m";

function formatDecimal(value: number, maximumFractionDigits: number): string {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Number(value.toFixed(maximumFractionDigits));
  return String(rounded);
}

function getDurationUnit(key: DurationUnitKey): DurationUnit {
  const unit = durationUnitByKey.get(key);
  if (!unit) {
    throw new Error(`Unknown duration unit "${key}".`);
  }
  return unit;
}

export function normalizeDurationInput(value: unknown): number {
  const duration = expectNumberInput(value);
  if (!Number.isFinite(duration)) {
    throw new Error("Duration values must be finite.");
  }
  return duration;
}

export function parseDuration(raw: string): number {
  const normalized = raw.trim().toLowerCase();
  const match = normalized.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))\s*([a-z]+)?$/);
  if (!match) {
    throw new Error(`Invalid duration value "${raw}"`);
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    throw new Error(`Invalid duration value "${raw}"`);
  }

  const unitToken = match[2];
  const unit = unitToken ? durationUnitByAlias.get(unitToken) : durationUnitByKey.get("ms");
  if (!unit) {
    throw new Error(`Invalid duration unit "${unitToken}"`);
  }

  return amount * unit.factor;
}

export function formatDurationAmount(value: number, unitKey: DurationUnitKey): string {
  const unit = getDurationUnit(unitKey);
  const amount = value / unit.factor;
  return formatDecimal(amount, unit.key === "ms" ? 0 : 2);
}

export function chooseDurationUnit(value: number): DurationUnit {
  const absolute = Math.abs(value);
  for (const unit of durationUnitsDescending) {
    if (absolute >= unit.factor) return unit;
  }
  return getDurationUnit("ms");
}

export function decomposeDuration(value: number): Readonly<{
  amount: string;
  unit: DurationUnit;
}> {
  const unit = chooseDurationUnit(value);
  return {
    amount: formatDurationAmount(value, unit.key),
    unit,
  };
}

export function formatDuration(value: number): string {
  const { amount, unit } = decomposeDuration(value);
  return `${amount} ${unit.label}`;
}

export function formatDurationEditorValue(value: number): string {
  return formatDuration(value);
}

export function convertDurationAmount(value: number, unitKey: DurationUnitKey): number {
  return value * getDurationUnit(unitKey).factor;
}

export const durationType = defineScalar({
  values: { key: "core:duration", name: "Duration", icon: graphIconSeeds.number },
  encode: (value: number) => String(normalizeDurationInput(value)),
  decode: (raw) => parseDuration(raw),
  validate: ({ value }) => {
    if (!Number.isFinite(value)) {
      return {
        code: "duration.notFinite",
        message: "Duration values must be finite.",
      };
    }

    if (value < 0) {
      return {
        code: "duration.negative",
        message: "Duration values must be zero or greater.",
      };
    }

    return undefined;
  },
});
