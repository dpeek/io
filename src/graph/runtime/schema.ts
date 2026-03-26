import { fieldTreeMeta } from "@io/graph-kernel";

/**
 * Schema authoring remains local for now.
 *
 * The package copy is structurally close, but the local runtime still depends
 * on its exact field-tree symbol flow and `ResolvedNamespace<T>` behavior.
 */

export type Cardinality = "one" | "one?" | "many";
export type GraphFieldVisibility = "replicated" | "authority-only";
export type GraphFieldWritePolicy = "client-tx" | "server-command" | "authority-only";
export type PolicyCapabilityKey = string;
export type PolicyAudience = "owner" | "graph-member" | "capability" | "public" | "authority";
export type PolicyMutationMode =
  | "owner-edit"
  | "graph-member-edit"
  | "capability"
  | "module-command"
  | "authority";
export type PredicatePolicyDefinition = {
  readonly readAudience: PolicyAudience;
  readonly writeAudience: PolicyMutationMode;
  readonly shareable: boolean;
  readonly requiredCapabilities?: readonly PolicyCapabilityKey[];
};
export type PredicatePolicyDescriptor = PredicatePolicyDefinition & {
  readonly predicateId: string;
  readonly transportVisibility: GraphFieldVisibility;
  readonly requiredWriteScope: GraphFieldWritePolicy;
};

/**
 * Explicit policy-contract epoch for fallback descriptor lowering.
 *
 * Bump this when the fallback mapping for predicates without authored policy
 * metadata changes in a way that affects allow/deny or scoped visibility for
 * the same stored graph state.
 */
export const fieldPolicyFallbackContractVersion = 0;

/**
 * Stable field-visibility values published by the shared graph/runtime layer.
 *
 * Downstream branches may depend on this set without coupling to a transport,
 * policy engine, or storage adapter.
 */
export const graphFieldVisibilities = [
  "replicated",
  "authority-only",
] as const satisfies readonly GraphFieldVisibility[];

export function isGraphFieldVisibility(value: unknown): value is GraphFieldVisibility {
  return typeof value === "string" && (graphFieldVisibilities as readonly string[]).includes(value);
}

/**
 * Stable field-write levels published by the shared graph/runtime layer.
 *
 * Richer command or principal-aware policy surfaces may layer on top of these
 * levels, but they should not redefine them.
 */
export const graphFieldWritePolicies = [
  "client-tx",
  "server-command",
  "authority-only",
] as const satisfies readonly GraphFieldWritePolicy[];

export function isGraphFieldWritePolicy(value: unknown): value is GraphFieldWritePolicy {
  return (
    typeof value === "string" && (graphFieldWritePolicies as readonly string[]).includes(value)
  );
}

/**
 * Stable metadata for secret-backed predicates.
 *
 * This describes the graph-visible sealed-handle boundary for predicates that
 * reference `core:secretHandle`. Plaintext storage, reveal flows, and
 * adapter-specific durability stay outside this contract.
 */
export type GraphSecretFieldAuthority = {
  kind: "sealed-handle";
  metadataVisibility?: GraphFieldVisibility;
  revealCapability?: PolicyCapabilityKey;
  rotateCapability?: PolicyCapabilityKey;
};

/**
 * Stable field-authority metadata consumed by sync filtering, write-policy
 * validation, and downstream branches.
 *
 * Do not attach adapter-specific transport or storage details here.
 */
export type GraphFieldAuthority = {
  visibility?: GraphFieldVisibility;
  write?: GraphFieldWritePolicy;
  policy?: PredicatePolicyDefinition;
  secret?: GraphSecretFieldAuthority;
};
export type DefinitionIconRef = string | { id: string };

type TypeLike = { values: { key: string } };
export type RangeRef = string | TypeLike;
export type PredicateLifecycleEvent = "create" | "update";
export type ValidationIssueInput = {
  code: string;
  message: string;
};
export type ValidationPhase = "local" | "authoritative";
export type ValidationEvent = PredicateLifecycleEvent | "delete" | "reconcile";
export type PredicateHookContext = {
  event: PredicateLifecycleEvent;
  nodeId: string;
  now: Date;
  incoming: unknown;
  previous: unknown;
  changedPredicateKeys: ReadonlySet<string>;
};
export type PredicateValueHook = (context: PredicateHookContext) => unknown;
export type PredicateValidationContext = {
  event: ValidationEvent;
  phase: ValidationPhase;
  nodeId: string;
  now: Date;
  path: readonly string[];
  field: string;
  predicateKey: string;
  range: string;
  cardinality: Cardinality;
  value: unknown;
  previous: unknown;
  changedPredicateKeys: ReadonlySet<string>;
};
export type PredicateValidator = (
  context: PredicateValidationContext,
) => ValidationIssueInput | ValidationIssueInput[] | void;
export type ScalarValidationContext<T> = {
  event: ValidationEvent;
  phase: ValidationPhase;
  nodeId: string;
  now: Date;
  path: readonly string[];
  predicateKey: string;
  range: string;
  value: T;
  previous: unknown;
  changedPredicateKeys: ReadonlySet<string>;
};
export type ScalarValueValidator<T> = (
  context: ScalarValidationContext<T>,
) => ValidationIssueInput | ValidationIssueInput[] | void;
type NormalizeRange<R extends RangeRef> = R extends string
  ? R
  : R extends { values: { key: infer K } }
    ? Extract<K, string>
    : string;

export type EdgeInput<R extends RangeRef = RangeRef, Extra extends object = {}> = {
  key?: string;
  icon?: DefinitionIconRef;
  range: R;
  cardinality: Cardinality;
  createOptional?: true;
  onCreate?: PredicateValueHook;
  onUpdate?: PredicateValueHook;
  validate?: PredicateValidator;
} & Extra;

export type EdgeOutput<T extends EdgeInput = EdgeInput> = {
  key: string;
  range: NormalizeRange<T["range"]>;
  cardinality: T["cardinality"];
  onCreate?: PredicateValueHook;
  onUpdate?: PredicateValueHook;
  validate?: PredicateValidator;
} & Omit<T, "cardinality" | "key" | "onCreate" | "onUpdate" | "range">;

export type ResolvedEdgeOutput<T extends EdgeInput = EdgeInput> = EdgeOutput<T> & {
  id: string;
};

export interface FieldsInput {
  [key: string]: EdgeInput<RangeRef> | EdgeOutput | FieldsInput;
}

export { fieldTreeMeta } from "@io/graph-kernel";

export type FieldsOutput<T extends FieldsInput = any> = {
  [fieldTreeMeta]: { key: string };
} & {
  [K in Exclude<keyof T, typeof fieldTreeMeta>]: T[K] extends EdgeOutput<any>
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
  const values = range.values as { key: string; id?: unknown };
  return typeof values.id === "string" ? values.id : values.key;
}

export function rangeOf<const R extends RangeRef>(range: R): NormalizeRange<R> {
  return normalizeRangeRef(range) as NormalizeRange<R>;
}

export function isFieldsOutput(value: unknown): value is FieldsOutput {
  if (!value || typeof value !== "object") return false;
  return fieldTreeMeta in (value as Record<PropertyKey, unknown>);
}

export function fieldTreeKey(tree: FieldsOutput): string {
  return tree[fieldTreeMeta].key;
}

type TreeWithId = { [fieldTreeMeta]: { key: string; id?: string } };

export function fieldTreeId(tree: TreeWithId): string {
  return tree[fieldTreeMeta].id ?? tree[fieldTreeMeta].key;
}

type EdgeWithId = { key: string; id?: string };

export function edgeId(edge: EdgeWithId): string {
  return edge.id ?? edge.key;
}

export function fieldVisibility(field: { authority?: GraphFieldAuthority } | undefined) {
  return field?.authority?.visibility ?? "replicated";
}

export function fieldWritePolicy(field: { authority?: GraphFieldAuthority } | undefined) {
  return field?.authority?.write ?? "client-tx";
}

type FieldWithAuthorityPolicy = {
  key: string;
  id?: string;
  authority?: GraphFieldAuthority;
};

export function fieldPolicyDescriptor(
  field: FieldWithAuthorityPolicy | undefined,
): PredicatePolicyDescriptor | undefined {
  const policy = field?.authority?.policy;
  if (!field || !policy) return undefined;

  return {
    predicateId: edgeId(field),
    transportVisibility: fieldVisibility(field),
    requiredWriteScope: fieldWritePolicy(field),
    readAudience: policy.readAudience,
    writeAudience: policy.writeAudience,
    shareable: policy.shareable,
    ...(policy.requiredCapabilities
      ? { requiredCapabilities: [...policy.requiredCapabilities] }
      : {}),
  } satisfies PredicatePolicyDescriptor;
}

export function createFallbackPolicyDescriptor(
  field: FieldWithAuthorityPolicy,
): PredicatePolicyDescriptor {
  const transportVisibility = fieldVisibility(field);
  const requiredWriteScope = fieldWritePolicy(field);
  return {
    predicateId: edgeId(field),
    transportVisibility,
    requiredWriteScope,
    readAudience: transportVisibility === "authority-only" ? "authority" : "public",
    writeAudience: requiredWriteScope === "client-tx" ? "graph-member-edit" : "authority",
    shareable: false,
  } satisfies PredicatePolicyDescriptor;
}

export function resolveFieldPolicyDescriptor(
  field: FieldWithAuthorityPolicy | undefined,
): PredicatePolicyDescriptor | undefined {
  if (!field) return undefined;
  return fieldPolicyDescriptor(field) ?? createFallbackPolicyDescriptor(field);
}
export function fieldSecretMetadataVisibility(
  field: { authority?: GraphFieldAuthority } | undefined,
) {
  return field?.authority?.secret?.metadataVisibility ?? fieldVisibility(field);
}
export function isSecretBackedField<Field extends { authority?: GraphFieldAuthority }>(
  field: Field | undefined,
): field is Field & { authority: GraphFieldAuthority & { secret: GraphSecretFieldAuthority } } {
  return field?.authority?.secret?.kind === "sealed-handle";
}

function ns<const T extends FieldsInput>(key: string, input: T): FieldsOutput<T> {
  function build(path: string, tree: FieldsInput): FieldsOutput<FieldsInput> {
    const out: Record<string, unknown> = {};
    Object.defineProperty(out, fieldTreeMeta, {
      value: { key: path },
      enumerable: false,
      configurable: false,
      writable: false,
    });

    for (const [name, value] of Object.entries(tree)) {
      const nextKey = `${path}:${name}`;
      if (hasEdgeShape(value)) {
        const edge = value as EdgeInput<RangeRef> &
          Partial<ResolvedEdgeOutput> &
          Record<string, unknown>;
        const {
          key: edgeKey,
          range,
          cardinality,
          createOptional,
          onCreate,
          onUpdate,
          validate,
          id,
          ...extras
        } = edge;
        out[name] = {
          ...extras,
          key: edgeKey ?? nextKey,
          range: normalizeRangeRef(range),
          cardinality: cardinality as Cardinality,
          ...(createOptional ? { createOptional } : {}),
          ...(onCreate ? { onCreate } : {}),
          ...(onUpdate ? { onUpdate } : {}),
          ...(validate ? { validate } : {}),
          ...(id ? { id } : {}),
        } satisfies EdgeOutput;
      } else {
        out[name] = build(nextKey, value as FieldsInput);
      }
    }
    return out as FieldsOutput<FieldsInput>;
  }

  return build(key, input) as FieldsOutput<T>;
}

type TypeValues<K extends string = string> = {
  key: K;
  name?: string;
  icon?: DefinitionIconRef;
};
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
  validate?: ScalarValueValidator<T>;
};

export type ScalarTypeOutput<T, K extends string = string> = {
  kind: "scalar";
  values: TypeValues<K>;
  encode: (value: T) => string;
  decode: (raw: string) => T;
  validate?: ScalarValueValidator<T>;
};

export type ResolvedScalarTypeOutput<T, K extends string = string> = {
  kind: "scalar";
  values: ResolvedTypeValues<K>;
  encode: (value: T) => string;
  decode: (raw: string) => T;
  validate?: ScalarValueValidator<T>;
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
  const values = typeDef.values as { key: string; id?: unknown };
  return typeof values.id === "string" ? values.id : values.key;
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

export { applyIdMap } from "./identity";
