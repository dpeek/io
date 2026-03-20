import { createGraphId } from "./id";
import {
  fieldsMeta,
  type EnumTypeOutput,
  type EntityTypeOutput,
  type ScalarTypeOutput,
  isEnumType,
  isEntityType,
  isFieldsOutput,
  type AnyTypeOutput,
  type EdgeOutput,
  type FieldsOutput,
} from "./schema";

export type IdMap = {
  version: number;
  keys: Record<string, string>;
};

type MapKeysOptions = {
  strict?: boolean;
};

type IdNamespace = Record<string, AnyTypeOutput>;
type MutableEdge = EdgeOutput & { id?: string };
type MutableTreeMeta = { key: string; id?: string };
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

export type ResolvedNamespace<T extends IdNamespace> = {
  [K in keyof T]: ResolvedType<T[K]>;
};

function isEdgeOutput(value: unknown): value is EdgeOutput {
  const candidate = value as Partial<EdgeOutput>;
  return typeof candidate.key === "string" && typeof candidate.range === "string";
}

function normalizeMap(input: IdMap | Record<string, string>): Record<string, string> {
  const candidate = input as Partial<IdMap>;
  if (candidate.keys && typeof candidate.keys === "object") return candidate.keys;
  return input as Record<string, string>;
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
  keys: Record<string, string>,
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
      // Range is a reference slot, so resolution overwrites key->id in place.
      if (rangeId) mutableEdge.range = rangeId;
      continue;
    }
    if (isFieldsOutput(value)) assignFieldIds(value, keys, missing);
  }
}

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

export function createIdMap(
  namespace: IdNamespace,
  existing?: IdMap,
  options: { pruneOrphans?: boolean } = {},
): { map: IdMap; added: string[]; removed: string[] } {
  const schemaKeys = extractSchemaKeys(namespace);
  const nextKeys: Record<string, string> = { ...existing?.keys };
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

  const sorted: Record<string, string> = {};
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

export function findDuplicateIds(map: IdMap): Array<{ id: string; keys: string[] }> {
  const byId = new Map<string, string[]>();
  for (const [key, id] of Object.entries(map.keys)) {
    const bucket = byId.get(id);
    if (bucket) bucket.push(key);
    else byId.set(id, [key]);
  }

  const duplicates: Array<{ id: string; keys: string[] }> = [];
  for (const [id, keys] of byId) {
    if (keys.length <= 1) continue;
    duplicates.push({ id, keys: [...keys].sort((a, b) => a.localeCompare(b)) });
  }
  return duplicates.sort((a, b) => a.id.localeCompare(b.id));
}

export function defineNamespace<const T extends IdNamespace>(
  input: IdMap | Record<string, string>,
  namespace: T,
  options: MapKeysOptions = {},
): ResolvedNamespace<T> {
  const strict = options.strict ?? true;
  const keys = normalizeMap(input);
  const missing = new Set<string>();

  for (const typeDef of Object.values(namespace)) {
    const resolvedTypeId = keys[typeDef.values.key];
    const mutableValues = typeDef.values as { key: string; id?: string };
    if (resolvedTypeId) mutableValues.id = resolvedTypeId;
    else if (!mutableValues.id) missing.add(typeDef.values.key);

    if (isEntityType(typeDef)) assignFieldIds(typeDef.fields, keys, missing);
    if (isEnumType(typeDef)) {
      for (const option of Object.values(typeDef.options)) {
        const mutableOption = option as { key: string; id?: string };
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
