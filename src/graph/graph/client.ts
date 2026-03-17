import { core } from "./core";
import { createGraphId } from "./id";
import {
  edgeId,
  fieldTreeId,
  fieldTreeKey,
  fieldsMeta,
  isEntityType,
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
  ValidationEvent,
  ValidationIssueInput,
  ValidationPhase,
} from "./schema";
import { createStore, type PredicateSlotListener, type Store } from "./store";

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
            ? T[K] extends { createOptional: true }
              ? never
              : K
            : never
          : never]-?: TreeCreate<T[K], Defs>;
      } & {
        [K in Exclude<keyof T, typeof fieldsMeta> as T[K] extends EdgeOutput
          ? T[K]["cardinality"] extends "one"
            ? T[K] extends { createOptional: true }
              ? K
              : never
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

export type GraphValidationSource = "runtime" | "field" | "type";
export type GraphValidationIssue = {
  code: string;
  message: string;
  source: GraphValidationSource;
  path: readonly string[];
  predicateKey: string;
  nodeId: string;
};
export type GraphValidationResult<T = unknown> =
  | {
      ok: true;
      phase: ValidationPhase;
      event: ValidationEvent;
      value: T;
      changedPredicateKeys: readonly string[];
    }
  | {
      ok: false;
      phase: ValidationPhase;
      event: ValidationEvent;
      value: T;
      changedPredicateKeys: readonly string[];
      issues: readonly GraphValidationIssue[];
    };
export type GraphMutationValidationResult = GraphValidationResult<Record<string, unknown>>;
export type GraphDeleteValidationResult = GraphValidationResult<string>;

export class GraphValidationError<T = unknown> extends Error {
  readonly result: Extract<GraphValidationResult<T>, { ok: false }>;

  constructor(result: Extract<GraphValidationResult<T>, { ok: false }>) {
    const publicResult = exposeValidationResult(result) as Extract<
      GraphValidationResult<T>,
      { ok: false }
    >;
    const firstIssue = publicResult.issues[0];
    const fieldPath = firstIssue ? formatValidationPath(firstIssue.path) : "";
    super(
      firstIssue
        ? `Validation failed for "${fieldPath || firstIssue.predicateKey}": ${firstIssue.message}`
        : "Validation failed.",
    );
    this.name = "GraphValidationError";
    this.result = publicResult;
  }
}

export function formatValidationPath(path: readonly string[]): string {
  return path.join(".");
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
type PredicateRangeEntityTypeOf<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput> = CoreDefs,
> = Extract<NonNullable<PredicateRangeTypeOf<T, Defs>>, TypeOutput>;
type PredicateItemOf<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput> = CoreDefs> =
  PredicateValueOf<T, Defs> extends (infer Item)[] ? Item : never;
type PredicateSetValueOf<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput> = CoreDefs,
> = Exclude<PredicateValueOf<T, Defs>, undefined>;
type PredicateRangeEntityRefOf<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput> = CoreDefs,
> = [PredicateRangeEntityTypeOf<T, Defs>] extends [never]
  ? never
  : EntityRef<PredicateRangeEntityTypeOf<T, Defs>, Defs>;

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
  resolveEntity(id: string): PredicateRangeEntityRefOf<T, Defs> | undefined;
  listEntities(): PredicateRangeEntityRefOf<T, Defs>[];
  get(): PredicateValueOf<T, Defs>;
  subscribe(listener: PredicateSlotListener): () => void;
  batch<TResult>(fn: () => TResult): TResult;
} & (T["cardinality"] extends "many"
  ? {
      collection: PredicateCollectionSemantics;
      validateReplace(values: PredicateValueOf<T, Defs>): GraphMutationValidationResult;
      replace(values: PredicateValueOf<T, Defs>): void;
      validateAdd(value: PredicateItemOf<T, Defs>): GraphMutationValidationResult;
      add(value: PredicateItemOf<T, Defs>): void;
      validateRemove(value: PredicateItemOf<T, Defs>): GraphMutationValidationResult;
      remove(value: PredicateItemOf<T, Defs>): void;
      validateClear(): GraphMutationValidationResult;
      clear(): void;
    }
  : T["cardinality"] extends "one?"
    ? {
        validateSet(value: PredicateSetValueOf<T, Defs>): GraphMutationValidationResult;
        set(value: PredicateSetValueOf<T, Defs>): void;
        validateClear(): GraphMutationValidationResult;
        clear(): void;
      }
    : {
        validateSet(value: PredicateValueOf<T, Defs>): GraphMutationValidationResult;
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
  validateUpdate(patch: Partial<CreateInputOfType<T, Defs>>): GraphMutationValidationResult;
  update(patch: Partial<CreateInputOfType<T, Defs>>): EntityOfType<T, Defs>;
  validateDelete(): GraphDeleteValidationResult;
  batch<TResult>(fn: () => TResult): TResult;
  delete(): void;
};

type QueryCardinality<C extends Cardinality, Value> = C extends "many"
  ? Value[]
  : C extends "one?"
    ? Value | undefined
    : Value;

type FieldQuerySelection<T extends FieldsTree, Defs extends Record<string, AnyTypeOutput>> = {
  [K in Exclude<keyof T, typeof fieldsMeta>]?: QuerySelectionNode<T[K], Defs>;
};

type QueryEdgeSelection<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>> = [
  PredicateRangeEntityTypeOf<T, Defs>,
] extends [never]
  ? true
  : true | { select: TypeQuerySelection<PredicateRangeEntityTypeOf<T, Defs>, Defs> };

type QuerySelectionNode<Node, Defs extends Record<string, AnyTypeOutput>> = Node extends EdgeOutput
  ? QueryEdgeSelection<Node, Defs>
  : Node extends FieldsTree
    ? FieldQuerySelection<Node, Defs>
    : never;

type QueryResultNode<
  Node,
  Selection,
  Defs extends Record<string, AnyTypeOutput>,
> = Node extends EdgeOutput
  ? QueryEdgeResult<Node, Selection, Defs>
  : Node extends FieldsTree
    ? QueryFieldResult<Node, Extract<Selection, FieldQuerySelection<Node, Defs>>, Defs>
    : never;

type QueryFieldResult<
  T extends FieldsTree,
  Selection extends FieldQuerySelection<T, Defs>,
  Defs extends Record<string, AnyTypeOutput>,
> = {
  [K in keyof Selection & Exclude<keyof T, typeof fieldsMeta>]: QueryResultNode<
    T[K],
    NonNullable<Selection[K]>,
    Defs
  >;
};

type QueryEdgeResult<
  T extends EdgeOutput,
  Selection,
  Defs extends Record<string, AnyTypeOutput>,
> = [PredicateRangeEntityTypeOf<T, Defs>] extends [never]
  ? PredicateValueOf<T, Defs>
  : Selection extends true
    ? PredicateValueOf<T, Defs>
    : Selection extends {
          select: infer Nested extends TypeQuerySelection<
            PredicateRangeEntityTypeOf<T, Defs>,
            Defs
          >;
        }
      ? QueryCardinality<
          T["cardinality"],
          QueryFieldResult<PredicateRangeEntityTypeOf<T, Defs>["fields"], Nested, Defs> &
            (Nested extends { id: true } ? { id: string } : {})
        >
      : never;

export type TypeQuerySelection<
  T extends TypeOutput,
  Defs extends Record<string, AnyTypeOutput> = CoreDefs,
> = {
  id?: true;
} & FieldQuerySelection<T["fields"], Defs>;

export type TypeQueryWhere =
  | {
      id: string;
      ids?: never;
    }
  | {
      id?: never;
      ids: readonly string[];
    };

export type TypeQuerySpec<
  T extends TypeOutput,
  Defs extends Record<string, AnyTypeOutput> = CoreDefs,
  Selection extends TypeQuerySelection<T, Defs> = TypeQuerySelection<T, Defs>,
> = {
  select: Selection;
  where?: TypeQueryWhere;
};

export type TypeQueryResult<
  T extends TypeOutput,
  Selection,
  Defs extends Record<string, AnyTypeOutput> = CoreDefs,
> =
  Selection extends TypeQuerySelection<T, Defs>
    ? QueryFieldResult<T["fields"], Selection, Defs> &
        (Selection extends { id: true } ? { id: string } : {})
    : never;

export type TypeQueryResponse<
  T extends TypeOutput,
  Query,
  Defs extends Record<string, AnyTypeOutput> = CoreDefs,
> =
  Query extends TypeQuerySpec<T, Defs, infer Selection>
    ? Query["where"] extends { id: string }
      ? TypeQueryResult<T, Selection, Defs> | undefined
      : TypeQueryResult<T, Selection, Defs>[]
    : never;

type EntityLookup<Defs extends Record<string, AnyTypeOutput>> = {
  resolve<T extends TypeOutput>(typeDef: T, id: string): EntityRef<T, Defs>;
  list<T extends TypeOutput>(typeDef: T): EntityRef<T, Defs>[];
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
const validationNowByStore = new WeakMap<Store, { version: number; now: Date }>();
const validationCreateNodeIdByStore = new WeakMap<Store, { version: number; nodeId: string }>();

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

function cloneDate(value: Date): Date {
  return new Date(value.getTime());
}

function getStableValidationNow(store: Store): Date {
  const version = store.version();
  const cached = validationNowByStore.get(store);
  if (cached?.version === version) return cloneDate(cached.now);

  const now = new Date();
  validationNowByStore.set(store, { version, now });
  return cloneDate(now);
}

function collectUsedIds(store: Store): Set<string> {
  const snapshot = store.snapshot();
  const usedIds = new Set<string>(snapshot.retracted);

  for (const edge of snapshot.edges) {
    usedIds.add(edge.id);
    usedIds.add(edge.s);
    usedIds.add(edge.p);
    usedIds.add(edge.o);
  }

  return usedIds;
}

function createUnusedNodeId(store: Store): string {
  const usedIds = collectUsedIds(store);
  let nodeId = createGraphId();
  while (usedIds.has(nodeId)) nodeId = createGraphId();
  return nodeId;
}

function getStableCreateNodeId(store: Store): string {
  const version = store.version();
  const cached = validationCreateNodeIdByStore.get(store);
  if (cached?.version === version) return cached.nodeId;

  const nodeId = createUnusedNodeId(store);
  validationCreateNodeIdByStore.set(store, { version, nodeId });
  return nodeId;
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

function deleteNestedValue(obj: Record<string, unknown>, path: string[], field: string): void {
  let current: Record<string, unknown> | undefined = obj;
  for (const part of path) {
    const next = current?.[part];
    if (!next || typeof next !== "object") return;
    current = next as Record<string, unknown>;
  }
  if (!current) return;
  delete current[field];
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

function clonePublicValidationValue<T>(value: T): T {
  function cloneValue(candidate: unknown): unknown {
    if (candidate === clearFieldValue) return undefined;
    if (Array.isArray(candidate)) return candidate.map((item) => cloneValue(item));
    if (candidate instanceof Date) return new Date(candidate.getTime());
    if (candidate instanceof URL) return new URL(candidate.toString());
    if (!candidate || typeof candidate !== "object") return candidate;
    if (Object.getPrototypeOf(candidate) !== Object.prototype) return candidate;
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(candidate)) out[key] = cloneValue(nested);
    return out;
  }

  return cloneValue(value) as T;
}

function cloneValidationIssue(issue: GraphValidationIssue): GraphValidationIssue {
  return {
    ...issue,
    path: Object.freeze([...issue.path]),
  };
}

function exposeValidationResult<T>(result: GraphValidationResult<T>): GraphValidationResult<T> {
  if (result.ok) {
    return {
      ...result,
      value: clonePublicValidationValue(result.value),
      changedPredicateKeys: [...result.changedPredicateKeys],
    };
  }

  return {
    ...result,
    value: clonePublicValidationValue(result.value),
    changedPredicateKeys: [...result.changedPredicateKeys],
    issues: result.issues.map((issue) => cloneValidationIssue(issue)),
  };
}

function exposeMutationValidationResult(
  result: GraphMutationValidationResult,
): GraphMutationValidationResult {
  return exposeValidationResult(result) as GraphMutationValidationResult;
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
  if (scalarType) {
    const encoded = scalarType.encode(value);
    if (typeof encoded !== "string") {
      throw new Error(`Expected scalar encoder for range "${range}" to return a string.`);
    }
    return encoded;
  }

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
    const encoded = encodeForRange(
      value,
      predicate.range,
      scalarByKey,
      typeByKey,
      enumValuesByRange,
    );
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

function collectionItemPassesValidation(
  store: Store,
  nodeId: string,
  predicate: EdgeOutput,
  value: unknown,
  now: Date,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): boolean {
  try {
    const encoded = encodeForRange(
      value,
      predicate.range,
      scalarByKey,
      typeByKey,
      enumValuesByRange,
    );
    const decoded = decodeForRange(encoded, predicate.range, scalarByKey, typeByKey);
    const issues: GraphValidationIssue[] = [];
    const entry: FlatPredicateEntry = {
      path: [],
      field: predicate.key,
      predicate,
    };
    const changedPredicateKeys = new Set<string>([predicate.key]);

    validateScalarValue(
      issues,
      entry,
      nodeId,
      decoded,
      undefined,
      "local",
      "update",
      now,
      changedPredicateKeys,
      scalarByKey,
    );
    validateEntityReferenceValue(issues, entry, nodeId, decoded, store, typeByKey);

    return issues.length === 0;
  } catch {
    return false;
  }
}

function planManyRemoveMutation(
  store: Store,
  subjectId: string,
  predicate: EdgeOutput,
  currentValues: unknown[],
  value: unknown,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): {
  nextValues: unknown[];
  validationValues: unknown[];
} {
  const now = getStableValidationNow(store);
  const isValidTarget = collectionItemPassesValidation(
    store,
    subjectId,
    predicate,
    value,
    now,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
  );

  if (!isValidTarget) {
    return {
      nextValues: currentValues,
      validationValues: [...currentValues, value],
    };
  }

  const nextValues = removeManyValue(
    currentValues,
    predicate,
    value,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
  );

  return {
    nextValues,
    validationValues: nextValues,
  };
}

function normalizeValidationIssueInputs(
  issues: ValidationIssueInput | ValidationIssueInput[] | void,
): ValidationIssueInput[] {
  if (!issues) return [];
  return Array.isArray(issues) ? issues : [issues];
}

function createValidationIssue(
  source: GraphValidationSource,
  entry: FlatPredicateEntry,
  nodeId: string,
  issue: ValidationIssueInput,
): GraphValidationIssue {
  return {
    ...issue,
    source,
    path: Object.freeze([...entry.path, entry.field]),
    predicateKey: entry.predicate.key,
    nodeId,
  };
}

function appendValidationIssues(
  issues: GraphValidationIssue[],
  source: GraphValidationSource,
  entry: FlatPredicateEntry,
  nodeId: string,
  input: ValidationIssueInput | ValidationIssueInput[] | void,
): void {
  for (const issue of normalizeValidationIssueInputs(input)) {
    issues.push(createValidationIssue(source, entry, nodeId, issue));
  }
}

function appendRuntimeValidationIssue(
  issues: GraphValidationIssue[],
  entry: FlatPredicateEntry,
  nodeId: string,
  code: string,
  message: string,
): void {
  issues.push(createValidationIssue("runtime", entry, nodeId, { code, message }));
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function enumValueIdsForRange(
  range: string,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): Set<string> | undefined {
  const knownIds = enumValuesByRange.get(range);
  if (knownIds) return knownIds;

  const rangeType = typeByKey.get(range);
  if (!rangeType || !isEnumType(rangeType)) return undefined;

  return new Set(Object.values(rangeType.options).map((option) => option.id ?? option.key));
}

function validateScalarValue(
  issues: GraphValidationIssue[],
  entry: FlatPredicateEntry,
  nodeId: string,
  value: unknown,
  previous: unknown,
  phase: ValidationPhase,
  event: ValidationEvent,
  now: Date,
  changedPredicateKeys: ReadonlySet<string>,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
): void {
  const scalarType = scalarByKey.get(entry.predicate.range);
  if (!scalarType?.validate) return;
  appendValidationIssues(
    issues,
    "type",
    entry,
    nodeId,
    scalarType.validate({
      event,
      phase,
      nodeId,
      now,
      path: Object.freeze([...entry.path, entry.field]),
      predicateKey: entry.predicate.key,
      range: entry.predicate.range,
      value,
      previous,
      changedPredicateKeys,
    }),
  );
}

function validateEnumValue(
  issues: GraphValidationIssue[],
  entry: FlatPredicateEntry,
  nodeId: string,
  value: unknown,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): boolean {
  const rangeType = typeByKey.get(entry.predicate.range);
  const enumValueIds = enumValueIdsForRange(entry.predicate.range, typeByKey, enumValuesByRange);
  if ((!rangeType || !isEnumType(rangeType)) && !enumValueIds) return true;

  const fieldPath = formatValidationPath([...entry.path, entry.field]);
  const enumName = rangeType?.values.name ?? rangeType?.values.key ?? entry.predicate.range;
  const expectsMany = entry.predicate.cardinality === "many";
  const values = expectsMany && Array.isArray(value) ? value : [value];

  if (values.some((item) => typeof item !== "string")) {
    appendValidationIssues(issues, "type", entry, nodeId, {
      code: "enum.valueType",
      message: expectsMany
        ? `Field "${fieldPath}" must use enum value id strings.`
        : `Field "${fieldPath}" must use an enum value id string.`,
    });
    return false;
  }

  if (!values.every((item) => enumValueIds?.has(item))) {
    appendValidationIssues(issues, "type", entry, nodeId, {
      code: "enum.member",
      message: expectsMany
        ? `Field "${fieldPath}" must reference declared "${enumName}" values.`
        : `Field "${fieldPath}" must reference a declared "${enumName}" value.`,
    });
    return false;
  }

  return true;
}

function appendInvalidValueIssue(
  issues: GraphValidationIssue[],
  entry: FlatPredicateEntry,
  nodeId: string,
  value: unknown,
  error: unknown,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): void {
  if (!validateEnumValue(issues, entry, nodeId, value, typeByKey, enumValuesByRange)) return;

  const fieldPath = formatValidationPath([...entry.path, entry.field]);
  const issue = {
    code: "value.invalid",
    message: `Field "${fieldPath}" is invalid: ${asErrorMessage(error)}`,
  } satisfies ValidationIssueInput;

  appendValidationIssues(
    issues,
    scalarByKey.has(entry.predicate.range) ? "type" : "runtime",
    entry,
    nodeId,
    issue,
  );
}

function validateFieldValue(
  issues: GraphValidationIssue[],
  entry: FlatPredicateEntry,
  nodeId: string,
  value: unknown,
  previous: unknown,
  phase: ValidationPhase,
  event: ValidationEvent,
  now: Date,
  changedPredicateKeys: ReadonlySet<string>,
): void {
  if (!entry.predicate.validate) return;
  appendValidationIssues(
    issues,
    "field",
    entry,
    nodeId,
    entry.predicate.validate({
      event,
      phase,
      nodeId,
      now,
      path: Object.freeze([...entry.path, entry.field]),
      field: entry.field,
      predicateKey: entry.predicate.key,
      range: entry.predicate.range,
      cardinality: entry.predicate.cardinality,
      value,
      previous,
      changedPredicateKeys,
    }),
  );
}

function validateEntityReferenceValue(
  issues: GraphValidationIssue[],
  entry: FlatPredicateEntry,
  nodeId: string,
  value: unknown,
  store: Store,
  typeByKey: Map<string, AnyTypeOutput>,
): void {
  const rangeType = typeByKey.get(entry.predicate.range);
  if (!rangeType || !isEntityType(rangeType)) return;

  const fieldPath = formatValidationPath([...entry.path, entry.field]);
  if (typeof value !== "string") {
    appendRuntimeValidationIssue(
      issues,
      entry,
      nodeId,
      "reference.invalid",
      `Field "${fieldPath}" must reference an entity id.`,
    );
    return;
  }

  const nodeTypePredicateId = edgeId(core.node.fields.type as EdgeOutput);
  const targetTypeIds = new Set(store.facts(value, nodeTypePredicateId).map((edge) => edge.o));

  if (targetTypeIds.size === 0) {
    if (entry.predicate.key === (core.predicate.fields.range as EdgeOutput).key) return;
    appendRuntimeValidationIssue(
      issues,
      entry,
      nodeId,
      "reference.missing",
      `Field "${fieldPath}" must reference an existing "${rangeType.values.name ?? rangeType.values.key}" entity.`,
    );
    return;
  }

  if (!targetTypeIds.has(typeId(rangeType))) {
    appendRuntimeValidationIssue(
      issues,
      entry,
      nodeId,
      "reference.type",
      `Field "${fieldPath}" must reference "${rangeType.values.name ?? rangeType.values.key}" entities.`,
    );
  }
}

function isManagedNodeTypeEntry(entry: FlatPredicateEntry): boolean {
  return (
    entry.path.length === 0 && entry.predicate.key === (core.node.fields.type as EdgeOutput).key
  );
}

function createNodeTypeValidationEntry(): FlatPredicateEntry {
  return {
    path: [],
    field: "type",
    predicate: core.node.fields.type as EdgeOutput,
  };
}

function formatTypeDisplayName(typeDef: Pick<TypeOutput, "values">): string {
  return typeDef.values.name ?? typeDef.values.key;
}

function appendManagedFieldMutationIssue<T extends TypeOutput>(
  issues: GraphValidationIssue[],
  entry: FlatPredicateEntry,
  nodeId: string,
  typeDef: T,
): void {
  const fieldPath = formatValidationPath([...entry.path, entry.field]);
  appendRuntimeValidationIssue(
    issues,
    entry,
    nodeId,
    "field.managed",
    `Field "${fieldPath}" is managed by the typed "${formatTypeDisplayName(typeDef)}" handle.`,
  );
}

function validateNodeTypeState(
  store: Store,
  nodeId: string,
  hasCurrentTypeFact: boolean,
  typeByKey: Map<string, AnyTypeOutput>,
): readonly GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  const keyPredicateId = edgeId(core.predicate.fields.key as EdgeOutput);
  const nodeTypePredicateId = edgeId(core.node.fields.type as EdgeOutput);
  const typeEntry = createNodeTypeValidationEntry();

  if (!hasCurrentTypeFact) {
    const hasStructuredFacts = store.facts(nodeId).some((edge) => edge.p !== keyPredicateId);
    if (hasStructuredFacts) {
      appendRuntimeValidationIssue(
        issues,
        typeEntry,
        nodeId,
        "type.required",
        'Field "type" is required for nodes with stored data.',
      );
    }
    return issues;
  }

  for (const typeValue of uniqueEncodedPredicateValues(
    store.facts(nodeId, nodeTypePredicateId).map((edge) => ({ encoded: edge.o, decoded: edge.o })),
  )) {
    validateEntityReferenceValue(issues, typeEntry, nodeId, typeValue.decoded, store, typeByKey);
  }

  return issues;
}

function validateTypedHandleTarget<T extends TypeOutput>(
  store: Store,
  nodeId: string,
  typeDef: T,
  typeByKey: Map<string, AnyTypeOutput>,
): readonly GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  const typeEntry = createNodeTypeValidationEntry();
  const nodeFacts = store.facts(nodeId);

  if (nodeFacts.length === 0) {
    appendRuntimeValidationIssue(
      issues,
      typeEntry,
      nodeId,
      "node.missing",
      `Typed "${formatTypeDisplayName(typeDef)}" handles require an existing node.`,
    );
    return issues;
  }

  const nodeTypePredicateId = edgeId(core.node.fields.type as EdgeOutput);
  const currentTypeIds = new Set(
    nodeFacts.filter((edge) => edge.p === nodeTypePredicateId).map((edge) => edge.o),
  );

  if (currentTypeIds.has(typeId(typeDef))) return issues;

  if (currentTypeIds.size === 0) {
    appendRuntimeValidationIssue(
      issues,
      typeEntry,
      nodeId,
      "type.required",
      `Node "${nodeId}" is missing the managed "${formatTypeDisplayName(typeDef)}" type.`,
    );
    return issues;
  }

  const currentTypes = [...currentTypeIds].map((currentTypeId) => {
    const currentType = typeByKey.get(currentTypeId);
    return currentType ? formatTypeDisplayName(currentType) : currentTypeId;
  });
  const quotedCurrentTypes =
    currentTypes.length === 1
      ? `"${currentTypes[0]}"`
      : currentTypes.map((currentType) => `"${currentType}"`).join(", ");

  appendRuntimeValidationIssue(
    issues,
    typeEntry,
    nodeId,
    "type.mismatch",
    `Typed "${formatTypeDisplayName(typeDef)}" handles cannot target nodes with current type ${quotedCurrentTypes}.`,
  );

  return issues;
}

function normalizeMutationValue(
  store: Store,
  nodeId: string,
  entry: FlatPredicateEntry,
  nextValue: unknown,
  previous: unknown,
  phase: ValidationPhase,
  event: Extract<ValidationEvent, "create" | "update">,
  now: Date,
  changedPredicateKeys: ReadonlySet<string>,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
  issues: GraphValidationIssue[],
): unknown | ClearFieldValue | undefined {
  const fieldPath = formatValidationPath([...entry.path, entry.field]);

  if (nextValue === clearFieldValue) {
    if (entry.predicate.cardinality === "one") {
      appendRuntimeValidationIssue(
        issues,
        entry,
        nodeId,
        "field.required",
        `Field "${fieldPath}" is required.`,
      );
      return undefined;
    }
    validateFieldValue(
      issues,
      entry,
      nodeId,
      undefined,
      previous,
      phase,
      event,
      now,
      changedPredicateKeys,
    );
    return clearFieldValue;
  }

  if (nextValue === undefined) {
    if (entry.predicate.cardinality === "one") {
      appendRuntimeValidationIssue(
        issues,
        entry,
        nodeId,
        "field.required",
        `Field "${fieldPath}" is required.`,
      );
      return undefined;
    }
    validateFieldValue(
      issues,
      entry,
      nodeId,
      undefined,
      previous,
      phase,
      event,
      now,
      changedPredicateKeys,
    );
    return event === "update" ? clearFieldValue : undefined;
  }

  if (entry.predicate.cardinality === "many") {
    if (!Array.isArray(nextValue)) {
      appendRuntimeValidationIssue(
        issues,
        entry,
        nodeId,
        "field.array",
        `Field "${fieldPath}" must be an array.`,
      );
      return nextValue;
    }

    try {
      const current =
        event === "update"
          ? readLogicalManyValues(store, nodeId, entry.predicate, scalarByKey, typeByKey)
          : [];
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

      for (const value of planned) {
        validateScalarValue(
          issues,
          entry,
          nodeId,
          value,
          previous,
          phase,
          event,
          now,
          changedPredicateKeys,
          scalarByKey,
        );
      }
      validateFieldValue(
        issues,
        entry,
        nodeId,
        planned,
        previous,
        phase,
        event,
        now,
        changedPredicateKeys,
      );
      return planned;
    } catch (error) {
      appendInvalidValueIssue(
        issues,
        entry,
        nodeId,
        nextValue,
        error,
        scalarByKey,
        typeByKey,
        enumValuesByRange,
      );
      return nextValue;
    }
  }

  try {
    const encoded = encodeForRange(
      nextValue,
      entry.predicate.range,
      scalarByKey,
      typeByKey,
      enumValuesByRange,
    );
    const normalized = decodeForRange(encoded, entry.predicate.range, scalarByKey, typeByKey);
    validateScalarValue(
      issues,
      entry,
      nodeId,
      normalized,
      previous,
      phase,
      event,
      now,
      changedPredicateKeys,
      scalarByKey,
    );
    validateFieldValue(
      issues,
      entry,
      nodeId,
      normalized,
      previous,
      phase,
      event,
      now,
      changedPredicateKeys,
    );
    return normalized;
  } catch (error) {
    appendInvalidValueIssue(
      issues,
      entry,
      nodeId,
      nextValue,
      error,
      scalarByKey,
      typeByKey,
      enumValuesByRange,
    );
    return nextValue;
  }
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

      try {
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

        if (!sameLogicalValue(previous, planned)) changed.add(entry.predicate.key);
      } catch {
        changed.add(entry.predicate.key);
      }
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
  now: Date,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): Set<string> {
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

function collectIssuePredicateKeys(issues: readonly GraphValidationIssue[]): Set<string> {
  const changedPredicateKeys = new Set<string>();
  for (const issue of issues) changedPredicateKeys.add(issue.predicateKey);
  return changedPredicateKeys;
}

function mergeChangedPredicateKeys(
  changedPredicateKeys: ReadonlySet<string>,
  issues: readonly GraphValidationIssue[],
): Set<string> {
  const merged = new Set(changedPredicateKeys);
  for (const key of collectIssuePredicateKeys(issues)) merged.add(key);
  return merged;
}

function entryChangedPredicateKeys(predicateKey: string): ReadonlySet<string> {
  return new Set([predicateKey]);
}

function invalidResult<T>(
  phase: ValidationPhase,
  event: ValidationEvent,
  value: T,
  changedPredicateKeys: ReadonlySet<string>,
  issues: readonly GraphValidationIssue[],
): Extract<GraphValidationResult<T>, { ok: false }> {
  return {
    ok: false,
    phase,
    event,
    value,
    changedPredicateKeys: [...changedPredicateKeys],
    issues,
  };
}

function validResult<T>(
  phase: ValidationPhase,
  event: ValidationEvent,
  value: T,
  changedPredicateKeys: ReadonlySet<string>,
): Extract<GraphValidationResult<T>, { ok: true }> {
  return {
    ok: true,
    phase,
    event,
    value,
    changedPredicateKeys: [...changedPredicateKeys],
  };
}

function assertValidResult<T>(
  result: GraphValidationResult<T>,
): asserts result is Extract<GraphValidationResult<T>, { ok: true }> {
  if (!result.ok) throw new GraphValidationError(result);
}

function validateSimulatedLocalMutation(
  validationStore: Store,
  namespace: Record<string, AnyTypeOutput>,
  now: Date,
  prepared: GraphMutationValidationResult,
): GraphMutationValidationResult {
  if (!prepared.ok) return prepared;

  const validation = validateGraphStore(validationStore, namespace, {
    now,
    phase: "local",
    event: prepared.event,
  });
  if (validation.ok) return prepared;

  return invalidResult(
    "local",
    prepared.event,
    prepared.value,
    mergeChangedPredicateKeys(new Set(prepared.changedPredicateKeys), validation.issues),
    validation.issues,
  );
}

function prepareMutationInput<T extends TypeOutput>(
  store: Store,
  typeDef: T,
  inputValue: Record<string, unknown>,
  event: Extract<ValidationEvent, "create" | "update">,
  nodeId: string,
  now: Date,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): GraphValidationResult<Record<string, unknown>> {
  const entries = flattenPredicates(typeDef.fields);
  const input = cloneInput(inputValue);
  const changedPredicateKeys = applyLifecycleHooks(
    event,
    input,
    entries,
    store,
    nodeId,
    now,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
  );
  const issues: GraphValidationIssue[] = [];

  for (const entry of entries) {
    const hasExplicitValue = hasNestedValue(input, entry.path, entry.field);
    if (event === "update" && !hasExplicitValue) continue;
    const nextValue = getNestedValue(input, entry.path, entry.field);

    if (event === "create" && !hasExplicitValue && isManagedNodeTypeEntry(entry)) {
      continue;
    }

    const previous =
      event === "update"
        ? readPredicateValue(store, nodeId, entry.predicate, scalarByKey, typeByKey)
        : undefined;

    if (isManagedNodeTypeEntry(entry)) {
      appendManagedFieldMutationIssue(issues, entry, nodeId, typeDef);
      deleteNestedValue(input, entry.path, entry.field);
      continue;
    }

    const normalized = normalizeMutationValue(
      store,
      nodeId,
      entry,
      nextValue,
      previous,
      "local",
      event,
      now,
      changedPredicateKeys,
      scalarByKey,
      typeByKey,
      enumValuesByRange,
      issues,
    );

    if (normalized === undefined && nextValue === undefined) continue;
    setNestedValue(input, entry.path, entry.field, normalized);
  }

  return issues.length > 0
    ? invalidResult(
        "local",
        event,
        input,
        mergeChangedPredicateKeys(changedPredicateKeys, issues),
        issues,
      )
    : validResult("local", event, input, changedPredicateKeys);
}

function cloneStoreForValidation(store: Store): Store {
  const validationStore = createStore();
  validationStore.replace(store.snapshot());
  return validationStore;
}

function validateCreateEntity<T extends TypeOutput>(
  store: Store,
  typeDef: T,
  data: CreateInputOfType<T, Record<string, AnyTypeOutput>>,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
  namespace: Record<string, AnyTypeOutput>,
): GraphMutationValidationResult {
  const now = getStableValidationNow(store);
  const validationNodeId = getStableCreateNodeId(store);
  const validationStore = cloneStoreForValidation(store);
  const prepared = prepareMutationInput(
    validationStore,
    typeDef,
    data as Record<string, unknown>,
    "create",
    validationNodeId,
    now,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
  );
  if (!prepared.ok) return prepared;

  commitCreateEntity(
    validationStore,
    validationNodeId,
    typeDef,
    prepared.value,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
  );

  return validateSimulatedLocalMutation(validationStore, namespace, now, prepared);
}

function commitCreateEntity<T extends TypeOutput>(
  store: Store,
  id: string,
  typeDef: T,
  input: Record<string, unknown>,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): string {
  return store.batch(() => {
    const entries = flattenPredicates(typeDef.fields);
    const nodeTypePredicate = core.node.fields.type as EdgeOutput;
    const nodeTypePredicateId = edgeId(nodeTypePredicate);
    store.assert(id, nodeTypePredicateId, typeId(typeDef));

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

function commitUpdateEntity<T extends TypeOutput>(
  store: Store,
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

function validateEntityState<T extends TypeOutput>(
  store: Store,
  id: string,
  typeDef: T,
  now: Date,
  phase: ValidationPhase,
  event: ValidationEvent,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): readonly GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  const entries = flattenPredicates(typeDef.fields);
  const changedPredicateKeys =
    phase === "authoritative" ? new Set(entries.map((entry) => entry.predicate.key)) : undefined;

  for (const entry of entries) {
    if (isManagedNodeTypeEntry(entry)) continue;
    const entryValidationKeys =
      changedPredicateKeys ?? entryChangedPredicateKeys(entry.predicate.key);
    const facts = store.facts(id, edgeId(entry.predicate));
    const fieldPath = formatValidationPath([...entry.path, entry.field]);
    const logicalFacts = uniqueEncodedPredicateValues(
      facts.map((fact) => ({ encoded: fact.o, decoded: fact.o })),
    );

    if (entry.predicate.cardinality === "one" && facts.length === 0) {
      appendRuntimeValidationIssue(
        issues,
        entry,
        id,
        "field.required",
        `Field "${fieldPath}" is required.`,
      );
      continue;
    }

    if (
      (entry.predicate.cardinality === "one" || entry.predicate.cardinality === "one?") &&
      facts.length > 1
    ) {
      appendRuntimeValidationIssue(
        issues,
        entry,
        id,
        "field.cardinality",
        `Field "${fieldPath}" exceeds ${entry.predicate.cardinality} cardinality.`,
      );
    }

    const decodedValues: Array<{ encoded: string; decoded: unknown }> = [];
    let hasDecodeError = false;
    for (const fact of facts) {
      try {
        const decoded = decodeForRange(fact.o, entry.predicate.range, scalarByKey, typeByKey);
        if (!validateEnumValue(issues, entry, id, decoded, typeByKey, enumValuesByRange)) {
          hasDecodeError = true;
          continue;
        }
        decodedValues.push({ encoded: fact.o, decoded });
        validateScalarValue(
          issues,
          entry,
          id,
          decoded,
          undefined,
          phase,
          event,
          now,
          entryValidationKeys,
          scalarByKey,
        );
        validateEntityReferenceValue(issues, entry, id, decoded, store, typeByKey);
      } catch (error) {
        hasDecodeError = true;
        appendInvalidValueIssue(
          issues,
          entry,
          id,
          fact.o,
          error,
          scalarByKey,
          typeByKey,
          enumValuesByRange,
        );
      }
    }

    if (hasDecodeError) continue;

    const logicalDecodedValues = uniqueEncodedPredicateValues(decodedValues);

    if (entry.predicate.cardinality === "many") {
      const logicalValues =
        getPredicateCollectionKind(entry.predicate) === "unordered"
          ? logicalDecodedValues.map((value) => value.decoded)
          : decodedValues.map((value) => value.decoded);
      validateFieldValue(
        issues,
        entry,
        id,
        logicalValues,
        undefined,
        phase,
        event,
        now,
        entryValidationKeys,
      );
      continue;
    }

    if (logicalFacts.length === 0) {
      validateFieldValue(
        issues,
        entry,
        id,
        undefined,
        undefined,
        phase,
        event,
        now,
        entryValidationKeys,
      );
      continue;
    }

    if (logicalDecodedValues.length === 1) {
      validateFieldValue(
        issues,
        entry,
        id,
        logicalDecodedValues[0]?.decoded,
        undefined,
        phase,
        event,
        now,
        entryValidationKeys,
      );
    }
  }

  return issues;
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

function createEntityAtId<T extends TypeOutput>(
  store: Store,
  id: string,
  typeDef: T,
  data: CreateInputOfType<T, Record<string, AnyTypeOutput>>,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
  namespace: Record<string, AnyTypeOutput>,
): string {
  const now = getStableValidationNow(store);
  const validationStore = cloneStoreForValidation(store);
  const prepared = prepareMutationInput(
    validationStore,
    typeDef,
    data as Record<string, unknown>,
    "create",
    id,
    now,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
  );
  if (prepared.ok) {
    commitCreateEntity(
      validationStore,
      id,
      typeDef,
      prepared.value,
      scalarByKey,
      typeByKey,
      enumValuesByRange,
    );
  }
  const validation = validateSimulatedLocalMutation(validationStore, namespace, now, prepared);
  assertValidResult(validation);
  return commitCreateEntity(
    store,
    id,
    typeDef,
    validation.value,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
  );
}

function createEntity<T extends TypeOutput>(
  store: Store,
  typeDef: T,
  data: CreateInputOfType<T, Record<string, AnyTypeOutput>>,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
  namespace: Record<string, AnyTypeOutput>,
): string {
  return createEntityAtId(
    store,
    getStableCreateNodeId(store),
    typeDef,
    data,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
    namespace,
  );
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
  validateMutation: (value: unknown | ClearFieldValue) => GraphMutationValidationResult,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
  entityLookup: EntityLookup<Defs>,
): PredicateRef<T, Defs> {
  const base = {
    subjectId,
    predicateId: edgeId(field),
    field,
    rangeType: typeByKey.get(field.range) as TypeByKey<Defs, T["range"]> | undefined,
    resolveEntity(id: string) {
      const rangeType = typeByKey.get(field.range);
      if (!rangeType || !isEntityType(rangeType)) return undefined;
      return entityLookup.resolve(
        rangeType as PredicateRangeEntityTypeOf<T, Defs>,
        id,
      ) as PredicateRangeEntityRefOf<T, Defs>;
    },
    listEntities() {
      const rangeType = typeByKey.get(field.range);
      if (!rangeType || !isEntityType(rangeType)) return [];
      return entityLookup.list(
        rangeType as PredicateRangeEntityTypeOf<T, Defs>,
      ) as PredicateRangeEntityRefOf<T, Defs>[];
    },
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
    const collection = {
      kind: getPredicateCollectionKind(field),
    } satisfies PredicateCollectionSemantics;
    return {
      ...base,
      collection,
      validateReplace(values: PredicateValueOf<T, Defs>) {
        return exposeMutationValidationResult(validateMutation(values));
      },
      replace(values: PredicateValueOf<T, Defs>) {
        applyMutation(values);
      },
      validateAdd(value: PredicateItemOf<T, Defs>) {
        const currentValues = base.get() as unknown as PredicateItemOf<T, Defs>[];
        return exposeMutationValidationResult(validateMutation([...currentValues, value]));
      },
      add(value: PredicateItemOf<T, Defs>) {
        const currentValues = base.get() as unknown as PredicateItemOf<T, Defs>[];
        applyMutation([...currentValues, value]);
      },
      validateRemove(value: PredicateItemOf<T, Defs>) {
        const currentValues = base.get() as unknown as PredicateItemOf<T, Defs>[];
        const planned = planManyRemoveMutation(
          store,
          subjectId,
          field,
          currentValues,
          value,
          scalarByKey,
          typeByKey,
          enumValuesByRange,
        );
        return exposeMutationValidationResult(validateMutation(planned.validationValues));
      },
      remove(value: PredicateItemOf<T, Defs>) {
        const currentValues = base.get() as unknown as PredicateItemOf<T, Defs>[];
        const planned = planManyRemoveMutation(
          store,
          subjectId,
          field,
          currentValues,
          value,
          scalarByKey,
          typeByKey,
          enumValuesByRange,
        );
        if (!sameLogicalValue(planned.validationValues, planned.nextValues)) {
          assertValidResult(validateMutation(planned.validationValues));
        }
        if (sameLogicalValue(currentValues, planned.nextValues)) return;
        applyMutation(planned.nextValues);
      },
      validateClear() {
        return exposeMutationValidationResult(validateMutation([]));
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
      validateSet(value: PredicateSetValueOf<T, Defs>) {
        return exposeMutationValidationResult(validateMutation(value));
      },
      set(value: PredicateSetValueOf<T, Defs>) {
        applyMutation(value);
      },
      validateClear() {
        return exposeMutationValidationResult(validateMutation(clearFieldValue));
      },
      clear() {
        if (base.get() === undefined) return;
        applyMutation(clearFieldValue);
      },
    } as unknown as PredicateRef<T, Defs>;
  }

  return {
    ...base,
    validateSet(value: PredicateValueOf<T, Defs>) {
      return exposeMutationValidationResult(validateMutation(value));
    },
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
  validateMutation: (
    path: string[],
    fieldName: string,
    value: unknown | ClearFieldValue,
  ) => GraphMutationValidationResult,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
  entityLookup: EntityLookup<Defs>,
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
        (nextValue) => validateMutation(path, name, nextValue),
        scalarByKey,
        typeByKey,
        enumValuesByRange,
        entityLookup,
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
        validateMutation,
        scalarByKey,
        typeByKey,
        enumValuesByRange,
        entityLookup,
      );
    }
  }

  return out as FieldGroupRef<T, Defs>;
}

function createEntityRef<T extends TypeOutput, Defs extends Record<string, AnyTypeOutput>>(
  store: Store,
  id: string,
  typeDef: T,
  namespace: Defs,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
  entityLookup: EntityLookup<Defs>,
): EntityRef<T, Defs> {
  const applyMutation = (path: string[], fieldName: string, value: unknown | ClearFieldValue) => {
    const patch: Record<string, unknown> = {};
    setNestedValue(patch, path, fieldName, value);
    updateEntity(store, id, typeDef, patch, scalarByKey, typeByKey, enumValuesByRange, namespace);
  };
  const validateMutation = (
    path: string[],
    fieldName: string,
    value: unknown | ClearFieldValue,
  ) => {
    const patch: Record<string, unknown> = {};
    setNestedValue(patch, path, fieldName, value);
    return validateUpdateEntity(
      store,
      id,
      typeDef,
      patch,
      scalarByKey,
      typeByKey,
      enumValuesByRange,
      namespace,
    );
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
      validateMutation,
      scalarByKey,
      typeByKey,
      enumValuesByRange,
      entityLookup,
    ) as RefTree<T["fields"], Defs>,
    get() {
      return projectEntity(store, id, typeDef, scalarByKey, typeByKey) as EntityOfType<T, Defs>;
    },
    validateUpdate(patch: Partial<CreateInputOfType<T, Defs>>) {
      return exposeMutationValidationResult(
        validateUpdateEntity(
          store,
          id,
          typeDef,
          patch as Record<string, unknown>,
          scalarByKey,
          typeByKey,
          enumValuesByRange,
          namespace,
        ),
      );
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
        namespace,
      ) as EntityOfType<T, Defs>;
    },
    validateDelete() {
      return exposeValidationResult(
        prepareDeleteEntity(store, id, typeDef, typeByKey, namespace),
      ) as GraphDeleteValidationResult;
    },
    batch<TResult>(fn: () => TResult) {
      return store.batch(fn);
    },
    delete() {
      deleteEntity(store, id, typeDef, typeByKey, namespace);
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
  namespace: Record<string, AnyTypeOutput>,
): EntityOfType<T, Record<string, AnyTypeOutput>> {
  const prepared = validateUpdateEntity(
    store,
    id,
    typeDef,
    patch,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
    namespace,
  );
  assertValidResult(prepared);
  return commitUpdateEntity(
    store,
    id,
    typeDef,
    prepared.value,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
  );
}

function validateUpdateEntity<T extends TypeOutput>(
  store: Store,
  id: string,
  typeDef: T,
  patch: Record<string, unknown>,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
  namespace: Record<string, AnyTypeOutput>,
): GraphMutationValidationResult {
  const requestedChangedPredicateKeys = collectChangedPredicateKeys(
    patch,
    flattenPredicates(typeDef.fields),
  );
  const handleIssues = validateTypedHandleTarget(store, id, typeDef, typeByKey);
  if (handleIssues.length > 0) {
    return invalidResult(
      "local",
      "update",
      cloneInput(patch),
      mergeChangedPredicateKeys(requestedChangedPredicateKeys, handleIssues),
      handleIssues,
    );
  }

  const now = getStableValidationNow(store);
  const validationStore = cloneStoreForValidation(store);
  const prepared = prepareMutationInput(
    validationStore,
    typeDef,
    patch,
    "update",
    id,
    now,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
  );
  if (!prepared.ok) return prepared;

  commitUpdateEntity(
    validationStore,
    id,
    typeDef,
    prepared.value,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
  );

  return validateSimulatedLocalMutation(validationStore, namespace, now, prepared);
}

function prepareDeleteEntity<T extends TypeOutput, Defs extends Record<string, AnyTypeOutput>>(
  store: Store,
  id: string,
  typeDef: T,
  typeByKey: Map<string, AnyTypeOutput>,
  namespace: Defs,
): GraphDeleteValidationResult {
  const handleIssues = validateTypedHandleTarget(store, id, typeDef, typeByKey);
  if (handleIssues.length > 0) {
    return invalidResult(
      "local",
      "delete",
      id,
      collectIssuePredicateKeys(handleIssues),
      handleIssues,
    );
  }

  const now = getStableValidationNow(store);
  const validationStore = cloneStoreForValidation(store);
  for (const edge of validationStore.facts(id)) validationStore.retract(edge.id);

  const validation = validateGraphStore(validationStore, namespace, {
    now,
    phase: "local",
    event: "delete",
  });
  return validation.ok
    ? validResult("local", "delete", id, new Set<string>())
    : invalidResult(
        "local",
        "delete",
        id,
        collectIssuePredicateKeys(validation.issues),
        validation.issues,
      );
}

function deleteEntity<T extends TypeOutput, Defs extends Record<string, AnyTypeOutput>>(
  store: Store,
  id: string,
  typeDef: T,
  typeByKey: Map<string, AnyTypeOutput>,
  namespace: Defs,
): void {
  assertValidResult(prepareDeleteEntity(store, id, typeDef, typeByKey, namespace));
  store.batch(() => {
    for (const edge of store.facts(id)) store.retract(edge.id);
  });
}

type TypeHandle<T extends TypeOutput, Defs extends Record<string, AnyTypeOutput>> = {
  validateCreate(input: CreateInputOfType<T, Defs>): GraphMutationValidationResult;
  create(input: CreateInputOfType<T, Defs>): string;
  get(id: string): EntityOfType<T, Defs>;
  validateUpdate(
    id: string,
    patch: Partial<CreateInputOfType<T, Defs>>,
  ): GraphMutationValidationResult;
  update(id: string, patch: Partial<CreateInputOfType<T, Defs>>): EntityOfType<T, Defs>;
  validateDelete(id: string): GraphDeleteValidationResult;
  delete(id: string): void;
  list(): EntityOfType<T, Defs>[];
  query<const Query extends TypeQuerySpec<T, Defs>>(
    query: Query,
  ): Promise<TypeQueryResponse<T, Query, Defs>>;
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

export function validateGraphStore<const T extends Record<string, AnyTypeOutput>>(
  store: Store,
  namespace: T,
  options: {
    now?: Date;
    phase?: ValidationPhase;
    event?: ValidationEvent;
  } = {},
): GraphValidationResult<void> {
  const now = options.now ? cloneDate(options.now) : new Date();
  const phase = options.phase ?? "authoritative";
  const event = options.event ?? "reconcile";
  const scalarByKey = collectScalarCodecs(namespace);
  const typeByKey = collectTypeIndex(namespace);
  const enumValuesByRange = collectEnumValueIds(namespace, typeByKey);
  const nodeTypePredicate = core.node.fields.type as EdgeOutput;
  const nodeTypePredicateId = edgeId(nodeTypePredicate);
  const combined = [...Object.values(core), ...Object.values(namespace)];
  const issues: GraphValidationIssue[] = [];
  const subjects = new Map<string, boolean>();

  for (const edge of store.facts()) {
    const existing = subjects.get(edge.s) ?? false;
    subjects.set(edge.s, existing || edge.p === nodeTypePredicateId);
  }

  for (const [nodeId, hasCurrentTypeFact] of subjects) {
    issues.push(...validateNodeTypeState(store, nodeId, hasCurrentTypeFact, typeByKey));
  }

  for (const typeDef of combined) {
    if (!isEntityType(typeDef)) continue;
    const seenIds = new Set<string>();
    for (const edge of store.facts(undefined, nodeTypePredicateId, typeId(typeDef))) {
      if (seenIds.has(edge.s)) continue;
      seenIds.add(edge.s);
      issues.push(
        ...validateEntityState(
          store,
          edge.s,
          typeDef,
          now,
          phase,
          event,
          scalarByKey,
          typeByKey,
          enumValuesByRange,
        ),
      );
    }
  }

  return issues.length > 0
    ? invalidResult(phase, event, undefined, collectIssuePredicateKeys(issues), issues)
    : validResult(phase, event, undefined, new Set<string>());
}

export function createEntityWithId<
  const T extends TypeOutput,
  const Defs extends Record<string, AnyTypeOutput>,
>(
  store: Store,
  namespace: Defs,
  typeDef: T,
  id: string,
  input: CreateInputOfType<T, Defs>,
): string {
  if (store.facts(id).length > 0) {
    throw new Error(`Cannot create "${typeDef.values.key}" at existing node id "${id}".`);
  }

  const allTypes = namespace as Record<string, AnyTypeOutput>;
  const scalarByKey = collectScalarCodecs(allTypes);
  const typeByKey = collectTypeIndex(allTypes);
  const enumValuesByRange = collectEnumValueIds(allTypes, typeByKey);
  return createEntityAtId(
    store,
    id,
    typeDef,
    input as CreateInputOfType<T, Record<string, AnyTypeOutput>>,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
    allTypes,
  );
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
  const getEntityRef = <U extends TypeOutput>(typeDef: U, id: string): EntityRef<U, AllDefs<T>> => {
    const cacheKey = `${typeId(typeDef)}\0${id}`;
    const cached = entityRefs.get(cacheKey);
    if (cached) return cached as EntityRef<U, AllDefs<T>>;
    const entityRef = createEntityRef(
      store,
      id,
      typeDef,
      namespace as AllDefs<T>,
      scalarByKey,
      typeByKey,
      enumValuesByRange,
      entityLookup,
    );
    entityRefs.set(cacheKey, entityRef);
    return entityRef as EntityRef<U, AllDefs<T>>;
  };
  const listEntityRefs = <U extends TypeOutput>(typeDef: U): EntityRef<U, AllDefs<T>>[] =>
    store
      .facts(undefined, nodeTypePredicateId, typeId(typeDef))
      .map((edge) => getEntityRef(typeDef, edge.s));
  const entityLookup: EntityLookup<AllDefs<T>> = {
    resolve(typeDef, id) {
      return getEntityRef(typeDef, id);
    },
    list(typeDef) {
      return listEntityRefs(typeDef);
    },
  };
  const hasEntity = <U extends TypeOutput>(typeDef: U, id: string): boolean =>
    store.facts(id, nodeTypePredicateId, typeId(typeDef)).length > 0;
  const assertEntity = <U extends TypeOutput>(typeDef: U, id: string): void => {
    if (hasEntity(typeDef, id)) return;
    throw new Error(`Missing entity "${id}" for type "${typeDef.values.key}"`);
  };
  const projectQueryFields = <
    U extends FieldsOutput,
    Selection extends FieldQuerySelection<U, AllDefs<T>>,
  >(
    subjectId: string,
    fields: U,
    selection: Selection,
  ): QueryFieldResult<U, Selection, AllDefs<T>> => {
    const out: Record<string, unknown> = {};

    for (const [fieldName, selected] of Object.entries(selection)) {
      if (fieldName === "id" || selected === undefined) continue;
      const field = fields[fieldName as keyof U];
      if (!field) throw new Error(`Unknown selected field "${fieldName}"`);

      if (isEdgeOutput(field)) {
        const edge = field as unknown as EdgeOutput;
        if (selected !== true) {
          const rangeType = typeByKey.get(edge.range);
          if (
            !rangeType ||
            !isEntityType(rangeType) ||
            !selected ||
            typeof selected !== "object" ||
            !("select" in selected)
          ) {
            throw new Error(`Predicate "${edge.key}" does not support nested selection`);
          }

          const nested = readPredicateValue(store, subjectId, edge, scalarByKey, typeByKey, {
            strictRequired: true,
          });
          const nestedSelection = selected.select as TypeQuerySelection<
            typeof rangeType,
            AllDefs<T>
          >;

          if (edge.cardinality === "many") {
            out[fieldName] = (nested as string[]).map((entityId) => {
              assertEntity(rangeType, entityId);
              return projectSelectedEntity(rangeType, entityId, nestedSelection);
            });
            continue;
          }

          if (nested === undefined) {
            out[fieldName] = undefined;
            continue;
          }

          const entityId = nested as string;
          assertEntity(rangeType, entityId);
          out[fieldName] = projectSelectedEntity(rangeType, entityId, nestedSelection);
          continue;
        }

        out[fieldName] = readPredicateValue(store, subjectId, edge, scalarByKey, typeByKey, {
          strictRequired: true,
        });
        continue;
      }

      if (!isTree(field)) throw new Error(`Unknown selected field "${fieldName}"`);
      const fieldTree = field as unknown as FieldsOutput;
      if (!selected || typeof selected !== "object" || Array.isArray(selected)) {
        throw new Error(
          `Field group "${fieldTreeKey(fieldTree)}" requires a nested selection object`,
        );
      }
      out[fieldName] = projectQueryFields(
        subjectId,
        fieldTree,
        selected as FieldQuerySelection<typeof fieldTree, AllDefs<T>>,
      );
    }

    return out as QueryFieldResult<U, Selection, AllDefs<T>>;
  };
  const projectSelectedEntity = <
    U extends TypeOutput,
    Selection extends TypeQuerySelection<U, AllDefs<T>>,
  >(
    typeDef: U,
    id: string,
    selection: Selection,
  ): TypeQueryResult<U, Selection, AllDefs<T>> => {
    const out = projectQueryFields(id, typeDef.fields, selection);
    if (selection.id) {
      const withId: Record<string, unknown> = { ...out };
      withId.id = id;
      return withId as TypeQueryResult<U, Selection, AllDefs<T>>;
    }
    return out as TypeQueryResult<U, Selection, AllDefs<T>>;
  };
  return new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key !== "string") return undefined;
        const typeDef = namespace[key as keyof T];
        if (!typeDef || typeDef.kind !== "entity") return undefined;

        const handle: TypeHandle<any, any> = {
          validateCreate(input: unknown) {
            return exposeMutationValidationResult(
              validateCreateEntity(
                store,
                typeDef as any,
                input as any,
                scalarByKey,
                typeByKey,
                enumValuesByRange,
                namespace,
              ),
            );
          },
          create(input: unknown) {
            return createEntity(
              store,
              typeDef as any,
              input as any,
              scalarByKey,
              typeByKey,
              enumValuesByRange,
              namespace,
            );
          },
          get(id: string) {
            return projectEntity(store, id, typeDef as any, scalarByKey, typeByKey);
          },
          validateUpdate(id: string, patch: unknown) {
            return exposeMutationValidationResult(
              validateUpdateEntity(
                store,
                id,
                typeDef as any,
                patch as any,
                scalarByKey,
                typeByKey,
                enumValuesByRange,
                namespace,
              ),
            );
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
              namespace,
            );
          },
          validateDelete(id: string) {
            return exposeValidationResult(
              prepareDeleteEntity(store, id, typeDef as any, typeByKey, namespace),
            ) as GraphDeleteValidationResult;
          },
          delete(id: string) {
            deleteEntity(store, id, typeDef as any, typeByKey, namespace);
          },
          list() {
            return listEntityRefs(typeDef as any).map((entityRef) => entityRef.get());
          },
          async query(query: unknown) {
            const spec = query as TypeQuerySpec<any, AllDefs<T>>;
            if (
              !spec ||
              typeof spec !== "object" ||
              !spec.select ||
              typeof spec.select !== "object"
            ) {
              throw new Error("Query spec must include a selection object");
            }
            if (spec.where?.id !== undefined && spec.where.ids !== undefined) {
              throw new Error('Query "where" cannot include both "id" and "ids"');
            }

            if (spec.where?.id !== undefined) {
              if (!hasEntity(typeDef as any, spec.where.id)) return undefined;
              return projectSelectedEntity(typeDef as any, spec.where.id, spec.select as any);
            }

            const ids =
              spec.where?.ids?.map((id) => String(id)) ??
              listEntityRefs(typeDef as any).map((entityRef) => entityRef.id);

            return ids.flatMap((id) =>
              hasEntity(typeDef as any, id)
                ? [projectSelectedEntity(typeDef as any, id, spec.select as any)]
                : [],
            );
          },
          ref(id: string) {
            return getEntityRef(typeDef as any, id);
          },
          node(id: string) {
            return getEntityRef(typeDef as any, id);
          },
        } as TypeHandle<any, any>;
        return handle;
      },
    },
  ) as NamespaceClient<T>;
}
