import { useMemo, useRef, useSyncExternalStore } from "react";

import type { PredicateRef, PredicateValueOf } from "../graph/client.js";
import type { AnyTypeOutput, EdgeOutput } from "../graph/schema.js";

export type PredicateFieldMeta<T extends EdgeOutput> = T extends { meta: infer Meta } ? Meta : never;

export type PredicateFieldBinding<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = {
  predicate: PredicateRef<T, Defs>;
  field: T;
  meta: PredicateFieldMeta<T> | undefined;
  displayKind: string | undefined;
  editorKind: string | undefined;
  value: PredicateValueOf<T, Defs>;
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

  return useMemo(
    () => ({
      predicate,
      field: predicate.field,
      meta,
      displayKind,
      editorKind,
      value,
    }),
    [displayKind, editorKind, meta, predicate, value],
  );
}
