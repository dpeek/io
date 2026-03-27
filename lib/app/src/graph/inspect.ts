import type { GraphId, GraphStore } from "@io/graph-kernel";
import { edgeId, typeId, type EdgeOutput } from "@io/graph-kernel";
import { core } from "@io/graph-module-core";

/**
 * Internal graph inspection helpers for turning store state into plain objects.
 *
 * These helpers intentionally stay out of the published package surface for
 * now. They depend on core-schema conventions ("key", "name", and core scalar
 * codecs) and are better treated as debugging/inspection utilities than as a
 * stable runtime contract.
 */

/**
 * Returns the serialization key for a predicate node:
 * key value → name value → raw id (as fallback)
 */
export function getKey(store: GraphStore, predicateId: GraphId): string {
  const keyPredicate = core.predicate.fields.key as EdgeOutput;
  const namePredicate = core.node.fields.name as EdgeOutput;
  const k = store.get(predicateId, edgeId(keyPredicate));
  if (k) return k;
  const l = store.get(predicateId, edgeId(namePredicate));
  if (l) return l;
  return predicateId;
}

/**
 * Materializes a single entity into a plain object by walking all its current facts.
 *
 * - Property name: key (or name) of the predicate
 * - Value: decoded through scalar range codecs, or the LABEL of a referenced entity
 * - Multiple values for the same predicate are collected into an array
 */
export function toObject(store: GraphStore, id: GraphId): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rangePredicate = core.predicate.fields.range as EdgeOutput;

  for (const edge of store.facts(id)) {
    const key = getKey(store, edge.p);
    const range = store.get(edge.p, edgeId(rangePredicate));
    const raw = decodeByRange(store, edge.o, range);

    const existing = out[key];
    if (existing !== undefined) {
      out[key] = Array.isArray(existing) ? [...existing, raw] : [existing, raw];
    } else {
      out[key] = raw;
    }
  }

  return out;
}

/**
 * Materializes all T_PREDICATE nodes in the store into a single keyed object,
 * indexed by each node's KEY (or LABEL). This is the full schema as plain JSON.
 */
export function materializeSchema(store: GraphStore): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  const typePredicate = core.node.fields.type as EdgeOutput;

  for (const edge of store.facts(undefined, edgeId(typePredicate), typeId(core.predicate))) {
    const key = getKey(store, edge.s);
    out[key] = toObject(store, edge.s);
  }

  return out;
}

function resolveLabel(store: GraphStore, id: GraphId): string {
  const namePredicate = core.node.fields.name as EdgeOutput;
  const labelId = store.get(id, edgeId(namePredicate));
  return labelId ?? id;
}

function decodeByRange(store: GraphStore, raw: GraphId, range: GraphId | undefined): unknown {
  if (!range) return maybeResolveEntity(store, raw);

  // Decode through core scalar codecs when the predicate range is a known core scalar.
  const scalar = (Object.values(core) as Array<(typeof core)[keyof typeof core]>).find(
    (typeDef): typeDef is (typeof core)[keyof typeof core] & { kind: "scalar" } =>
      typeDef.kind === "scalar" && typeId(typeDef) === range,
  );
  if (scalar) {
    const value = scalar.decode(raw);
    if (value instanceof Date) return value.toISOString();
    if (value instanceof URL) return value.toString();
    return value;
  }

  return maybeResolveEntity(store, raw);
}

function maybeResolveEntity(store: GraphStore, id: GraphId): string {
  const existsAsNode =
    store.facts(id).length > 0 || store.facts(undefined, undefined, id).length > 0;
  if (!existsAsNode) return id;
  return resolveLabel(store, id);
}
