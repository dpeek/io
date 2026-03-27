import type { TypeFilterOperator } from "@io/core/graph/def";
import { type PredicateRef } from "@io/graph-client";
import {
  isEnumType,
  type AnyTypeOutput,
  type EdgeOutput,
  type ResolvedAnyTypeOutput,
  typeId,
} from "@io/graph-kernel";
import type { ComponentType, ReactNode } from "react";

type FieldFilterContract = {
  defaultOperator: string;
  operators: Record<string, TypeFilterOperator<any, any, any>>;
};

type EnumTypeLike = Extract<AnyTypeOutput | ResolvedAnyTypeOutput, { kind: "enum" }>;

export type FieldFilterOf<T extends EdgeOutput> = T extends {
  filter: infer Filter extends FieldFilterContract;
}
  ? Filter
  : never;
export type FieldFilterOperatorKey<T extends EdgeOutput> =
  FieldFilterOf<T> extends FieldFilterContract
    ? Extract<keyof FieldFilterOf<T>["operators"], string>
    : never;
type FieldFilterOperatorOf<T extends EdgeOutput, Key extends FieldFilterOperatorKey<T>> =
  FieldFilterOf<T> extends FieldFilterContract ? FieldFilterOf<T>["operators"][Key] : never;
type AuthoredFieldFilterValueOf<T extends EdgeOutput, Key extends FieldFilterOperatorKey<T>> =
  FieldFilterOperatorOf<T, Key> extends TypeFilterOperator<infer Value, any, any> ? Value : never;
type AuthoredFieldFilterOperandOf<T extends EdgeOutput, Key extends FieldFilterOperatorKey<T>> =
  FieldFilterOperatorOf<T, Key> extends TypeFilterOperator<any, infer Operand, any>
    ? Operand
    : never;
type FieldFilterOperandShapeOf<T extends EdgeOutput, Key extends FieldFilterOperatorKey<T>> =
  FieldFilterOperatorOf<T, Key> extends TypeFilterOperator<any, any, infer OperandShape>
    ? OperandShape
    : never;

export type GraphFilterOperandOf<T extends EdgeOutput, Key extends FieldFilterOperatorKey<T>> =
  FieldFilterOperandShapeOf<T, Key> extends { kind: "enum"; selection: "many" }
    ? string[]
    : FieldFilterOperandShapeOf<T, Key> extends { kind: "enum" }
      ? string
      : AuthoredFieldFilterOperandOf<T, Key>;

export type GraphFilterValueOf<T extends EdgeOutput, Key extends FieldFilterOperatorKey<T>> =
  FieldFilterOperandShapeOf<T, Key> extends { kind: "enum" }
    ? string
    : AuthoredFieldFilterValueOf<T, Key>;

type FilterablePredicateRef<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> = Pick<PredicateRef<T, Defs>, "field" | "predicateId">;

export type GraphFilterEnumOption = {
  value: string;
  key: string;
  label: string;
};

export type FilterOperandProps<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
> = {
  operator: GraphFilterOperatorResolution<T, Defs, Key>;
  value: GraphFilterOperandOf<T, Key> | undefined;
  onChange: (value: GraphFilterOperandOf<T, Key> | undefined) => void;
};

export type GraphFilterOperandEditorCapability<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
> = {
  kind: FieldFilterOperandShapeOf<T, Key>["kind"];
  Component: ComponentType<FilterOperandProps<T, Defs, Key>>;
};

type AnyOperandEditorCapability = GraphFilterOperandEditorCapability<any, any, any>;

export type UnsupportedFieldFilterReason = "missing-filter";
export type UnsupportedFilterOperandReason = "missing-enum-type" | "unsupported-operand-kind";

export type GraphFilterOperandEditorResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
> =
  | {
      status: "resolved";
      capability: GraphFilterOperandEditorCapability<T, Defs, Key>;
    }
  | {
      status: "unsupported";
      reason: UnsupportedFilterOperandReason;
      kind?: string;
    };

export type GraphFilterOperandResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
> = FieldFilterOperandShapeOf<T, Key> & {
  editor: GraphFilterOperandEditorResolution<T, Defs, Key>;
} & (FieldFilterOperandShapeOf<T, Key> extends { kind: "enum" }
    ? { options: readonly GraphFilterEnumOption[] }
    : {});

export type GraphFilterOperatorResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
> = {
  key: Key;
  label: string;
  operand: GraphFilterOperandResolution<T, Defs, Key>;
  parse: (raw: string) => GraphFilterOperandOf<T, Key>;
  format: (operand: GraphFilterOperandOf<T, Key>) => string;
  test: (value: GraphFilterValueOf<T, Key>, operand: GraphFilterOperandOf<T, Key>) => boolean;
};

export type GraphRuntimeFilterOperand<T extends EdgeOutput, Key extends FieldFilterOperatorKey<T>> =
  FieldFilterOperandShapeOf<T, Key> extends {
    kind: "enum";
    selection: infer Selection extends "one" | "many";
  }
    ? {
        kind: "enum";
        selection: Selection;
        value: string;
      }
    : {
        kind: FieldFilterOperandShapeOf<T, Key>["kind"];
        value: string;
      };

export type GraphRuntimeFilterClause<
  T extends EdgeOutput,
  Key extends FieldFilterOperatorKey<T>,
> = {
  predicateId: string;
  predicateKey: T["key"];
  rangeKey: T["range"];
  cardinality: T["cardinality"];
  operatorKey: Key;
  operatorLabel: string;
  operand: GraphRuntimeFilterOperand<T, Key>;
};

export type GraphFieldFilterResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> =
  | {
      status: "resolved";
      field: T;
      rangeType: Defs[keyof Defs] | undefined;
      defaultOperator: FieldFilterOperatorKey<T>;
      operators: readonly GraphFilterOperatorResolution<T, Defs, FieldFilterOperatorKey<T>>[];
      resolveOperator<Key extends FieldFilterOperatorKey<T>>(
        key: Key,
      ): GraphFilterOperatorResolution<T, Defs, Key> | undefined;
    }
  | {
      status: "unsupported";
      reason: UnsupportedFieldFilterReason;
    };

export type GraphFilterResolver = {
  resolveField<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
    field: T,
    defs: Defs,
  ): GraphFieldFilterResolution<T, Defs>;
  resolvePredicate<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
    predicate: PredicateRef<T, Defs>,
  ): GraphFieldFilterResolution<T, Defs>;
};

export type ActiveGraphFilterClause<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
> = {
  operand: GraphFilterOperandOf<T, Key>;
  operator: GraphFilterOperatorResolution<T, Defs, Key>;
  predicate: FilterablePredicateRef<T, Defs>;
};

type AnyActiveGraphFilterClause = ActiveGraphFilterClause<any, any, any>;
type AnyGraphRuntimeFilterClause = GraphRuntimeFilterClause<any, any>;

export type GraphRuntimeFilterQuery = {
  clauses: readonly AnyGraphRuntimeFilterClause[];
  combinator: "and";
  entityTypeKey: string;
};

export type UnsupportedFilterOperandFallbackProps = {
  reason: UnsupportedFilterOperandReason;
  kind?: string;
};

export type FilterOperandEditorProps<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
> = FilterOperandProps<T, Defs, Key> & {
  fallback?: ComponentType<UnsupportedFilterOperandFallbackProps>;
};

type EnumIdentityMap = {
  toCanonical(value: string): string;
  toResolved(value: string): string;
};

function hasFieldFilter<T extends EdgeOutput>(
  field: T,
): field is T & { filter: FieldFilterContract } {
  const candidate = field as T & { filter?: FieldFilterContract };
  return (
    typeof candidate.filter?.defaultOperator === "string" &&
    !!candidate.filter?.operators &&
    typeof candidate.filter.operators === "object"
  );
}

function toCapabilityMap<T extends { kind: string }>(
  capabilities: readonly T[],
): ReadonlyMap<string, T> {
  return new Map(capabilities.map((capability) => [capability.kind, capability]));
}

function resolveFieldRangeType<Defs extends Record<string, AnyTypeOutput>>(
  field: EdgeOutput,
  defs: Defs,
): Defs[keyof Defs] | undefined {
  return Object.values(defs).find(
    (typeDef) => typeDef.values.key === field.range || typeId(typeDef) === field.range,
  ) as Defs[keyof Defs] | undefined;
}

function getFieldDisplayFormatter(field: EdgeOutput): ((value: unknown) => string) | undefined {
  const meta = (
    field as EdgeOutput & {
      meta?: {
        display?: {
          format?: (value: unknown) => string;
        };
      };
    }
  ).meta;
  return meta?.display?.format;
}

function formatEnumOptionLabel(field: EdgeOutput, option: { key: string; name?: string }): string {
  const formatter = getFieldDisplayFormatter(field);
  if (formatter) return formatter(option.key);
  return option.name ?? option.key;
}

function resolveEnumOptions(
  field: EdgeOutput,
  rangeType: EnumTypeLike | undefined,
): readonly GraphFilterEnumOption[] {
  if (!rangeType) return [];
  return Object.values(rangeType.options).map((option) => ({
    value: option.id ?? option.key,
    key: option.key,
    label: formatEnumOptionLabel(field, option),
  }));
}

function createEnumIdentityMap(rangeType: EnumTypeLike): EnumIdentityMap {
  const canonicalByIdentity = new Map<string, string>();
  const resolvedByCanonical = new Map<string, string>();

  for (const option of Object.values(rangeType.options)) {
    const resolved = option.id ?? option.key;
    canonicalByIdentity.set(option.key, option.key);
    canonicalByIdentity.set(resolved, option.key);
    resolvedByCanonical.set(option.key, resolved);
  }

  return {
    toCanonical(value: string): string {
      return canonicalByIdentity.get(value) ?? value;
    },
    toResolved(value: string): string {
      return resolvedByCanonical.get(value) ?? value;
    },
  };
}

function resolveOperandEditor<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
>(
  operand: FieldFilterOperandShapeOf<T, Key>,
  rangeType: Defs[keyof Defs] | undefined,
  operandEditorByKind: ReadonlyMap<string, AnyOperandEditorCapability>,
): GraphFilterOperandEditorResolution<T, Defs, Key> {
  if (operand.kind === "enum" && (!rangeType || !isEnumType(rangeType))) {
    return {
      status: "unsupported",
      reason: "missing-enum-type",
      kind: operand.kind,
    };
  }

  const capability = operandEditorByKind.get(operand.kind);
  if (!capability) {
    return {
      status: "unsupported",
      reason: "unsupported-operand-kind",
      kind: operand.kind,
    };
  }

  return {
    status: "resolved",
    capability: capability as GraphFilterOperandEditorCapability<T, Defs, Key>,
  };
}

function resolveOperator<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
>(
  field: T,
  rangeType: Defs[keyof Defs] | undefined,
  key: Key,
  operator: FieldFilterOperatorOf<T, Key>,
  operandEditorByKind: ReadonlyMap<string, AnyOperandEditorCapability>,
): GraphFilterOperatorResolution<T, Defs, Key> {
  const baseOperator = operator as TypeFilterOperator<
    AuthoredFieldFilterValueOf<T, Key>,
    AuthoredFieldFilterOperandOf<T, Key>
  > & {
    operand: FieldFilterOperandShapeOf<T, Key>;
  };
  const editor = resolveOperandEditor(baseOperator.operand, rangeType, operandEditorByKind);

  if (baseOperator.operand.kind !== "enum") {
    return {
      key,
      label: baseOperator.label,
      operand: {
        ...baseOperator.operand,
        editor,
      } as GraphFilterOperandResolution<T, Defs, Key>,
      parse: baseOperator.parse as (raw: string) => GraphFilterOperandOf<T, Key>,
      format: baseOperator.format as (operand: GraphFilterOperandOf<T, Key>) => string,
      test: baseOperator.test as (
        value: GraphFilterValueOf<T, Key>,
        operand: GraphFilterOperandOf<T, Key>,
      ) => boolean,
    };
  }

  const enumOperand = baseOperator.operand as unknown as Extract<
    FieldFilterOperandShapeOf<T, Key>,
    { kind: "enum" }
  >;

  const enumType = rangeType && isEnumType(rangeType) ? (rangeType as EnumTypeLike) : undefined;
  const enumOptions = resolveEnumOptions(field, enumType);
  const identities = enumType ? createEnumIdentityMap(enumType) : undefined;

  function resolveCanonicalValue(value: string): string {
    return identities ? identities.toCanonical(value) : value;
  }

  function resolveRuntimeValue(value: string): string {
    return identities ? identities.toResolved(value) : value;
  }

  function parseEnumOperand(raw: string): GraphFilterOperandOf<T, Key> {
    if (enumOperand.selection === "many") {
      const canonicalRaw = raw
        .split(",")
        .map((value) => resolveCanonicalValue(value.trim()))
        .join(",");
      const parsed = baseOperator.parse(canonicalRaw) as string[];
      return parsed.map((value) => resolveRuntimeValue(value)) as GraphFilterOperandOf<T, Key>;
    }

    const parsed = baseOperator.parse(resolveCanonicalValue(raw.trim())) as string;
    return resolveRuntimeValue(parsed) as GraphFilterOperandOf<T, Key>;
  }

  function formatEnumOperand(operand: GraphFilterOperandOf<T, Key>): string {
    if (enumOperand.selection === "many") {
      const runtimeValues = Array.isArray(operand) ? operand : [];
      const canonicalOperand = runtimeValues.map((value) => resolveCanonicalValue(value));
      baseOperator.format(canonicalOperand as AuthoredFieldFilterOperandOf<T, Key>);
      return runtimeValues.join(",");
    }

    const runtimeValue = typeof operand === "string" ? operand : "";
    baseOperator.format(
      resolveCanonicalValue(runtimeValue) as AuthoredFieldFilterOperandOf<T, Key>,
    );
    return runtimeValue;
  }

  function testEnumOperand(
    value: GraphFilterValueOf<T, Key>,
    operand: GraphFilterOperandOf<T, Key>,
  ): boolean {
    const canonicalValue = resolveCanonicalValue(typeof value === "string" ? value : "");

    if (enumOperand.selection === "many") {
      const runtimeValues = Array.isArray(operand) ? operand : [];
      return baseOperator.test(
        canonicalValue as AuthoredFieldFilterValueOf<T, Key>,
        runtimeValues.map((item) => resolveCanonicalValue(item)) as AuthoredFieldFilterOperandOf<
          T,
          Key
        >,
      );
    }

    return baseOperator.test(
      canonicalValue as AuthoredFieldFilterValueOf<T, Key>,
      resolveCanonicalValue(
        typeof operand === "string" ? operand : "",
      ) as AuthoredFieldFilterOperandOf<T, Key>,
    );
  }

  return {
    key,
    label: baseOperator.label,
    operand: {
      ...enumOperand,
      editor,
      options: enumOptions,
    } as unknown as GraphFilterOperandResolution<T, Defs, Key>,
    parse: parseEnumOperand,
    format: formatEnumOperand,
    test: testEnumOperand,
  };
}

function resolveFilterField<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
  field: T,
  rangeType: Defs[keyof Defs] | undefined,
  operandEditorByKind: ReadonlyMap<string, AnyOperandEditorCapability>,
): GraphFieldFilterResolution<T, Defs> {
  if (!hasFieldFilter(field)) return { status: "unsupported", reason: "missing-filter" };

  const operators = Object.entries(field.filter.operators).map(([key, operator]) =>
    resolveOperator(
      field,
      rangeType,
      key as FieldFilterOperatorKey<T>,
      operator as FieldFilterOperatorOf<T, FieldFilterOperatorKey<T>>,
      operandEditorByKind,
    ),
  ) as readonly GraphFilterOperatorResolution<T, Defs, FieldFilterOperatorKey<T>>[];
  const operatorByKey = new Map(operators.map((operator) => [operator.key, operator]));

  return {
    status: "resolved",
    field,
    rangeType,
    defaultOperator: field.filter.defaultOperator as FieldFilterOperatorKey<T>,
    operators,
    resolveOperator<Key extends FieldFilterOperatorKey<T>>(
      key: Key,
    ): GraphFilterOperatorResolution<T, Defs, Key> | undefined {
      return operatorByKey.get(key) as GraphFilterOperatorResolution<T, Defs, Key> | undefined;
    },
  };
}

/**
 * Builds a host-neutral filter resolver from host-supplied operand editors.
 */
export function createGraphFilterResolver(input?: {
  operandEditors?: readonly AnyOperandEditorCapability[];
}): GraphFilterResolver {
  const operandEditorByKind = toCapabilityMap(input?.operandEditors ?? []);

  return {
    resolveField<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
      field: T,
      defs: Defs,
    ): GraphFieldFilterResolution<T, Defs> {
      const rangeType = resolveFieldRangeType(field, defs);
      return resolveFilterField(field, rangeType, operandEditorByKind);
    },
    resolvePredicate<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
      predicate: PredicateRef<T, Defs>,
    ): GraphFieldFilterResolution<T, Defs> {
      return resolveFilterField(
        predicate.field,
        predicate.rangeType as Defs[keyof Defs] | undefined,
        operandEditorByKind,
      );
    },
  };
}

export const defaultGraphFilterResolver = createGraphFilterResolver();

export function lowerGraphFilterClause<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
>(
  predicate: FilterablePredicateRef<T, Defs>,
  operator: GraphFilterOperatorResolution<T, Defs, Key>,
  operand: GraphFilterOperandOf<T, Key>,
): GraphRuntimeFilterClause<T, Key> {
  const base = {
    predicateId: predicate.predicateId,
    predicateKey: predicate.field.key,
    rangeKey: predicate.field.range,
    cardinality: predicate.field.cardinality,
    operatorKey: operator.key,
    operatorLabel: operator.label,
  };
  const formattedOperand = operator.format(operand);

  if (operator.operand.kind === "enum") {
    return {
      ...base,
      operand: {
        kind: "enum",
        selection: operator.operand.selection,
        value: formattedOperand,
      } as GraphRuntimeFilterOperand<T, Key>,
    };
  }

  return {
    ...base,
    operand: {
      kind: operator.operand.kind,
      value: formattedOperand,
    } as GraphRuntimeFilterOperand<T, Key>,
  };
}

export function lowerGraphFilterQuery(input: {
  clauses: readonly AnyActiveGraphFilterClause[];
  entityTypeKey: string;
}): GraphRuntimeFilterQuery {
  return {
    entityTypeKey: input.entityTypeKey,
    combinator: "and",
    clauses: input.clauses.map((clause) =>
      lowerGraphFilterClause(clause.predicate, clause.operator, clause.operand),
    ),
  };
}

export function compileGraphFilterQuery<Subject>(input: {
  clauses: readonly AnyActiveGraphFilterClause[];
  entityTypeKey: string;
  readValue: (subject: Subject, clause: AnyGraphRuntimeFilterClause) => unknown;
}): {
  matches(subject: Subject): boolean;
  query: GraphRuntimeFilterQuery;
} {
  const query = lowerGraphFilterQuery({
    clauses: input.clauses,
    entityTypeKey: input.entityTypeKey,
  });

  return {
    query,
    matches(subject) {
      return query.clauses.every((clause, index) => {
        const activeClause = input.clauses[index];
        if (!activeClause) return false;
        const value = input.readValue(subject, clause);
        if (value === undefined) return false;
        return activeClause.operator.test(value as never, activeClause.operand as never);
      });
    },
  };
}

function UnsupportedFilterOperand({
  kind,
  reason,
}: UnsupportedFilterOperandFallbackProps): ReactNode {
  return kind ? `${reason}:${kind}` : reason;
}

export function FilterOperandEditor<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
>({ fallback, operator, onChange, value }: FilterOperandEditorProps<T, Defs, Key>) {
  const resolution = operator.operand.editor;
  if (resolution.status === "unsupported") {
    const Fallback = fallback ?? UnsupportedFilterOperand;
    return <Fallback kind={resolution.kind} reason={resolution.reason} />;
  }

  const Component = resolution.capability.Component;
  return <Component operator={operator} onChange={onChange} value={value} />;
}
