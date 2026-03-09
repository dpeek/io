import { useMemo, useRef, useSyncExternalStore } from "react";

import type { PredicateRangeTypeOf, PredicateRef, PredicateValueOf } from "../graph/client.js";
import { isEnumType, type AnyTypeOutput, type EdgeOutput } from "../graph/schema.js";

export type PredicateFieldMeta<T extends EdgeOutput> = T extends { meta: infer Meta } ? Meta : never;
export type PredicateCollectionKind = "ordered" | "unordered";

export type PredicateFieldBinding<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = {
  predicate: PredicateRef<T, Defs>;
  field: T;
  rangeType: PredicateRangeTypeOf<T, Defs>;
  meta: PredicateFieldMeta<T> | undefined;
  displayKind: string | undefined;
  editorKind: string | undefined;
  collectionKind: PredicateCollectionKind | undefined;
  value: PredicateValueOf<T, Defs>;
};

export type PredicateEnumOption = {
  id: string;
  key: string;
  label: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function sameSnapshotValue(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (left instanceof URL && right instanceof URL) return left.toString() === right.toString();

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!sameSnapshotValue(left[index], right[index])) return false;
    }
    return true;
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
      if (!(key in right)) return false;
      if (!sameSnapshotValue(left[key], right[key])) return false;
    }
    return true;
  }

  return Object.is(left, right);
}

export function getPredicateFieldMeta<T extends EdgeOutput>(
  field: T,
): PredicateFieldMeta<T> | undefined {
  return (field as T & { meta?: PredicateFieldMeta<T> }).meta;
}

export function getPredicateDisplayKind<T extends EdgeOutput>(field: T): string | undefined {
  const meta = getPredicateFieldMeta(field) as { display?: { kind?: string } } | undefined;
  return meta?.display?.kind;
}

export function getPredicateEditorKind<T extends EdgeOutput>(field: T): string | undefined {
  const meta = getPredicateFieldMeta(field) as { editor?: { kind?: string } } | undefined;
  return meta?.editor?.kind;
}

export function getPredicateEditorPlaceholder<T extends EdgeOutput>(field: T): string | undefined {
  const meta = getPredicateFieldMeta(field) as { editor?: { placeholder?: string } } | undefined;
  return meta?.editor?.placeholder;
}

export function getPredicateCollectionKind<T extends EdgeOutput>(
  field: T,
): PredicateCollectionKind | undefined {
  if (field.cardinality !== "many") return undefined;
  const meta = getPredicateFieldMeta(field) as { collection?: { kind?: PredicateCollectionKind } } | undefined;
  return meta?.collection?.kind ?? "ordered";
}

function getPredicateDisplayFormatter<T extends EdgeOutput>(
  field: T,
): ((value: unknown) => string) | undefined {
  const meta = getPredicateFieldMeta(field) as { display?: { format?: (value: unknown) => string } } | undefined;
  return meta?.display?.format;
}

function stringifyPredicateValue(value: unknown): string {
  if (value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (value instanceof URL) return value.toString();
  if (Array.isArray(value)) return value.map((item) => stringifyPredicateValue(item)).join(", ");
  return String(value);
}

function formatEnumOptionLabel<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
  predicate: PredicateRef<T, Defs>,
  option: { id?: string; key: string; name?: string },
): string {
  const formatter = getPredicateDisplayFormatter(predicate.field);
  if (formatter) return formatter(option.key);
  return option.name ?? option.key;
}

export function getPredicateEnumOptions<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
>(predicate: PredicateRef<T, Defs>): PredicateEnumOption[] {
  if (!predicate.rangeType || !isEnumType(predicate.rangeType)) return [];
  return Object.values(predicate.rangeType.options).map((option) => ({
    id: option.id ?? option.key,
    key: option.key,
    label: formatEnumOptionLabel(predicate, option),
  }));
}

export function formatPredicateValue<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
>(predicate: PredicateRef<T, Defs>, value: PredicateValueOf<T, Defs>): string {
  if (value === undefined) return "";
  const formatter = getPredicateDisplayFormatter(predicate.field);

  if (
    typeof value === "string" &&
    predicate.rangeType &&
    isEnumType(predicate.rangeType)
  ) {
    const option = getPredicateEnumOptions(predicate).find((candidate) => candidate.id === value);
    if (option) return option.label;
  }

  if (formatter) return formatter(value);
  return stringifyPredicateValue(value);
}

export function usePredicateValue<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
>(predicate: PredicateRef<T, Defs>): PredicateValueOf<T, Defs> {
  const hasSnapshotRef = useRef(false);
  const snapshotRef = useRef<PredicateValueOf<T, Defs> | undefined>(undefined);

  function readSnapshot(): PredicateValueOf<T, Defs> {
    const next = predicate.get();
    if (hasSnapshotRef.current && sameSnapshotValue(snapshotRef.current, next)) {
      return snapshotRef.current as PredicateValueOf<T, Defs>;
    }
    snapshotRef.current = next;
    hasSnapshotRef.current = true;
    return next;
  }

  return useSyncExternalStore(predicate.subscribe, readSnapshot, readSnapshot);
}

export function usePredicateField<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
>(predicate: PredicateRef<T, Defs>): PredicateFieldBinding<T, Defs> {
  const value = usePredicateValue(predicate);
  const meta = getPredicateFieldMeta(predicate.field);
  const displayKind = getPredicateDisplayKind(predicate.field);
  const editorKind = getPredicateEditorKind(predicate.field);
  const collectionKind = getPredicateCollectionKind(predicate.field);
  const rangeType = predicate.rangeType;

  return useMemo(
    () => ({
      predicate,
      field: predicate.field,
      rangeType,
      meta,
      displayKind,
      editorKind,
      collectionKind,
      value,
    }),
    [collectionKind, displayKind, editorKind, meta, predicate, rangeType, value],
  );
}
