import { expectDateInput } from "../input.js";

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
