import type { GraphBootstrapCoreSchema } from "@io/graph-bootstrap";
import { createGraphId } from "@io/graph-kernel";
import {
  edgeId,
  fieldTreeId,
  fieldTreeKey,
  isEnumType,
  isFieldsOutput,
  isScalarType,
  typeId,
} from "@io/graph-kernel";
import type { fieldTreeMeta } from "@io/graph-kernel";
import type {
  AnyTypeOutput,
  Cardinality,
  EdgeOutput,
  FieldsOutput,
  ScalarTypeOutput,
  TypeOutput,
  ValidationEvent,
  ValidationPhase,
} from "@io/graph-kernel";
import type { PredicateSlotListener, GraphStore } from "@io/graph-kernel";

export type TypeByKey<Defs extends Record<string, AnyTypeOutput>, K extends string> = Extract<
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

type FieldsTree = { [fieldTreeMeta]: { key: string } } & Record<string, unknown>;

type TreeEntity<T, Defs extends Record<string, AnyTypeOutput>> = T extends EdgeOutput
  ? Cardinalized<T["range"], T["cardinality"], Defs>
  : T extends FieldsTree
    ? { [K in Exclude<keyof T, typeof fieldTreeMeta>]: TreeEntity<T[K], Defs> }
    : never;

type TreeCreate<T, Defs extends Record<string, AnyTypeOutput>> = T extends EdgeOutput
  ? T["cardinality"] extends "one"
    ? PrimitiveForRange<T["range"], Defs>
    : T["cardinality"] extends "many"
      ? PrimitiveForRange<T["range"], Defs>[]
      : PrimitiveForRange<T["range"], Defs> | undefined
  : T extends FieldsTree
    ? {
        [K in Exclude<keyof T, typeof fieldTreeMeta> as T[K] extends EdgeOutput
          ? T[K]["cardinality"] extends "one"
            ? T[K] extends { createOptional: true }
              ? never
              : K
            : never
          : never]-?: TreeCreate<T[K], Defs>;
      } & {
        [K in Exclude<keyof T, typeof fieldTreeMeta> as T[K] extends EdgeOutput
          ? T[K]["cardinality"] extends "one"
            ? T[K] extends { createOptional: true }
              ? K
              : never
            : K
          : K]?: TreeCreate<T[K], Defs>;
      }
    : never;

export type AllDefs<
  NS extends Record<string, AnyTypeOutput>,
  Defs extends Record<string, AnyTypeOutput> = NS,
> = Defs;

export type GraphClientCoreSchema = GraphBootstrapCoreSchema;
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
  Defs extends Record<string, AnyTypeOutput> = Record<string, AnyTypeOutput>,
> = {
  [fieldGroupMeta]: FieldGroupInfo<T>;
} & {
  [K in Exclude<keyof T, typeof fieldTreeMeta>]: RefTree<T[K], Defs>;
};

export function isFieldGroupRef(value: unknown): value is FieldGroupLike {
  if (!value || typeof value !== "object") return false;
  return fieldGroupMeta in (value as Record<PropertyKey, unknown>);
}

export function fieldGroupFieldTree<
  T extends FieldsTree,
  Defs extends Record<string, AnyTypeOutput> = Record<string, AnyTypeOutput>,
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
  Defs extends Record<string, AnyTypeOutput> = Record<string, AnyTypeOutput>,
> = { id: string } & TreeEntity<T["fields"], Defs>;
export type CreateInputOfType<
  T extends TypeOutput,
  Defs extends Record<string, AnyTypeOutput> = Record<string, AnyTypeOutput>,
> = TreeCreate<T["fields"], Defs>;
export type PredicateValueOf<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput> = Record<string, AnyTypeOutput>,
> = Cardinalized<T["range"], T["cardinality"], Defs>;
export type PredicateRangeTypeOf<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput> = Record<string, AnyTypeOutput>,
> = TypeByKey<Defs, T["range"]> | undefined;
export type PredicateRangeEntityTypeOf<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput> = Record<string, AnyTypeOutput>,
> = Extract<NonNullable<PredicateRangeTypeOf<T, Defs>>, TypeOutput>;
export type PredicateItemOf<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput> = Record<string, AnyTypeOutput>,
> = PredicateValueOf<T, Defs> extends (infer Item)[] ? Item : never;
export type PredicateSetValueOf<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput> = Record<string, AnyTypeOutput>,
> = Exclude<PredicateValueOf<T, Defs>, undefined>;
export type PredicateRangeEntityRefOf<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput> = Record<string, AnyTypeOutput>,
> = [PredicateRangeEntityTypeOf<T, Defs>] extends [never]
  ? never
  : EntityRef<PredicateRangeEntityTypeOf<T, Defs>, Defs>;

export type RefTree<T, Defs extends Record<string, AnyTypeOutput>> = T extends EdgeOutput
  ? PredicateRef<T, Defs>
  : T extends FieldsTree
    ? FieldGroupRef<T, Defs>
    : never;

export type PredicateCollectionSemantics = {
  kind: PredicateCollectionKind;
};

export type PredicateRef<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput> = Record<string, AnyTypeOutput>,
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
  Defs extends Record<string, AnyTypeOutput> = Record<string, AnyTypeOutput>,
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

export type FieldQuerySelection<
  T extends FieldsTree,
  Defs extends Record<string, AnyTypeOutput>,
> = {
  [K in Exclude<keyof T, typeof fieldTreeMeta>]?: QuerySelectionNode<T[K], Defs>;
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

export type QueryFieldResult<
  T extends FieldsTree,
  Selection extends FieldQuerySelection<T, Defs>,
  Defs extends Record<string, AnyTypeOutput>,
> = {
  [K in keyof Selection & Exclude<keyof T, typeof fieldTreeMeta>]: QueryResultNode<
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
  Defs extends Record<string, AnyTypeOutput> = Record<string, AnyTypeOutput>,
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
  Defs extends Record<string, AnyTypeOutput> = Record<string, AnyTypeOutput>,
  Selection extends TypeQuerySelection<T, Defs> = TypeQuerySelection<T, Defs>,
> = {
  select: Selection;
  where?: TypeQueryWhere;
};

export type TypeQueryResult<
  T extends TypeOutput,
  Selection,
  Defs extends Record<string, AnyTypeOutput> = Record<string, AnyTypeOutput>,
> =
  Selection extends TypeQuerySelection<T, Defs>
    ? QueryFieldResult<T["fields"], Selection, Defs> &
        (Selection extends { id: true } ? { id: string } : {})
    : never;

export type TypeQueryResponse<
  T extends TypeOutput,
  Query,
  Defs extends Record<string, AnyTypeOutput> = Record<string, AnyTypeOutput>,
> =
  Query extends TypeQuerySpec<T, Defs, infer Selection>
    ? Query["where"] extends { id: string }
      ? TypeQueryResult<T, Selection, Defs> | undefined
      : TypeQueryResult<T, Selection, Defs>[]
    : never;

export type EntityLookup<Defs extends Record<string, AnyTypeOutput>> = {
  resolve<T extends TypeOutput>(typeDef: T, id: string): EntityRef<T, Defs>;
  list<T extends TypeOutput>(typeDef: T): EntityRef<T, Defs>[];
};

export type FlatPredicateEntry = {
  path: string[];
  field: string;
  predicate: EdgeOutput;
};

export type PredicateValue = unknown;
export type ReadPredicateValueOptions = {
  strictRequired?: boolean;
};
export const clearFieldValue = Symbol("clearFieldValue");
export type ClearFieldValue = typeof clearFieldValue;
export type PredicateCollectionKind = "ordered" | "unordered";
export type EncodedPredicateValue = {
  encoded: string;
  decoded: unknown;
};

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

export type GraphClient<
  T extends Record<string, AnyTypeOutput>,
  Defs extends Record<string, AnyTypeOutput> = T,
> = {
  [K in keyof T as T[K] extends { kind: "entity" } ? K : never]: TypeHandle<
    Extract<T[K], { kind: "entity" }>,
    Defs
  >;
};

const validationNowByStore = new WeakMap<GraphStore, { version: number; now: Date }>();
const validationCreateNodeIdByStore = new WeakMap<
  GraphStore,
  { version: number; nodeId: string }
>();

export function isEdgeOutput(value: unknown): value is EdgeOutput {
  const candidate = value as Partial<EdgeOutput>;
  return typeof candidate.key === "string" && typeof candidate.range === "string";
}

export function isTree(value: unknown): value is FieldsOutput {
  return isFieldsOutput(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

export function cloneDate(value: Date): Date {
  return new Date(value.getTime());
}

export function getStableValidationNow(store: GraphStore): Date {
  const version = store.version();
  const cached = validationNowByStore.get(store);
  if (cached?.version === version) return cloneDate(cached.now);

  const now = new Date();
  validationNowByStore.set(store, { version, now });
  return cloneDate(now);
}

function collectUsedIds(store: GraphStore): Set<string> {
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

function createUnusedNodeId(store: GraphStore): string {
  const usedIds = collectUsedIds(store);
  let nodeId = createGraphId();
  while (usedIds.has(nodeId)) nodeId = createGraphId();
  return nodeId;
}

export function getStableCreateNodeId(store: GraphStore): string {
  const version = store.version();
  const cached = validationCreateNodeIdByStore.get(store);
  if (cached?.version === version) return cached.nodeId;

  const nodeId = createUnusedNodeId(store);
  validationCreateNodeIdByStore.set(store, { version, nodeId });
  return nodeId;
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

export function getPredicateCollectionKind(field: EdgeOutput): PredicateCollectionKind {
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

export function flattenPredicates(tree: FieldsOutput | undefined): FlatPredicateEntry[] {
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

export function getNestedValue(
  obj: Record<string, unknown>,
  path: string[],
  field: string,
): unknown {
  let current: unknown = obj;
  for (const part of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  if (!current || typeof current !== "object") return undefined;
  return (current as Record<string, unknown>)[field];
}

export function hasNestedValue(
  obj: Record<string, unknown>,
  path: string[],
  field: string,
): boolean {
  let current: unknown = obj;
  for (const part of path) {
    if (!current || typeof current !== "object") return false;
    if (!(part in (current as Record<string, unknown>))) return false;
    current = (current as Record<string, unknown>)[part];
  }
  if (!current || typeof current !== "object") return false;
  return field in (current as Record<string, unknown>);
}

export function setNestedValue(
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

export function deleteNestedValue(
  obj: Record<string, unknown>,
  path: string[],
  field: string,
): void {
  let current: Record<string, unknown> | undefined = obj;
  for (const part of path) {
    const next = current?.[part];
    if (!next || typeof next !== "object") return;
    current = next as Record<string, unknown>;
  }
  if (!current) return;
  delete current[field];
}

export function cloneInput<T>(input: T): T {
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

export function exposeValidationResult<T>(
  result: GraphValidationResult<T>,
): GraphValidationResult<T> {
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

export function exposeMutationValidationResult(
  result: GraphMutationValidationResult,
): GraphMutationValidationResult {
  return exposeValidationResult(result) as GraphMutationValidationResult;
}

export function collectChangedPredicateKeys(
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

export function encodeForRange(
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

  if (typeof value !== "string")
    throw new Error(`Expected string for unknown range "${range}", got ${typeof value}`);
  return value;
}

export function decodeForRange(
  raw: string,
  range: string,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
): unknown {
  const scalarType = scalarByKey.get(range);
  if (scalarType) return scalarType.decode(raw);

  const rangeType = typeByKey.get(range);
  if (rangeType?.kind === "entity") return raw;

  return raw;
}

function readEncodedPredicateValues(
  store: GraphStore,
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

export function uniqueEncodedPredicateValues(
  values: EncodedPredicateValue[],
): EncodedPredicateValue[] {
  const seen = new Set<string>();
  const out: EncodedPredicateValue[] = [];

  for (const value of values) {
    if (seen.has(value.encoded)) continue;
    seen.add(value.encoded);
    out.push(value);
  }

  return out;
}

export function readLogicalManyValues(
  store: GraphStore,
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

export function normalizeRequestedManyValues(
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

export function planManyValues(
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

export function removeManyValue(
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

export function readPredicateValue(
  store: GraphStore,
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

export function collectIssuePredicateKeys(issues: readonly GraphValidationIssue[]): Set<string> {
  const changedPredicateKeys = new Set<string>();
  for (const issue of issues) changedPredicateKeys.add(issue.predicateKey);
  return changedPredicateKeys;
}

export function mergeChangedPredicateKeys(
  changedPredicateKeys: ReadonlySet<string>,
  issues: readonly GraphValidationIssue[],
): Set<string> {
  const merged = new Set(changedPredicateKeys);
  for (const key of collectIssuePredicateKeys(issues)) merged.add(key);
  return merged;
}

export function entryChangedPredicateKeys(predicateKey: string): ReadonlySet<string> {
  return new Set([predicateKey]);
}

export function invalidResult<T>(
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

export function validResult<T>(
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

export function assertValidResult<T>(
  result: GraphValidationResult<T>,
): asserts result is Extract<GraphValidationResult<T>, { ok: true }> {
  if (!result.ok) throw new GraphValidationError(result);
}

export function collectScalarCodecs(
  namespace: Record<string, AnyTypeOutput>,
): Map<string, ScalarTypeOutput<any>> {
  const out = new Map<string, ScalarTypeOutput<any>>();
  const combined = Object.values(namespace);
  for (const typeDef of combined) {
    if (!isScalarType(typeDef)) continue;
    out.set(typeDef.values.key, typeDef);
    out.set(typeId(typeDef), typeDef);
  }
  return out;
}

export function collectTypeIndex(
  namespace: Record<string, AnyTypeOutput>,
): Map<string, AnyTypeOutput> {
  const out = new Map<string, AnyTypeOutput>();
  const combined = Object.values(namespace);
  for (const typeDef of combined) {
    out.set(typeDef.values.key, typeDef);
    out.set(typeId(typeDef), typeDef);
  }
  return out;
}

export function collectEnumValueIds(
  namespace: Record<string, AnyTypeOutput>,
  typeByKey: Map<string, AnyTypeOutput>,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const combined = Object.values(namespace);
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
