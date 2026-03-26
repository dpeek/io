import type { GraphStore } from "@io/graph-kernel";
import { edgeId, typeId } from "@io/graph-kernel";
import type { AnyTypeOutput, EdgeOutput, ScalarTypeOutput, TypeOutput } from "@io/graph-kernel";

import {
  clearFieldValue,
  encodeForRange,
  flattenPredicates,
  getNestedValue,
  hasNestedValue,
  readPredicateValue,
  sameLogicalValue,
  setNestedValue,
  type EntityOfType,
} from "./core";

export function assertOne(
  store: GraphStore,
  id: string,
  predicate: EdgeOutput,
  value: unknown,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): void {
  const encoded = encodeForRange(value, predicate.range, scalarByKey, typeByKey, enumValuesByRange);
  store.assert(id, edgeId(predicate), encoded);
}

export function assertMany(
  store: GraphStore,
  id: string,
  predicate: EdgeOutput,
  values: unknown[],
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): void {
  for (const value of values)
    assertOne(store, id, predicate, value, scalarByKey, typeByKey, enumValuesByRange);
}

export function retractPredicateFacts(store: GraphStore, id: string, predicate: EdgeOutput): void {
  for (const edge of store.facts(id, edgeId(predicate))) store.retract(edge.id);
}

export function commitCreateEntity<T extends TypeOutput>(
  store: GraphStore,
  id: string,
  typeDef: T,
  input: Record<string, unknown>,
  nodeTypePredicate: EdgeOutput,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): string {
  return store.batch(() => {
    const entries = flattenPredicates(typeDef.fields);
    store.assert(id, edgeId(nodeTypePredicate), typeId(typeDef));

    for (const entry of entries) {
      const value = getNestedValue(input, entry.path, entry.field);
      if (value === undefined) {
        if (entry.path.length === 0 && entry.predicate.key === nodeTypePredicate.key) continue;
        continue;
      }
      if (value === clearFieldValue) continue;
      if (entry.predicate.cardinality === "many") {
        assertMany(
          store,
          id,
          entry.predicate,
          value as unknown[],
          scalarByKey,
          typeByKey,
          enumValuesByRange,
        );
        continue;
      }
      assertOne(store, id, entry.predicate, value, scalarByKey, typeByKey, enumValuesByRange);
    }
    return id;
  });
}

export function projectEntity<T extends TypeOutput>(
  store: GraphStore,
  id: string,
  typeDef: T,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
): EntityOfType<T, Record<string, AnyTypeOutput>> {
  const out: Record<string, unknown> = { id };
  for (const entry of flattenPredicates(typeDef.fields)) {
    const value = readPredicateValue(store, id, entry.predicate, scalarByKey, typeByKey);
    setNestedValue(out, entry.path, entry.field, value);
  }
  return out as EntityOfType<T, Record<string, AnyTypeOutput>>;
}

export function commitUpdateEntity<T extends TypeOutput>(
  store: GraphStore,
  id: string,
  typeDef: T,
  input: Record<string, unknown>,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): EntityOfType<T, Record<string, AnyTypeOutput>> {
  return store.batch(() => {
    const entries = flattenPredicates(typeDef.fields);
    for (const entry of entries) {
      if (!hasNestedValue(input, entry.path, entry.field)) continue;
      const nextValue = getNestedValue(input, entry.path, entry.field);
      const previous = readPredicateValue(store, id, entry.predicate, scalarByKey, typeByKey);

      if (nextValue === clearFieldValue) {
        if (previous === undefined) continue;
        retractPredicateFacts(store, id, entry.predicate);
        continue;
      }

      if (entry.predicate.cardinality === "many") {
        if (sameLogicalValue(previous, nextValue)) continue;
        retractPredicateFacts(store, id, entry.predicate);
        assertMany(
          store,
          id,
          entry.predicate,
          nextValue as unknown[],
          scalarByKey,
          typeByKey,
          enumValuesByRange,
        );
        continue;
      }

      if (sameLogicalValue(previous, nextValue)) continue;
      retractPredicateFacts(store, id, entry.predicate);
      assertOne(store, id, entry.predicate, nextValue, scalarByKey, typeByKey, enumValuesByRange);
    }
    return projectEntity(store, id, typeDef, scalarByKey, typeByKey);
  });
}
