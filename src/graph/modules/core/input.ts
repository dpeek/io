function describeInputKind(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "Date";
  if (value instanceof URL) return "URL";
  return typeof value;
}

function createInputTypeError(expected: string, value: unknown): Error {
  return new Error(`Expected ${expected} value, got ${describeInputKind(value)}.`);
}

export function expectStringInput(value: unknown): string {
  if (typeof value !== "string") throw createInputTypeError("string", value);
  return value;
}

export function expectNumberInput(value: unknown): number {
  if (typeof value !== "number") throw createInputTypeError("number", value);
  return value;
}

export function expectBooleanInput(value: unknown): boolean {
  if (typeof value !== "boolean") throw createInputTypeError("boolean", value);
  return value;
}

export function expectUrlInput(value: unknown): URL {
  if (!(value instanceof URL)) throw createInputTypeError("URL", value);
  return value;
}

export function expectDateInput(value: unknown): Date {
  if (!(value instanceof Date)) throw createInputTypeError("Date", value);
  if (Number.isNaN(value.getTime())) {
    throw new Error('Expected Date value, got invalid "Date".');
  }
  return value;
}
