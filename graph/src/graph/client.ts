import { core } from "./core";
import { edgeId, fieldsMeta, isEnumType, isFieldsOutput, isScalarType, typeId } from "./schema";
import type {
  AnyTypeOutput,
  Cardinality,
  EdgeOutput,
  FieldsOutput,
  ScalarTypeOutput,
  TypeOutput,
} from "./schema";
import type { Store } from "./store";

type TypeByKey<Defs extends Record<string, AnyTypeOutput>, K extends string> = Extract<
  Defs[keyof Defs],
  { values: { key: K } }
>;

type PrimitiveForRange<R extends string, Defs extends Record<string, AnyTypeOutput>> = [
  TypeByKey<Defs, R>,
] extends [never]
  ? string
  : TypeByKey<Defs, R> extends ScalarTypeOutput<infer Decoded>
    ? Decoded
    : string;

type Cardinalized<
  R extends string,
  C extends Cardinality,
  Defs extends Record<string, AnyTypeOutput>,
> = C extends "many"
  ? PrimitiveForRange<R, Defs>[]
  : C extends "one?"
    ? PrimitiveForRange<R, Defs> | undefined
    : PrimitiveForRange<R, Defs>;

type FieldsTree = { [fieldsMeta]: { key: string } } & Record<string, unknown>;

type TreeEntity<T, Defs extends Record<string, AnyTypeOutput>> = T extends EdgeOutput
  ? Cardinalized<T["range"], T["cardinality"], Defs>
  : T extends FieldsTree
    ? { [K in Exclude<keyof T, typeof fieldsMeta>]: TreeEntity<T[K], Defs> }
    : never;

type TreeCreate<T, Defs extends Record<string, AnyTypeOutput>> = T extends EdgeOutput
  ? T["cardinality"] extends "one"
    ? PrimitiveForRange<T["range"], Defs>
    : T["cardinality"] extends "many"
      ? PrimitiveForRange<T["range"], Defs>[]
      : PrimitiveForRange<T["range"], Defs> | undefined
  : T extends FieldsTree
    ? {
        [K in Exclude<keyof T, typeof fieldsMeta> as T[K] extends EdgeOutput
          ? T[K]["cardinality"] extends "one"
            ? K
            : never
          : never]-?: TreeCreate<T[K], Defs>;
      } & {
        [K in Exclude<keyof T, typeof fieldsMeta> as T[K] extends EdgeOutput
          ? T[K]["cardinality"] extends "one"
            ? never
            : K
          : K]?: TreeCreate<T[K], Defs>;
      }
    : never;

type CoreDefs = typeof core;
type AllDefs<NS extends Record<string, AnyTypeOutput>> = NS & CoreDefs;

export type EntityOfType<
  T extends TypeOutput,
  Defs extends Record<string, AnyTypeOutput> = CoreDefs,
> = { id: string } & TreeEntity<T["fields"], Defs>;
export type CreateInputOfType<
  T extends TypeOutput,
  Defs extends Record<string, AnyTypeOutput> = CoreDefs,
> = TreeCreate<T["fields"], Defs>;

type FlatPredicateEntry = {
  path: string[];
  field: string;
  predicate: EdgeOutput;
};

type PredicateValue = unknown[] | unknown | undefined;

function isEdgeOutput(value: unknown): value is EdgeOutput {
  const candidate = value as Partial<EdgeOutput>;
  return typeof candidate.key === "string" && typeof candidate.range === "string";
}

function isTree(value: unknown): value is FieldsOutput {
  return isFieldsOutput(value);
}

function flattenPredicates(tree: FieldsOutput | undefined): FlatPredicateEntry[] {
  if (!tree) return [];
  const out: FlatPredicateEntry[] = [];

  function walk(node: FieldsOutput, path: string[]): void {
    for (const [field, value] of Object.entries(node)) {
      if (isEdgeOutput(value)) {
        out.push({ path, field, predicate: value });
        continue;
      }
      if (isTree(value)) walk(value, [...path, field]);
    }
  }

  walk(tree, []);
  return out;
}

function getNestedValue(obj: Record<string, unknown>, path: string[], field: string): unknown {
  let current: unknown = obj;
  for (const part of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  if (!current || typeof current !== "object") return undefined;
  return (current as Record<string, unknown>)[field];
}

function setNestedValue(
  obj: Record<string, unknown>,
  path: string[],
  field: string,
  value: unknown,
): void {
  let current = obj;
  for (const part of path) {
    if (!current[part] || typeof current[part] !== "object") current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[field] = value;
}

function cloneInput<T>(input: T): T {
  function cloneValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => cloneValue(item));
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof URL) return new URL(value.toString());
    if (!value || typeof value !== "object") return value;
    if (Object.getPrototypeOf(value) !== Object.prototype) return value;
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) out[key] = cloneValue(nested);
    return out;
  }

  return cloneValue(input) as T;
}

function collectChangedPredicateKeys(
  input: Record<string, unknown>,
  entries: FlatPredicateEntry[],
): Set<string> {
  const changed = new Set<string>();
  for (const entry of entries) {
    if (getNestedValue(input, entry.path, entry.field) === undefined) continue;
    changed.add(entry.predicate.key);
  }
  return changed;
}

function encodeForRange(
  value: unknown,
  range: string,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): string {
  const scalarType = scalarByKey.get(range);
  if (scalarType) return scalarType.encode(value);

  const rangeType = typeByKey.get(range);
  const enumValues = enumValuesByRange.get(range);
  if (rangeType?.kind === "enum" || enumValues) {
    if (typeof value !== "string")
      throw new Error(`Expected enum value id string for range "${range}", got ${typeof value}`);
    if (!enumValues?.has(value)) {
      throw new Error(`Invalid enum value "${value}" for range "${range}"`);
    }
    return value;
  }

  if (rangeType?.kind === "entity") {
    if (typeof value !== "string")
      throw new Error(`Expected entity id string for range "${range}", got ${typeof value}`);
    return value;
  }

  // Unknown range defaults to raw string passthrough.
  if (typeof value !== "string")
    throw new Error(`Expected string for unknown range "${range}", got ${typeof value}`);
  return value;
}

function decodeForRange(
  raw: string,
  range: string,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
): unknown {
  const scalarType = scalarByKey.get(range);
  if (scalarType) return scalarType.decode(raw);

  const rangeType = typeByKey.get(range);
  if (rangeType?.kind === "entity") return raw;

  // Unknown range defaults to raw string passthrough.
  return raw;
}

function readPredicateValue(
  store: Store,
  id: string,
  predicate: EdgeOutput,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
): PredicateValue {
  const facts = store.facts(id, edgeId(predicate));
  if (predicate.cardinality === "many") {
    return facts.map((edge) => decodeForRange(edge.o, predicate.range, scalarByKey, typeByKey));
  }
  if (!facts[0]) return undefined;
  return decodeForRange(facts[0].o, predicate.range, scalarByKey, typeByKey);
}

function applyLifecycleHooks(
  event: "create" | "update",
  input: Record<string, unknown>,
  entries: FlatPredicateEntry[],
  store: Store,
  nodeId: string,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
): Set<string> {
  const now = new Date();
  const changedPredicateKeys = collectChangedPredicateKeys(input, entries);
  for (const entry of entries) {
    const hook = event === "create" ? entry.predicate.onCreate : entry.predicate.onUpdate;
    if (!hook) continue;
    const incoming = getNestedValue(input, entry.path, entry.field);
    const previous =
      event === "update"
        ? readPredicateValue(store, nodeId, entry.predicate, scalarByKey, typeByKey)
        : undefined;
    const next = hook({
      event,
      nodeId,
      now,
      incoming,
      previous,
      changedPredicateKeys,
    });
    if (next === undefined) continue;
    setNestedValue(input, entry.path, entry.field, next);
    changedPredicateKeys.add(entry.predicate.key);
  }
  return changedPredicateKeys;
}

function assertOne(
  store: Store,
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

function assertMany(
  store: Store,
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

function createEntity<T extends TypeOutput>(
  store: Store,
  typeDef: T,
  data: CreateInputOfType<T, Record<string, AnyTypeOutput>>,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): string {
  const entries = flattenPredicates(typeDef.fields);
  const nodeTypePredicate = core.node.fields.type as EdgeOutput;
  const nodeTypePredicateId = edgeId(nodeTypePredicate);
  const id = store.newNode();
  const input = cloneInput(data as Record<string, unknown>);
  applyLifecycleHooks("create", input, entries, store, id, scalarByKey, typeByKey);
  store.assert(id, nodeTypePredicateId, typeId(typeDef));

  for (const entry of entries) {
    const value = getNestedValue(input, entry.path, entry.field);
    if (value === undefined) {
      if (entry.path.length === 0 && entry.predicate.key === nodeTypePredicate.key) {
        continue;
      }
      if (entry.predicate.cardinality === "one") {
        throw new Error(`Missing required field "${[...entry.path, entry.field].join(".")}"`);
      }
      continue;
    }
    if (entry.predicate.cardinality === "many") {
      if (!Array.isArray(value))
        throw new Error(`Field "${[...entry.path, entry.field].join(".")}" must be an array`);
      assertMany(store, id, entry.predicate, value, scalarByKey, typeByKey, enumValuesByRange);
      continue;
    }
    assertOne(store, id, entry.predicate, value, scalarByKey, typeByKey, enumValuesByRange);
  }
  return id;
}

function projectEntity<T extends TypeOutput>(
  store: Store,
  id: string,
  typeDef: T,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
): EntityOfType<T, Record<string, AnyTypeOutput>> {
  const out: Record<string, unknown> = { id };
  for (const entry of flattenPredicates(typeDef.fields)) {
    const facts = store.facts(id, edgeId(entry.predicate));
    const value =
      entry.predicate.cardinality === "many"
        ? facts.map((edge) => decodeForRange(edge.o, entry.predicate.range, scalarByKey, typeByKey))
        : facts[0]
          ? decodeForRange(facts[0].o, entry.predicate.range, scalarByKey, typeByKey)
          : undefined;
    setNestedValue(out, entry.path, entry.field, value);
  }
  return out as EntityOfType<T, Record<string, AnyTypeOutput>>;
}

function updateEntity<T extends TypeOutput>(
  store: Store,
  id: string,
  typeDef: T,
  patch: Partial<CreateInputOfType<T, Record<string, AnyTypeOutput>>>,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): EntityOfType<T, Record<string, AnyTypeOutput>> {
  const entries = flattenPredicates(typeDef.fields);
  const input = cloneInput(patch as Record<string, unknown>);
  applyLifecycleHooks("update", input, entries, store, id, scalarByKey, typeByKey);
  for (const entry of entries) {
    const nextValue = getNestedValue(input, entry.path, entry.field);
    if (nextValue === undefined) continue;
    for (const edge of store.facts(id, edgeId(entry.predicate))) store.retract(edge.id);
    if (entry.predicate.cardinality === "many") {
      if (!Array.isArray(nextValue))
        throw new Error(`Field "${[...entry.path, entry.field].join(".")}" must be an array`);
      assertMany(store, id, entry.predicate, nextValue, scalarByKey, typeByKey, enumValuesByRange);
    } else {
      assertOne(store, id, entry.predicate, nextValue, scalarByKey, typeByKey, enumValuesByRange);
    }
  }
  return projectEntity(store, id, typeDef, scalarByKey, typeByKey);
}

function deleteEntity(store: Store, id: string): void {
  for (const edge of store.facts(id)) store.retract(edge.id);
}

type TypeHandle<T extends TypeOutput, Defs extends Record<string, AnyTypeOutput>> = {
  create(input: CreateInputOfType<T, Defs>): string;
  get(id: string): EntityOfType<T, Defs>;
  update(id: string, patch: Partial<CreateInputOfType<T, Defs>>): EntityOfType<T, Defs>;
  delete(id: string): void;
  list(): EntityOfType<T, Defs>[];
  node(id: string): {
    get(): EntityOfType<T, Defs>;
    update(patch: Partial<CreateInputOfType<T, Defs>>): EntityOfType<T, Defs>;
    delete(): void;
  };
};

export type NamespaceClient<T extends Record<string, AnyTypeOutput>> = {
  [K in keyof T as T[K] extends { kind: "entity" } ? K : never]: TypeHandle<
    Extract<T[K], { kind: "entity" }>,
    AllDefs<T>
  >;
};

function collectScalarCodecs(
  namespace: Record<string, AnyTypeOutput>,
): Map<string, ScalarTypeOutput<any>> {
  const out = new Map<string, ScalarTypeOutput<any>>();
  const combined = [...Object.values(core), ...Object.values(namespace)];
  for (const typeDef of combined) {
    if (!isScalarType(typeDef)) continue;
    out.set(typeDef.values.key, typeDef);
    out.set(typeId(typeDef), typeDef);
  }
  return out;
}

function collectTypeIndex(namespace: Record<string, AnyTypeOutput>): Map<string, AnyTypeOutput> {
  const out = new Map<string, AnyTypeOutput>();
  const combined = [...Object.values(core), ...Object.values(namespace)];
  for (const typeDef of combined) {
    out.set(typeDef.values.key, typeDef);
    out.set(typeId(typeDef), typeDef);
  }
  return out;
}

function collectEnumValueIds(
  namespace: Record<string, AnyTypeOutput>,
  typeByKey: Map<string, AnyTypeOutput>,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const combined = [...Object.values(core), ...Object.values(namespace)];
  for (const typeDef of combined) {
    if (!isEnumType(typeDef)) continue;
    const allowed = new Set<string>();
    for (const option of Object.values(typeDef.options)) {
      const optionId = option.id ?? option.key;
      allowed.add(optionId);
    }
    out.set(typeDef.values.key, allowed);
    out.set(typeId(typeDef), allowed);
  }

  for (const [range, typeDef] of typeByKey) {
    if (!isEnumType(typeDef) || out.has(range)) continue;
    const allowed = new Set<string>();
    for (const option of Object.values(typeDef.options)) {
      allowed.add(option.id ?? option.key);
    }
    out.set(range, allowed);
  }

  return out;
}

export function createTypeClient<const T extends Record<string, AnyTypeOutput>>(
  store: Store,
  namespace: T,
): NamespaceClient<T> {
  const nodeTypePredicate = core.node.fields.type as EdgeOutput;
  const nodeTypePredicateId = edgeId(nodeTypePredicate);
  const scalarByKey = collectScalarCodecs(namespace);
  const typeByKey = collectTypeIndex(namespace);
  const enumValuesByRange = collectEnumValueIds(namespace, typeByKey);
  return new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key !== "string") return undefined;
        const typeDef = namespace[key as keyof T];
        if (!typeDef || typeDef.kind !== "entity") return undefined;

        const handle: TypeHandle<any, any> = {
          create(input: unknown) {
            return createEntity(
              store,
              typeDef as any,
              input as any,
              scalarByKey,
              typeByKey,
              enumValuesByRange,
            );
          },
          get(id: string) {
            return projectEntity(store, id, typeDef as any, scalarByKey, typeByKey);
          },
          update(id: string, patch: unknown) {
            return updateEntity(
              store,
              id,
              typeDef as any,
              patch as any,
              scalarByKey,
              typeByKey,
              enumValuesByRange,
            );
          },
          delete(id: string) {
            deleteEntity(store, id);
          },
          list() {
            return store
              .facts(undefined, nodeTypePredicateId, typeId(typeDef))
              .map((edge) => projectEntity(store, edge.s, typeDef as any, scalarByKey, typeByKey));
          },
          node(id: string) {
            return {
              get: () => projectEntity(store, id, typeDef as any, scalarByKey, typeByKey),
              update: (patch: unknown) =>
                updateEntity(
                  store,
                  id,
                  typeDef as any,
                  patch as any,
                  scalarByKey,
                  typeByKey,
                  enumValuesByRange,
                ),
              delete: () => deleteEntity(store, id),
            };
          },
        };
        return handle;
      },
    },
  ) as NamespaceClient<T>;
}
