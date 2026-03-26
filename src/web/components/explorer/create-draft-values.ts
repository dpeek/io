import { type EdgeOutput } from "@io/core/graph";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

export function cloneDraftValue<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (value instanceof URL) return new URL(value.toString()) as T;
  if (Array.isArray(value)) return value.map((item) => cloneDraftValue(item)) as T;
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nextValue]) => [key, cloneDraftValue(nextValue)]),
    ) as T;
  }
  return value;
}

export function sameLogicalValue(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (left instanceof URL && right instanceof URL) return left.toString() === right.toString();

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!sameLogicalValue(left[index], right[index])) return false;
    }
    return true;
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
      if (!(key in right)) return false;
      if (!sameLogicalValue(left[key], right[key])) return false;
    }
    return true;
  }

  return Object.is(left, right);
}

export function getDraftValue(
  input: Record<string, unknown>,
  path: readonly string[],
  fieldName: string,
  field: EdgeOutput,
): unknown {
  let current: unknown = input;
  for (const segment of path) {
    if (!isPlainObject(current) || !(segment in current)) {
      return field.cardinality === "many" ? [] : undefined;
    }
    current = current[segment];
  }

  if (!isPlainObject(current) || !(fieldName in current)) {
    return field.cardinality === "many" ? [] : undefined;
  }

  const value = current[fieldName];
  if (value === undefined) return field.cardinality === "many" ? [] : undefined;
  return cloneDraftValue(value);
}

export function setDraftValue(
  input: Record<string, unknown>,
  path: readonly string[],
  fieldName: string,
  nextValue: unknown,
): Record<string, unknown> {
  const nextInput = cloneDraftValue(input);
  let current: Record<string, unknown> = nextInput;

  for (const segment of path) {
    const existing = current[segment];
    if (!isPlainObject(existing)) {
      const created: Record<string, unknown> = {};
      current[segment] = created;
      current = created;
      continue;
    }
    current = existing;
  }

  if (nextValue === undefined) {
    delete current[fieldName];
  } else {
    current[fieldName] = cloneDraftValue(nextValue);
  }

  return nextInput;
}

export function removeDraftItem(values: readonly unknown[], value: unknown): unknown[] {
  const nextValues = [...values];
  const index = nextValues.findIndex((candidate) => sameLogicalValue(candidate, value));
  if (index >= 0) nextValues.splice(index, 1);
  return nextValues;
}
