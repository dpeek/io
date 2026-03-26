import { fieldsMeta } from "./field-tree-meta.js";
import { createGraphId, type GraphId } from "./id.js";
import {
  type EnumTypeOutput,
  type EntityTypeOutput,
  type ScalarTypeOutput,
  isEnumType,
  isEntityType,
  isFieldsOutput,
  type AnyTypeOutput,
  type EdgeOutput,
  type FieldsOutput,
} from "./schema.js";

/**
 * Durable mapping from schema-authored keys to stable opaque ids.
 */
export type GraphIdMap = {
  version: number;
  keys: Record<string, GraphId>;
};

type MapKeysOptions = {
  strict?: boolean;
};

type IdNamespace = Record<string, AnyTypeOutput>;
type MutableEdge = EdgeOutput & { id?: GraphId };
type MutableTreeMeta = { key: string; id?: GraphId };
type MutableFields = FieldsOutput & { [fieldsMeta]: MutableTreeMeta };

type DeepResolvedFields<T> = T extends FieldsOutput
  ? T & {
      [fieldsMeta]: T[typeof fieldsMeta] & { id: string };
    } & {
      [K in Exclude<keyof T, typeof fieldsMeta>]: T[K] extends EdgeOutput
        ? T[K] & { id: string }
        : T[K] extends FieldsOutput
          ? DeepResolvedFields<T[K]>
          : T[K];
    }
  : never;

type ResolvedType<T extends AnyTypeOutput> =
  T extends EntityTypeOutput<any, any>
    ? T & { values: T["values"] & { id: string }; fields: DeepResolvedFields<T["fields"]> }
    : T extends ScalarTypeOutput<any, any>
      ? T & { values: T["values"] & { id: string } }
      : T extends EnumTypeOutput<any, any>
        ? T & {
            values: Omit<T["values"], keyof T["options"]> & { id: string } & {
              [Alias in keyof T["options"]]: T["options"][Alias] & { id: string };
            };
            options: {
              [Alias in keyof T["options"]]: T["options"][Alias] & { id: string };
            };
          }
        : never;

/**
 * Namespace definitions after stable ids have been applied to every owned
 * type, field tree, predicate, and enum option.
 */
export type ResolvedNamespace<T extends IdNamespace> = {
  [K in keyof T]: ResolvedType<T[K]>;
};

function isEdgeOutput(value: unknown): value is EdgeOutput {
  const candidate = value as Partial<EdgeOutput>;
  return typeof candidate.key === "string" && typeof candidate.range === "string";
}

function normalizeMap(input: GraphIdMap | Record<string, GraphId>): Record<string, GraphId> {
  const candidate = input as Partial<GraphIdMap>;
  if (candidate.keys && typeof candidate.keys === "object") return candidate.keys;
  return input as Record<string, GraphId>;
}

function validateNormalizedMap(keys: Record<string, GraphId>): void {
  const invalidKeys = Object.entries(keys)
    .filter(([, id]) => typeof id !== "string" || id.length === 0)
    .map(([key]) => key)
    .sort((a, b) => a.localeCompare(b));
  if (invalidKeys.length > 0) {
    throw new Error(`Invalid stable ids for keys: ${invalidKeys.join(", ")}`);
  }

  const duplicates = findDuplicateIds({ version: 1, keys });
  if (duplicates.length === 0) return;

  const details = duplicates
    .map(({ id, keys: duplicateKeys }) => `${id} (${duplicateKeys.join(", ")})`)
    .join("; ");
  throw new Error(`Duplicate stable ids: ${details}`);
}

function walkOwnedKeys(tree: FieldsOutput, keys: Set<string>): void {
  keys.add(tree[fieldsMeta].key);
  for (const value of Object.values(tree) as unknown[]) {
    if (isEdgeOutput(value)) {
      keys.add(value.key);
      continue;
    }
    if (isFieldsOutput(value)) walkOwnedKeys(value, keys);
  }
}

function assignFieldIds(
  tree: FieldsOutput,
  keys: Record<string, GraphId>,
  missing: Set<string>,
): void {
  const mutableTree = tree as MutableFields;
  const treeId = keys[mutableTree[fieldsMeta].key];
  if (treeId) mutableTree[fieldsMeta].id = treeId;
  else if (!mutableTree[fieldsMeta].id) missing.add(mutableTree[fieldsMeta].key);

  for (const value of Object.values(mutableTree) as unknown[]) {
    if (isEdgeOutput(value)) {
      const mutableEdge = value as MutableEdge;
      const predicateId = keys[mutableEdge.key];
      if (predicateId) mutableEdge.id = predicateId;
      else if (!mutableEdge.id) missing.add(mutableEdge.key);

      const rangeId = keys[mutableEdge.range];
      if (rangeId) mutableEdge.range = rangeId;
      continue;
    }
    if (isFieldsOutput(value)) assignFieldIds(value, keys, missing);
  }
}

/**
 * Extract the schema-owned keys that require stable ids.
 *
 * The result is filtered to the namespace prefixes owned by the provided
 * definitions so unrelated foreign keys do not become accidental id-map
 * obligations.
 */
export function extractSchemaKeys(namespace: IdNamespace): string[] {
  const keys = new Set<string>();
  const ownedPrefixes = new Set<string>();
  for (const typeDef of Object.values(namespace)) {
    keys.add(typeDef.values.key);
    const [prefix] = typeDef.values.key.split(":");
    if (prefix) ownedPrefixes.add(prefix);
    if (isEntityType(typeDef)) walkOwnedKeys(typeDef.fields, keys);
    if (isEnumType(typeDef)) {
      for (const option of Object.values(typeDef.options)) {
        keys.add(option.key);
      }
    }
  }
  const filtered = [...keys].filter((key) => {
    const prefix = key.split(":")[0] ?? "";
    return ownedPrefixes.has(prefix);
  });
  return filtered.sort((a, b) => a.localeCompare(b));
}

/**
 * Reconcile stable ids for one namespace.
 *
 * Existing ids are preserved, new schema keys receive new ids, and orphaned
 * ids are retained unless `pruneOrphans` is requested explicitly. The returned
 * map is sorted by key for stable serialization.
 */
export function createIdMap(
  namespace: IdNamespace,
  existing?: GraphIdMap,
  options: { pruneOrphans?: boolean } = {},
): { map: GraphIdMap; added: string[]; removed: string[] } {
  if (existing) validateNormalizedMap(existing.keys);
  const schemaKeys = extractSchemaKeys(namespace);
  const nextKeys: Record<string, GraphId> = { ...existing?.keys };
  const added: string[] = [];
  const removed: string[] = [];

  for (const key of schemaKeys) {
    if (!nextKeys[key]) {
      nextKeys[key] = createGraphId();
      added.push(key);
    }
  }

  if (options.pruneOrphans) {
    const keep = new Set(schemaKeys);
    for (const key of Object.keys(nextKeys)) {
      if (keep.has(key)) continue;
      delete nextKeys[key];
      removed.push(key);
    }
  }

  const sorted: Record<string, GraphId> = {};
  for (const key of Object.keys(nextKeys).sort((a, b) => a.localeCompare(b))) {
    const value = nextKeys[key];
    if (value) sorted[key] = value;
  }

  return {
    map: { version: 1, keys: sorted },
    added: added.sort((a, b) => a.localeCompare(b)),
    removed: removed.sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * Find duplicated opaque ids in one graph id map.
 */
export function findDuplicateIds(map: GraphIdMap): Array<{ id: GraphId; keys: string[] }> {
  const byId = new Map<GraphId, string[]>();
  for (const [key, id] of Object.entries(map.keys)) {
    const bucket = byId.get(id);
    if (bucket) bucket.push(key);
    else byId.set(id, [key]);
  }

  const duplicates: Array<{ id: GraphId; keys: string[] }> = [];
  for (const [id, keys] of byId) {
    if (keys.length <= 1) continue;
    duplicates.push({ id, keys: [...keys].sort((a, b) => a.localeCompare(b)) });
  }
  return duplicates.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Apply one stable id map to authored schema definitions.
 *
 * This mutates the provided namespace objects in place by injecting resolved
 * ids into type, field-tree, predicate, and enum-option records. Predicate
 * ranges are also rewritten from authored keys to resolved ids when the mapped
 * range id is available.
 */
export function applyIdMap<const T extends IdNamespace>(
  input: GraphIdMap | Record<string, GraphId>,
  namespace: T,
  options: MapKeysOptions = {},
): ResolvedNamespace<T> {
  const strict = options.strict ?? true;
  const keys = normalizeMap(input);
  validateNormalizedMap(keys);
  const missing = new Set<string>();

  for (const typeDef of Object.values(namespace)) {
    const resolvedTypeId = keys[typeDef.values.key];
    const mutableValues = typeDef.values as { key: string; id?: GraphId };
    if (resolvedTypeId) mutableValues.id = resolvedTypeId;
    else if (!mutableValues.id) missing.add(typeDef.values.key);

    if (isEntityType(typeDef)) assignFieldIds(typeDef.fields, keys, missing);
    if (isEnumType(typeDef)) {
      for (const option of Object.values(typeDef.options)) {
        const mutableOption = option as { key: string; id?: GraphId };
        const optionId = keys[mutableOption.key];
        if (optionId) mutableOption.id = optionId;
        else if (!mutableOption.id) missing.add(mutableOption.key);
      }
    }
  }

  if (strict && missing.size > 0) {
    throw new Error(
      `Missing stable ids for keys: ${[...missing].sort((a, b) => a.localeCompare(b)).join(", ")}`,
    );
  }

  return namespace as unknown as ResolvedNamespace<T>;
}
