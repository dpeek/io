import { core } from "./core";
import {
  edgeId,
  fieldTreeId,
  fieldTreeKey,
  fieldsMeta,
  isEnumType,
  isFieldsOutput,
  isScalarType,
  typeId,
} from "./schema";
import type {
  AnyTypeOutput,
  Cardinality,
  EdgeOutput,
  FieldsOutput,
  ScalarTypeOutput,
  TypeOutput,
} from "./schema";
import type { PredicateSlotListener, Store } from "./store";

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
type FieldGroupInfo<T extends FieldsTree> = {
  subjectId: string;
  fieldTree: T;
  path: readonly string[];
};

export const fieldGroupMeta: unique symbol = Symbol("fieldGroupMeta");

type FieldGroupLike = {
  [fieldGroupMeta]: FieldGroupInfo<FieldsTree>;
};

export type FieldGroupRef<
  T extends FieldsTree,
  Defs extends Record<string, AnyTypeOutput> = CoreDefs,
> = {
  [fieldGroupMeta]: FieldGroupInfo<T>;
} & {
  [K in Exclude<keyof T, typeof fieldsMeta>]: RefTree<T[K], Defs>;
};

export function isFieldGroupRef(value: unknown): value is FieldGroupLike {
  if (!value || typeof value !== "object") return false;
  return fieldGroupMeta in (value as Record<PropertyKey, unknown>);
}

export function fieldGroupFieldTree<
  T extends FieldsTree,
  Defs extends Record<string, AnyTypeOutput> = CoreDefs,
>(group: FieldGroupRef<T, Defs>): T {
  return group[fieldGroupMeta].fieldTree;
}

export function fieldGroupKey(group: FieldGroupLike): string {
  return fieldTreeKey(group[fieldGroupMeta].fieldTree);
}

export function fieldGroupId(group: FieldGroupLike): string {
  return fieldTreeId(group[fieldGroupMeta].fieldTree);
}

export function fieldGroupPath(group: FieldGroupLike): readonly string[] {
  return group[fieldGroupMeta].path;
}

export function fieldGroupSubjectId(group: FieldGroupLike): string {
  return group[fieldGroupMeta].subjectId;
}

export type EntityOfType<
  T extends TypeOutput,
  Defs extends Record<string, AnyTypeOutput> = CoreDefs,
> = { id: string } & TreeEntity<T["fields"], Defs>;
export type CreateInputOfType<
  T extends TypeOutput,
  Defs extends Record<string, AnyTypeOutput> = CoreDefs,
> = TreeCreate<T["fields"], Defs>;
export type PredicateValueOf<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput> = CoreDefs,
> = Cardinalized<T["range"], T["cardinality"], Defs>;
export type PredicateRangeTypeOf<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput> = CoreDefs,
> = TypeByKey<Defs, T["range"]> | undefined;
type PredicateItemOf<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput> = CoreDefs,
> = PredicateValueOf<T, Defs> extends (infer Item)[] ? Item : never;
type PredicateSetValueOf<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput> = CoreDefs,
> = Exclude<PredicateValueOf<T, Defs>, undefined>;

type RefTree<T, Defs extends Record<string, AnyTypeOutput>> = T extends EdgeOutput
  ? PredicateRef<T, Defs>
  : T extends FieldsTree
    ? FieldGroupRef<T, Defs>
    : never;

export type PredicateCollectionSemantics = {
  kind: PredicateCollectionKind;
};

export type PredicateRef<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput> = CoreDefs,
> = {
  subjectId: string;
  predicateId: string;
  field: T;
  rangeType: PredicateRangeTypeOf<T, Defs>;
  get(): PredicateValueOf<T, Defs>;
  subscribe(listener: PredicateSlotListener): () => void;
  batch<TResult>(fn: () => TResult): TResult;
} & (T["cardinality"] extends "many"
  ? {
      collection: PredicateCollectionSemantics;
      replace(values: PredicateValueOf<T, Defs>): void;
      add(value: PredicateItemOf<T, Defs>): void;
      remove(value: PredicateItemOf<T, Defs>): void;
      clear(): void;
    }
  : T["cardinality"] extends "one?"
    ? {
        set(value: PredicateSetValueOf<T, Defs>): void;
        clear(): void;
      }
    : {
        set(value: PredicateValueOf<T, Defs>): void;
      });

export type EntityRef<
  T extends TypeOutput,
  Defs extends Record<string, AnyTypeOutput> = CoreDefs,
> = {
  id: string;
  type: T;
  fields: RefTree<T["fields"], Defs>;
  get(): EntityOfType<T, Defs>;
  update(patch: Partial<CreateInputOfType<T, Defs>>): EntityOfType<T, Defs>;
  batch<TResult>(fn: () => TResult): TResult;
  delete(): void;
};

type FlatPredicateEntry = {
  path: string[];
  field: string;
  predicate: EdgeOutput;
};

type PredicateValue = unknown[] | unknown | undefined;
type ReadPredicateValueOptions = {
  strictRequired?: boolean;
};
const clearFieldValue = Symbol("clearFieldValue");
type ClearFieldValue = typeof clearFieldValue;
type PredicateCollectionKind = "ordered" | "unordered";
type EncodedPredicateValue = {
  encoded: string;
  decoded: unknown;
};

function isEdgeOutput(value: unknown): value is EdgeOutput {
  const candidate = value as Partial<EdgeOutput>;
  return typeof candidate.key === "string" && typeof candidate.range === "string";
}

function isTree(value: unknown): value is FieldsOutput {
  return isFieldsOutput(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function sameLogicalValue(left: unknown, right: unknown): boolean {
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

function getPredicateCollectionKind(field: EdgeOutput): PredicateCollectionKind {
  const meta = field as EdgeOutput & {
    meta?: {
      collection?: {
        kind?: PredicateCollectionKind;
      };
    };
  };
  if (field.cardinality !== "many") return "ordered";
  return meta.meta?.collection?.kind === "unordered" ? "unordered" : "ordered";
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

function hasNestedValue(obj: Record<string, unknown>, path: string[], field: string): boolean {
  let current: unknown = obj;
  for (const part of path) {
    if (!current || typeof current !== "object") return false;
    if (!(part in (current as Record<string, unknown>))) return false;
    current = (current as Record<string, unknown>)[part];
  }
  if (!current || typeof current !== "object") return false;
  return field in (current as Record<string, unknown>);
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
    if (!hasNestedValue(input, entry.path, entry.field)) continue;
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

function readEncodedPredicateValues(
  store: Store,
  id: string,
  predicate: EdgeOutput,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
): EncodedPredicateValue[] {
  return store.facts(id, edgeId(predicate)).map((edge) => ({
    encoded: edge.o,
    decoded: decodeForRange(edge.o, predicate.range, scalarByKey, typeByKey),
  }));
}

function uniqueEncodedPredicateValues(values: EncodedPredicateValue[]): EncodedPredicateValue[] {
  const seen = new Set<string>();
  const out: EncodedPredicateValue[] = [];

  for (const value of values) {
    if (seen.has(value.encoded)) continue;
    seen.add(value.encoded);
    out.push(value);
  }

  return out;
}

function readLogicalManyValues(
  store: Store,
  id: string,
  predicate: EdgeOutput,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
): EncodedPredicateValue[] {
  const values = readEncodedPredicateValues(store, id, predicate, scalarByKey, typeByKey);
  if (getPredicateCollectionKind(predicate) === "unordered") {
    return uniqueEncodedPredicateValues(values);
  }
  return values;
}

function normalizeRequestedManyValues(
  predicate: EdgeOutput,
  values: unknown[],
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): EncodedPredicateValue[] {
  const requested = values.map((value) => {
    const encoded = encodeForRange(value, predicate.range, scalarByKey, typeByKey, enumValuesByRange);
    return {
      encoded,
      decoded: decodeForRange(encoded, predicate.range, scalarByKey, typeByKey),
    };
  });

  if (getPredicateCollectionKind(predicate) === "unordered") {
    return uniqueEncodedPredicateValues(requested);
  }

  return requested;
}

function planManyValues(
  current: EncodedPredicateValue[],
  requested: EncodedPredicateValue[],
  predicate: EdgeOutput,
): EncodedPredicateValue[] {
  if (getPredicateCollectionKind(predicate) === "ordered") {
    return requested;
  }

  const requestedIds = new Set(requested.map((value) => value.encoded));
  const currentIds = new Set(current.map((value) => value.encoded));

  return [
    ...current.filter((value) => requestedIds.has(value.encoded)),
    ...requested.filter((value) => !currentIds.has(value.encoded)),
  ];
}

function removeManyValue(
  current: unknown[],
  predicate: EdgeOutput,
  target: unknown,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): unknown[] {
  const encodedTarget = encodeForRange(
    target,
    predicate.range,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
  );

  if (getPredicateCollectionKind(predicate) === "unordered") {
    return current.filter(
      (value) =>
        encodeForRange(value, predicate.range, scalarByKey, typeByKey, enumValuesByRange) !==
        encodedTarget,
    );
  }

  const index = current.findIndex(
    (value) =>
      encodeForRange(value, predicate.range, scalarByKey, typeByKey, enumValuesByRange) ===
      encodedTarget,
  );

  if (index < 0) return current;
  return current.filter((_, currentIndex) => currentIndex !== index);
}

function collectLogicalChangedPredicateKeys(
  input: Record<string, unknown>,
  entries: FlatPredicateEntry[],
  store: Store,
  id: string,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): Set<string> {
  const changed = new Set<string>();

  for (const entry of entries) {
    if (!hasNestedValue(input, entry.path, entry.field)) continue;

    const nextValue = getNestedValue(input, entry.path, entry.field);
    const previous = readPredicateValue(store, id, entry.predicate, scalarByKey, typeByKey);

    if (nextValue === clearFieldValue) {
      if (previous !== undefined) changed.add(entry.predicate.key);
      continue;
    }

    if (entry.predicate.cardinality === "many") {
      if (!Array.isArray(nextValue)) {
        changed.add(entry.predicate.key);
        continue;
      }

      const current = readLogicalManyValues(store, id, entry.predicate, scalarByKey, typeByKey);
      const requested = normalizeRequestedManyValues(
        entry.predicate,
        nextValue,
        scalarByKey,
        typeByKey,
        enumValuesByRange,
      );
      const planned = planManyValues(current, requested, entry.predicate).map((value) => value.decoded);

      if (!sameLogicalValue(previous, planned)) changed.add(entry.predicate.key);
      continue;
    }

    if (!sameLogicalValue(previous, nextValue)) changed.add(entry.predicate.key);
  }

  return changed;
}

function readPredicateValue(
  store: Store,
  id: string,
  predicate: EdgeOutput,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  options: ReadPredicateValueOptions = {},
): PredicateValue {
  if (predicate.cardinality === "many") {
    return readLogicalManyValues(store, id, predicate, scalarByKey, typeByKey).map(
      (value) => value.decoded,
    );
  }
  const facts = store.facts(id, edgeId(predicate));
  if (!facts[0]) {
    if (options.strictRequired && predicate.cardinality === "one") {
      throw new Error(`Missing required predicate "${predicate.key}" for entity "${id}"`);
    }
    return undefined;
  }
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
  enumValuesByRange: Map<string, Set<string>>,
): Set<string> {
  const now = new Date();
  const changedPredicateKeys =
    event === "update"
      ? collectLogicalChangedPredicateKeys(
          input,
          entries,
          store,
          nodeId,
          scalarByKey,
          typeByKey,
          enumValuesByRange,
        )
      : collectChangedPredicateKeys(input, entries);
  for (const entry of entries) {
    const hook = event === "create" ? entry.predicate.onCreate : entry.predicate.onUpdate;
    if (!hook) continue;
    const incomingValue = getNestedValue(input, entry.path, entry.field);
    const incoming = incomingValue === clearFieldValue ? undefined : incomingValue;
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

function retractPredicateFacts(store: Store, id: string, predicate: EdgeOutput): void {
  for (const edge of store.facts(id, edgeId(predicate))) store.retract(edge.id);
}

function createEntity<T extends TypeOutput>(
  store: Store,
  typeDef: T,
  data: CreateInputOfType<T, Record<string, AnyTypeOutput>>,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): string {
  return store.batch(() => {
    const entries = flattenPredicates(typeDef.fields);
    const nodeTypePredicate = core.node.fields.type as EdgeOutput;
    const nodeTypePredicateId = edgeId(nodeTypePredicate);
    const id = store.newNode();
    const input = cloneInput(data as Record<string, unknown>);
    applyLifecycleHooks(
      "create",
      input,
      entries,
      store,
      id,
      scalarByKey,
      typeByKey,
      enumValuesByRange,
    );
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
        const normalized = planManyValues(
          [],
          normalizeRequestedManyValues(
            entry.predicate,
            value,
            scalarByKey,
            typeByKey,
            enumValuesByRange,
          ),
          entry.predicate,
        ).map((candidate) => candidate.decoded);
        assertMany(
          store,
          id,
          entry.predicate,
          normalized,
          scalarByKey,
          typeByKey,
          enumValuesByRange,
        );
        continue;
      }
      assertOne(store, id, entry.predicate, value, scalarByKey, typeByKey, enumValuesByRange);
    }
    return id;
  })
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
    const value = readPredicateValue(store, id, entry.predicate, scalarByKey, typeByKey);
    setNestedValue(out, entry.path, entry.field, value);
  }
  return out as EntityOfType<T, Record<string, AnyTypeOutput>>;
}

function createPredicateRef<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
  store: Store,
  subjectId: string,
  field: T,
  applyMutation: (value: unknown | ClearFieldValue) => void,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): PredicateRef<T, Defs> {
  const base = {
    subjectId,
    predicateId: edgeId(field),
    field,
    rangeType: typeByKey.get(field.range) as TypeByKey<Defs, T["range"]> | undefined,
    get() {
      return readPredicateValue(store, subjectId, field, scalarByKey, typeByKey, {
        strictRequired: true,
      }) as PredicateValueOf<T, Defs>;
    },
    subscribe(listener: PredicateSlotListener) {
      let previous = readPredicateValue(store, subjectId, field, scalarByKey, typeByKey, {
        strictRequired: true,
      });

      return store.subscribePredicateSlot(subjectId, edgeId(field), () => {
        const next = readPredicateValue(store, subjectId, field, scalarByKey, typeByKey, {
          strictRequired: true,
        });

        if (sameLogicalValue(previous, next)) return;
        previous = next;
        listener();
      });
    },
    batch<TResult>(fn: () => TResult) {
      return store.batch(fn);
    },
  };

  if (field.cardinality === "many") {
    const collection = { kind: getPredicateCollectionKind(field) } satisfies PredicateCollectionSemantics;
    return {
      ...base,
      collection,
      replace(values: PredicateValueOf<T, Defs>) {
        applyMutation(values);
      },
      add(value: PredicateItemOf<T, Defs>) {
        const currentValues = base.get() as unknown as PredicateItemOf<T, Defs>[];
        applyMutation([...currentValues, value]);
      },
      remove(value: PredicateItemOf<T, Defs>) {
        const currentValues = base.get() as unknown as PredicateItemOf<T, Defs>[];
        const nextValues = removeManyValue(
          currentValues,
          field,
          value,
          scalarByKey,
          typeByKey,
          enumValuesByRange,
        );
        if (sameLogicalValue(currentValues, nextValues)) return;
        applyMutation(nextValues);
      },
      clear() {
        if ((base.get() as unknown as PredicateItemOf<T, Defs>[]).length === 0) return;
        applyMutation([]);
      },
    } as unknown as PredicateRef<T, Defs>;
  }

  if (field.cardinality === "one?") {
    return {
      ...base,
      set(value: PredicateSetValueOf<T, Defs>) {
        applyMutation(value);
      },
      clear() {
        if (base.get() === undefined) return;
        applyMutation(clearFieldValue);
      },
    } as unknown as PredicateRef<T, Defs>;
  }

  return {
    ...base,
    set(value: PredicateValueOf<T, Defs>) {
      applyMutation(value);
    },
  } as unknown as PredicateRef<T, Defs>;
}

function buildFieldRefs<T extends FieldsOutput, Defs extends Record<string, AnyTypeOutput>>(
  store: Store,
  subjectId: string,
  fields: T,
  path: string[],
  applyMutation: (path: string[], fieldName: string, value: unknown | ClearFieldValue) => void,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): FieldGroupRef<T, Defs> {
  const out: Record<string, unknown> = {};
  Object.defineProperty(out, fieldGroupMeta, {
    value: {
      subjectId,
      fieldTree: fields,
      path: Object.freeze([...path]),
    },
    enumerable: false,
    configurable: false,
    writable: false,
  });

  for (const [name, value] of Object.entries(fields)) {
    if (isEdgeOutput(value)) {
      out[name] = createPredicateRef(
        store,
        subjectId,
        value,
        (nextValue) => applyMutation(path, name, nextValue),
        scalarByKey,
        typeByKey,
        enumValuesByRange,
      );
      continue;
    }
    if (isTree(value)) {
      out[name] = buildFieldRefs(
        store,
        subjectId,
        value,
        [...path, name],
        applyMutation,
        scalarByKey,
        typeByKey,
        enumValuesByRange,
      );
    }
  }

  return out as FieldGroupRef<T, Defs>;
}

function createEntityRef<T extends TypeOutput, Defs extends Record<string, AnyTypeOutput>>(
  store: Store,
  id: string,
  typeDef: T,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): EntityRef<T, Defs> {
  const applyMutation = (path: string[], fieldName: string, value: unknown | ClearFieldValue) => {
    const patch: Record<string, unknown> = {};
    setNestedValue(patch, path, fieldName, value);
    updateEntity(store, id, typeDef, patch, scalarByKey, typeByKey, enumValuesByRange);
  };

  return {
    id,
    type: typeDef,
    fields: buildFieldRefs(
      store,
      id,
      typeDef.fields,
      [],
      applyMutation,
      scalarByKey,
      typeByKey,
      enumValuesByRange,
    ) as RefTree<T["fields"], Defs>,
    get() {
      return projectEntity(store, id, typeDef, scalarByKey, typeByKey) as EntityOfType<T, Defs>;
    },
    update(patch: Partial<CreateInputOfType<T, Defs>>) {
      return updateEntity(
        store,
        id,
        typeDef,
        patch as Record<string, unknown>,
        scalarByKey,
        typeByKey,
        enumValuesByRange,
      ) as EntityOfType<T, Defs>;
    },
    batch<TResult>(fn: () => TResult) {
      return store.batch(fn);
    },
    delete() {
      deleteEntity(store, id);
    },
  };
}

function updateEntity<T extends TypeOutput>(
  store: Store,
  id: string,
  typeDef: T,
  patch: Record<string, unknown>,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): EntityOfType<T, Record<string, AnyTypeOutput>> {
  return store.batch(() => {
    const entries = flattenPredicates(typeDef.fields);
    const input = cloneInput(patch);
    applyLifecycleHooks(
      "update",
      input,
      entries,
      store,
      id,
      scalarByKey,
      typeByKey,
      enumValuesByRange,
    );
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
        if (!Array.isArray(nextValue))
          throw new Error(`Field "${[...entry.path, entry.field].join(".")}" must be an array`);
        const current = readLogicalManyValues(store, id, entry.predicate, scalarByKey, typeByKey);
        const requested = normalizeRequestedManyValues(
          entry.predicate,
          nextValue,
          scalarByKey,
          typeByKey,
          enumValuesByRange,
        );
        const planned = planManyValues(current, requested, entry.predicate).map(
          (value) => value.decoded,
        );

        if (sameLogicalValue(previous, planned)) continue;
        retractPredicateFacts(store, id, entry.predicate);
        assertMany(
          store,
          id,
          entry.predicate,
          planned,
          scalarByKey,
          typeByKey,
          enumValuesByRange,
        );
      } else {
        if (sameLogicalValue(previous, nextValue)) continue;
        retractPredicateFacts(store, id, entry.predicate);
        assertOne(store, id, entry.predicate, nextValue, scalarByKey, typeByKey, enumValuesByRange);
      }
    }
    return projectEntity(store, id, typeDef, scalarByKey, typeByKey);
  })
}

function deleteEntity(store: Store, id: string): void {
  store.batch(() => {
    for (const edge of store.facts(id)) store.retract(edge.id);
  })
}

type TypeHandle<T extends TypeOutput, Defs extends Record<string, AnyTypeOutput>> = {
  create(input: CreateInputOfType<T, Defs>): string;
  get(id: string): EntityOfType<T, Defs>;
  update(id: string, patch: Partial<CreateInputOfType<T, Defs>>): EntityOfType<T, Defs>;
  delete(id: string): void;
  list(): EntityOfType<T, Defs>[];
  ref(id: string): EntityRef<T, Defs>;
  node(id: string): EntityRef<T, Defs>;
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
  const entityRefs = new Map<string, EntityRef<any, any>>();
  return new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key !== "string") return undefined;
        const typeDef = namespace[key as keyof T];
        if (!typeDef || typeDef.kind !== "entity") return undefined;
        const getEntityRef = (id: string): EntityRef<any, any> => {
          const cacheKey = `${typeId(typeDef)}\0${id}`;
          const cached = entityRefs.get(cacheKey);
          if (cached) return cached;
          const entityRef = createEntityRef(
            store,
            id,
            typeDef,
            scalarByKey,
            typeByKey,
            enumValuesByRange,
          );
          entityRefs.set(cacheKey, entityRef);
          return entityRef;
        };

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
          ref(id: string) {
            return getEntityRef(id);
          },
          node(id: string) {
            return getEntityRef(id);
          },
        };
        return handle;
      },
    },
  ) as NamespaceClient<T>;
}
