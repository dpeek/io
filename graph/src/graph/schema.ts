export type Cardinality = "one" | "one?" | "many";

type TypeLike = { values: { key: string } };
export type RangeRef = string | TypeLike;
export type PredicateLifecycleEvent = "create" | "update";
export type PredicateHookContext = {
  event: PredicateLifecycleEvent;
  nodeId: string;
  now: Date;
  incoming: unknown;
  previous: unknown;
  changedPredicateKeys: ReadonlySet<string>;
};
export type PredicateValueHook = (context: PredicateHookContext) => unknown;
type NormalizeRange<R extends RangeRef> = R extends string
  ? R
  : R extends { values: { key: infer K } }
    ? Extract<K, string>
    : string;

export type EdgeInput<R extends RangeRef = RangeRef> = {
  key?: string;
  range: R;
  cardinality: Cardinality;
  onCreate?: PredicateValueHook;
  onUpdate?: PredicateValueHook;
};

export type EdgeOutput<T extends EdgeInput = EdgeInput> = {
  key: string;
  range: NormalizeRange<T["range"]>;
  cardinality: T["cardinality"];
  onCreate?: PredicateValueHook;
  onUpdate?: PredicateValueHook;
};

export type ResolvedEdgeOutput<T extends EdgeInput = EdgeInput> = EdgeOutput<T> & {
  id: string;
};

export interface FieldsInput {
  [key: string]: EdgeInput<RangeRef> | EdgeOutput | FieldsInput;
}

export const fieldsMeta: unique symbol = Symbol("fieldsMeta");

export type FieldsOutput<T extends FieldsInput = any> = {
  [fieldsMeta]: { key: string };
} & {
  [K in Exclude<keyof T, typeof fieldsMeta>]: T[K] extends EdgeOutput<any>
    ? T[K]
    : T[K] extends EdgeInput<any>
      ? EdgeOutput<T[K]>
      : T[K] extends FieldsInput
        ? FieldsOutput<T[K]>
        : never;
};

function hasTypeLikeShape(value: unknown): value is TypeLike {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TypeLike>;
  return typeof candidate.values?.key === "string";
}

function hasEdgeShape(value: unknown): value is EdgeInput<RangeRef> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EdgeInput<RangeRef>>;
  const hasRange = typeof candidate.range === "string" || hasTypeLikeShape(candidate.range);
  return hasRange && typeof candidate.cardinality === "string";
}

function normalizeRangeRef(range: RangeRef): string {
  if (typeof range === "string") return range;
  const values = range.values as { key: string; id?: string };
  return values.id ?? values.key;
}

export function rangeOf<const R extends RangeRef>(range: R): NormalizeRange<R> {
  return normalizeRangeRef(range) as NormalizeRange<R>;
}

export function isFieldsOutput(value: unknown): value is FieldsOutput {
  if (!value || typeof value !== "object") return false;
  return fieldsMeta in (value as Record<PropertyKey, unknown>);
}

export function fieldTreeKey(tree: FieldsOutput): string {
  return tree[fieldsMeta].key;
}

type TreeWithId = { [fieldsMeta]: { key: string; id?: string } };

export function fieldTreeId(tree: TreeWithId): string {
  return tree[fieldsMeta].id ?? tree[fieldsMeta].key;
}

type EdgeWithId = { key: string; id?: string };

export function edgeId(edge: EdgeWithId): string {
  return edge.id ?? edge.key;
}

function ns<const T extends FieldsInput>(key: string, input: T): FieldsOutput<T> {
  function build(path: string, tree: FieldsInput): FieldsOutput<FieldsInput> {
    const out: Record<string, unknown> = {};
    Object.defineProperty(out, fieldsMeta, {
      value: { key: path },
      enumerable: false,
      configurable: false,
      writable: false,
    });

    for (const [name, value] of Object.entries(tree)) {
      const nextKey = `${path}:${name}`;
      if (hasEdgeShape(value)) {
        const edge = value as Partial<EdgeOutput> & Partial<ResolvedEdgeOutput>;
        out[name] = {
          key: edge.key ?? nextKey,
          range: normalizeRangeRef(edge.range as RangeRef),
          cardinality: edge.cardinality as Cardinality,
          ...(edge.onCreate ? { onCreate: edge.onCreate } : {}),
          ...(edge.onUpdate ? { onUpdate: edge.onUpdate } : {}),
          ...(edge.id ? { id: edge.id } : {}),
        } satisfies EdgeOutput;
      } else {
        out[name] = build(nextKey, value as FieldsInput);
      }
    }
    return out as FieldsOutput<FieldsInput>;
  }

  return build(key, input) as FieldsOutput<T>;
}

type TypeValues<K extends string = string> = { key: K; name?: string };
type ResolvedTypeValues<K extends string = string> = TypeValues<K> & { id: string };
export type EnumOptionInput<K extends string = string> = {
  key?: K;
  id?: string;
  name?: string;
  description?: string;
  docs?: string;
  order?: number;
  deprecated?: boolean;
};
type EnumOptionOutput<K extends string = string> = Omit<EnumOptionInput<K>, "key"> & { key: K };
type ResolvedEnumOption<K extends string = string> = EnumOptionOutput<K> & { id: string };

type EnumOptionKey<
  EnumKey extends string,
  Alias extends string,
  Option extends EnumOptionInput,
> = Option extends { key: infer K extends string } ? K : `${EnumKey}.${Alias}`;

type MaterializedEnumOptions<
  EnumKey extends string,
  Options extends Record<string, EnumOptionInput>,
> = {
  [Alias in keyof Options]: Omit<Options[Alias], "key"> & {
    key: EnumOptionKey<EnumKey, Extract<Alias, string>, Options[Alias]>;
  };
};

export type EntityTypeInput<Input extends FieldsInput = FieldsInput, K extends string = string> = {
  values: TypeValues<K>;
  fields: Input;
};

export type EntityTypeOutput<Input extends FieldsInput = any, K extends string = string> = {
  kind: "entity";
  values: TypeValues<K>;
  fields: FieldsOutput<Input>;
};

export type ResolvedEntityTypeOutput<Input extends FieldsInput = any, K extends string = string> = {
  kind: "entity";
  values: ResolvedTypeValues<K>;
  fields: FieldsOutput<Input>;
};

export type ScalarTypeInput<T, K extends string = string> = {
  values: TypeValues<K>;
  encode: (value: T) => string;
  decode: (raw: string) => T;
};

export type ScalarTypeOutput<T, K extends string = string> = {
  kind: "scalar";
  values: TypeValues<K>;
  encode: (value: T) => string;
  decode: (raw: string) => T;
};

export type ResolvedScalarTypeOutput<T, K extends string = string> = {
  kind: "scalar";
  values: ResolvedTypeValues<K>;
  encode: (value: T) => string;
  decode: (raw: string) => T;
};

export type EnumTypeInput<
  Options extends Record<string, EnumOptionInput> = Record<never, never>,
  K extends string = string,
> = {
  values: TypeValues<K>;
  options: Options;
};

export type EnumTypeOutput<
  Options extends Record<string, EnumOptionInput> = Record<never, never>,
  K extends string = string,
> = {
  kind: "enum";
  values: TypeValues<K> & MaterializedEnumOptions<K, Options>;
  options: MaterializedEnumOptions<K, Options>;
};

export type ResolvedEnumTypeOutput<
  Options extends Record<string, EnumOptionInput> = Record<never, never>,
  K extends string = string,
> = {
  kind: "enum";
  values: ResolvedTypeValues<K> & {
    [Alias in keyof Options]: ResolvedEnumOption<
      EnumOptionKey<K, Extract<Alias, string>, Options[Alias]>
    >;
  };
  options: {
    [Alias in keyof Options]: ResolvedEnumOption<
      EnumOptionKey<K, Extract<Alias, string>, Options[Alias]>
    >;
  };
};

export type AnyEnumTypeOutput = {
  kind: "enum";
  values: TypeValues;
  options: Record<string, EnumOptionOutput>;
};

export type ResolvedAnyEnumTypeOutput = {
  kind: "enum";
  values: ResolvedTypeValues;
  options: Record<string, ResolvedEnumOption>;
};

export type AnyTypeOutput = EntityTypeOutput | ScalarTypeOutput<any> | AnyEnumTypeOutput;
export type ResolvedAnyTypeOutput =
  | ResolvedEntityTypeOutput
  | ResolvedScalarTypeOutput<any>
  | ResolvedAnyEnumTypeOutput;
export type TypeOutput<Input extends FieldsInput = any> = EntityTypeOutput<Input>;
export type ResolvedTypeOutput<Input extends FieldsInput = any> = ResolvedEntityTypeOutput<Input>;

export function isEntityType(
  value: AnyTypeOutput | ResolvedAnyTypeOutput,
): value is EntityTypeOutput | ResolvedEntityTypeOutput {
  return value.kind === "entity";
}

export function isScalarType(
  value: AnyTypeOutput | ResolvedAnyTypeOutput,
): value is ScalarTypeOutput<any> | ResolvedScalarTypeOutput<any> {
  return value.kind === "scalar";
}

export function isEnumType(
  value: AnyTypeOutput | ResolvedAnyTypeOutput,
): value is AnyEnumTypeOutput | ResolvedAnyEnumTypeOutput {
  return value.kind === "enum";
}

export function typeId(typeDef: AnyTypeOutput | ResolvedAnyTypeOutput): string {
  const values = typeDef.values as { key: string; id?: string };
  return values.id ?? values.key;
}

export function defineType<const Key extends string, const Fields extends FieldsInput>(
  input: EntityTypeInput<Fields, Key>,
): EntityTypeOutput<Fields, Key> {
  const fields = ns(input.values.key, input.fields);
  return { kind: "entity", ...input, fields };
}

export function defineScalar<T, const Key extends string = string>(
  input: ScalarTypeInput<T, Key>,
): ScalarTypeOutput<T, Key> {
  return { kind: "scalar", ...input };
}

export function defineEnum<
  const Options extends Record<string, EnumOptionInput>,
  const Key extends string = string,
>(input: EnumTypeInput<Options, Key>): EnumTypeOutput<Options, Key> {
  const options: Record<string, EnumOptionOutput<string>> = {};
  const values = { ...input.values } as TypeValues<Key> &
    MaterializedEnumOptions<Key, Options> &
    Record<string, unknown>;
  const mutableValues = values as Record<string, unknown>;

  for (const [alias, option] of Object.entries(input.options)) {
    const normalized = {
      ...option,
      key: option.key ?? `${input.values.key}.${alias}`,
    } as EnumOptionOutput<string>;
    options[alias] = normalized;
    mutableValues[alias] = normalized;
  }
  return { kind: "enum", values, options: options as MaterializedEnumOptions<Key, Options> };
}

export { defineNamespace } from "./identity";
