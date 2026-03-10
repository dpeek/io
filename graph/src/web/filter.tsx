import type { ComponentType, ReactNode } from "react";

import type { PredicateRef } from "../graph/client.js";
import { isEnumType, type AnyTypeOutput, type EdgeOutput, type ResolvedAnyTypeOutput, typeId } from "../graph/schema.js";
import type { TypeFilterOperator } from "../graph/type-module.js";
import { genericWebFilterOperandEditorCapabilities } from "./generic-filter-editors.js";

type FieldFilterContract = {
  defaultOperator: string;
  operators: Record<string, TypeFilterOperator<any, any, any>>;
};

type EnumTypeLike = Extract<AnyTypeOutput | ResolvedAnyTypeOutput, { kind: "enum" }>;

export type FieldFilterOf<T extends EdgeOutput> = T extends { filter: infer Filter extends FieldFilterContract }
  ? Filter
  : never;
export type FieldFilterOperatorKey<T extends EdgeOutput> = FieldFilterOf<T> extends FieldFilterContract
  ? Extract<keyof FieldFilterOf<T>["operators"], string>
  : never;
type FieldFilterOperatorOf<
  T extends EdgeOutput,
  Key extends FieldFilterOperatorKey<T>,
> = FieldFilterOf<T> extends FieldFilterContract ? FieldFilterOf<T>["operators"][Key] : never;
type AuthoredFieldFilterValueOf<
  T extends EdgeOutput,
  Key extends FieldFilterOperatorKey<T>,
> = FieldFilterOperatorOf<T, Key> extends TypeFilterOperator<infer Value, any, any> ? Value : never;
type AuthoredFieldFilterOperandOf<
  T extends EdgeOutput,
  Key extends FieldFilterOperatorKey<T>,
> = FieldFilterOperatorOf<T, Key> extends TypeFilterOperator<any, infer Operand, any> ? Operand : never;
type FieldFilterOperandShapeOf<
  T extends EdgeOutput,
  Key extends FieldFilterOperatorKey<T>,
> = FieldFilterOperatorOf<T, Key> extends TypeFilterOperator<any, any, infer OperandShape>
  ? OperandShape
  : never;

export type WebFilterOperandOf<
  T extends EdgeOutput,
  Key extends FieldFilterOperatorKey<T>,
> = FieldFilterOperandShapeOf<T, Key> extends { kind: "enum"; selection: "many" }
  ? string[]
  : FieldFilterOperandShapeOf<T, Key> extends { kind: "enum" }
    ? string
    : AuthoredFieldFilterOperandOf<T, Key>;

export type WebFilterValueOf<
  T extends EdgeOutput,
  Key extends FieldFilterOperatorKey<T>,
> = FieldFilterOperandShapeOf<T, Key> extends { kind: "enum" } ? string : AuthoredFieldFilterValueOf<T, Key>;

type FilterablePredicateRef<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>> = Pick<
  PredicateRef<T, Defs>,
  "field" | "predicateId"
>;

export type WebFilterEnumOption = {
  value: string;
  key: string;
  label: string;
};

export type FilterOperandProps<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
> = {
  operator: WebFilterOperatorResolution<T, Defs, Key>;
  value: WebFilterOperandOf<T, Key> | undefined;
  onChange: (value: WebFilterOperandOf<T, Key> | undefined) => void;
};

export type WebFilterOperandEditorCapability<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
> = {
  kind: FieldFilterOperandShapeOf<T, Key>["kind"];
  Component: ComponentType<FilterOperandProps<T, Defs, Key>>;
};

type AnyOperandEditorCapability = WebFilterOperandEditorCapability<any, any, any>;

export type UnsupportedFieldFilterReason = "missing-filter";
export type UnsupportedFilterOperandReason = "missing-enum-type" | "unsupported-operand-kind";

export type WebFilterOperandEditorResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
> =
  | {
      status: "resolved";
      capability: WebFilterOperandEditorCapability<T, Defs, Key>;
    }
  | {
      status: "unsupported";
      reason: UnsupportedFilterOperandReason;
      kind?: string;
    };

export type WebFilterOperandResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
> = FieldFilterOperandShapeOf<T, Key> & {
  editor: WebFilterOperandEditorResolution<T, Defs, Key>;
} & (FieldFilterOperandShapeOf<T, Key> extends { kind: "enum" }
    ? { options: readonly WebFilterEnumOption[] }
    : {});

export type WebFilterOperatorResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
> = {
  key: Key;
  label: string;
  operand: WebFilterOperandResolution<T, Defs, Key>;
  parse: (raw: string) => WebFilterOperandOf<T, Key>;
  format: (operand: WebFilterOperandOf<T, Key>) => string;
  test: (value: WebFilterValueOf<T, Key>, operand: WebFilterOperandOf<T, Key>) => boolean;
};

export type WebRuntimeFilterOperand<
  T extends EdgeOutput,
  Key extends FieldFilterOperatorKey<T>,
> = FieldFilterOperandShapeOf<T, Key> extends { kind: "enum"; selection: infer Selection extends "one" | "many" }
  ? {
      kind: "enum";
      selection: Selection;
      value: string;
    }
  : {
      kind: FieldFilterOperandShapeOf<T, Key>["kind"];
      value: string;
    };

export type WebRuntimeFilterClause<
  T extends EdgeOutput,
  Key extends FieldFilterOperatorKey<T>,
> = {
  predicateId: string;
  predicateKey: T["key"];
  rangeKey: T["range"];
  cardinality: T["cardinality"];
  operatorKey: Key;
  operatorLabel: string;
  operand: WebRuntimeFilterOperand<T, Key>;
};

export type WebFieldFilterResolution<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
> =
  | {
      status: "resolved";
      field: T;
      rangeType: Defs[keyof Defs] | undefined;
      defaultOperator: FieldFilterOperatorKey<T>;
      operators: readonly WebFilterOperatorResolution<T, Defs, FieldFilterOperatorKey<T>>[];
      resolveOperator<Key extends FieldFilterOperatorKey<T>>(
        key: Key,
      ): WebFilterOperatorResolution<T, Defs, Key> | undefined;
    }
  | {
      status: "unsupported";
      reason: UnsupportedFieldFilterReason;
    };

export type WebFilterResolver = {
  resolveField<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
    field: T,
    defs: Defs,
  ): WebFieldFilterResolution<T, Defs>;
  resolvePredicate<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
    predicate: PredicateRef<T, Defs>,
  ): WebFieldFilterResolution<T, Defs>;
};

export type ActiveWebFilterClause<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
> = {
  operand: WebFilterOperandOf<T, Key>;
  operator: WebFilterOperatorResolution<T, Defs, Key>;
  predicate: FilterablePredicateRef<T, Defs>;
};

type AnyActiveWebFilterClause = ActiveWebFilterClause<any, any, any>;
type AnyWebRuntimeFilterClause = WebRuntimeFilterClause<any, any>;

export type WebRuntimeFilterQuery = {
  clauses: readonly AnyWebRuntimeFilterClause[];
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

function hasFieldFilter<T extends EdgeOutput>(field: T): field is T & { filter: FieldFilterContract } {
  const candidate = field as T & { filter?: FieldFilterContract };
  return (
    typeof candidate.filter?.defaultOperator === "string" &&
    !!candidate.filter?.operators &&
    typeof candidate.filter.operators === "object"
  );
}

function toCapabilityMap<T extends { kind: string }>(capabilities: readonly T[]): ReadonlyMap<string, T> {
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
  const meta = (field as EdgeOutput & {
    meta?: {
      display?: {
        format?: (value: unknown) => string;
      };
    };
  }).meta;
  return meta?.display?.format;
}

function formatEnumOptionLabel(field: EdgeOutput, option: { key: string; name?: string }): string {
  const formatter = getFieldDisplayFormatter(field);
  if (formatter) return formatter(option.key);
  return option.name ?? option.key;
}

function resolveEnumOptions(field: EdgeOutput, rangeType: EnumTypeLike | undefined): readonly WebFilterEnumOption[] {
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
): WebFilterOperandEditorResolution<T, Defs, Key> {
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
    capability: capability as WebFilterOperandEditorCapability<T, Defs, Key>,
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
): WebFilterOperatorResolution<T, Defs, Key> {
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
      } as WebFilterOperandResolution<T, Defs, Key>,
      parse: baseOperator.parse as (raw: string) => WebFilterOperandOf<T, Key>,
      format: baseOperator.format as (operand: WebFilterOperandOf<T, Key>) => string,
      test: baseOperator.test as (
        value: WebFilterValueOf<T, Key>,
        operand: WebFilterOperandOf<T, Key>,
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

  function parseEnumOperand(raw: string): WebFilterOperandOf<T, Key> {
    if (enumOperand.selection === "many") {
      const canonicalRaw = raw
        .split(",")
        .map((value) => resolveCanonicalValue(value.trim()))
        .join(",");
      const parsed = baseOperator.parse(canonicalRaw) as string[];
      return parsed.map((value) => resolveRuntimeValue(value)) as WebFilterOperandOf<T, Key>;
    }

    const parsed = baseOperator.parse(resolveCanonicalValue(raw.trim())) as string;
    return resolveRuntimeValue(parsed) as WebFilterOperandOf<T, Key>;
  }

  function formatEnumOperand(operand: WebFilterOperandOf<T, Key>): string {
    if (enumOperand.selection === "many") {
      const runtimeValues = Array.isArray(operand) ? operand : [];
      const canonicalOperand = runtimeValues.map((value) => resolveCanonicalValue(value));
      baseOperator.format(canonicalOperand as AuthoredFieldFilterOperandOf<T, Key>);
      return runtimeValues.join(",");
    }

    const runtimeValue = typeof operand === "string" ? operand : "";
    baseOperator.format(resolveCanonicalValue(runtimeValue) as AuthoredFieldFilterOperandOf<T, Key>);
    return runtimeValue;
  }

  function testEnumOperand(value: WebFilterValueOf<T, Key>, operand: WebFilterOperandOf<T, Key>): boolean {
    const canonicalValue = resolveCanonicalValue(typeof value === "string" ? value : "");

    if (enumOperand.selection === "many") {
      const runtimeValues = Array.isArray(operand) ? operand : [];
      return baseOperator.test(
        canonicalValue as AuthoredFieldFilterValueOf<T, Key>,
        runtimeValues.map((item) => resolveCanonicalValue(item)) as AuthoredFieldFilterOperandOf<T, Key>,
      );
    }

    return baseOperator.test(
      canonicalValue as AuthoredFieldFilterValueOf<T, Key>,
      resolveCanonicalValue(typeof operand === "string" ? operand : "") as AuthoredFieldFilterOperandOf<T, Key>,
    );
  }

  return {
    key,
    label: baseOperator.label,
    operand: {
      ...enumOperand,
      editor,
      options: enumOptions,
    } as unknown as WebFilterOperandResolution<T, Defs, Key>,
    parse: parseEnumOperand,
    format: formatEnumOperand,
    test: testEnumOperand,
  };
}

function resolveFilterField<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
>(
  field: T,
  rangeType: Defs[keyof Defs] | undefined,
  operandEditorByKind: ReadonlyMap<string, AnyOperandEditorCapability>,
): WebFieldFilterResolution<T, Defs> {
  if (!hasFieldFilter(field)) return { status: "unsupported", reason: "missing-filter" };

  const operators = Object.entries(field.filter.operators).map(([key, operator]) =>
    resolveOperator(
      field,
      rangeType,
      key as FieldFilterOperatorKey<T>,
      operator as FieldFilterOperatorOf<T, FieldFilterOperatorKey<T>>,
      operandEditorByKind,
    ),
  ) as readonly WebFilterOperatorResolution<T, Defs, FieldFilterOperatorKey<T>>[];
  const operatorByKey = new Map(operators.map((operator) => [operator.key, operator]));

  return {
    status: "resolved",
    field,
    rangeType,
    defaultOperator: field.filter.defaultOperator as FieldFilterOperatorKey<T>,
    operators,
    resolveOperator<Key extends FieldFilterOperatorKey<T>>(
      key: Key,
    ): WebFilterOperatorResolution<T, Defs, Key> | undefined {
      return operatorByKey.get(key) as WebFilterOperatorResolution<T, Defs, Key> | undefined;
    },
  };
}

export function createWebFilterResolver(input?: {
  operandEditors?: readonly AnyOperandEditorCapability[];
}): WebFilterResolver {
  const operandEditorByKind = toCapabilityMap(input?.operandEditors ?? []);

  return {
    resolveField<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
      field: T,
      defs: Defs,
    ): WebFieldFilterResolution<T, Defs> {
      const rangeType = resolveFieldRangeType(field, defs);
      return resolveFilterField(field, rangeType, operandEditorByKind);
    },
    resolvePredicate<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
      predicate: PredicateRef<T, Defs>,
    ): WebFieldFilterResolution<T, Defs> {
      return resolveFilterField(
        predicate.field,
        predicate.rangeType as Defs[keyof Defs] | undefined,
        operandEditorByKind,
      );
    },
  };
}

export const defaultWebFilterResolver = createWebFilterResolver({
  operandEditors: genericWebFilterOperandEditorCapabilities,
});

export function lowerWebFilterClause<
  T extends EdgeOutput,
  Defs extends Record<string, AnyTypeOutput>,
  Key extends FieldFilterOperatorKey<T>,
>(
  predicate: FilterablePredicateRef<T, Defs>,
  operator: WebFilterOperatorResolution<T, Defs, Key>,
  operand: WebFilterOperandOf<T, Key>,
): WebRuntimeFilterClause<T, Key> {
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
      } as WebRuntimeFilterOperand<T, Key>,
    };
  }

  return {
    ...base,
    operand: {
      kind: operator.operand.kind,
      value: formattedOperand,
    } as WebRuntimeFilterOperand<T, Key>,
  };
}

export function lowerWebFilterQuery(input: {
  clauses: readonly AnyActiveWebFilterClause[];
  entityTypeKey: string;
}): WebRuntimeFilterQuery {
  return {
    entityTypeKey: input.entityTypeKey,
    combinator: "and",
    clauses: input.clauses.map((clause) =>
      lowerWebFilterClause(clause.predicate, clause.operator, clause.operand),
    ),
  };
}

export function compileWebFilterQuery<Subject>(input: {
  clauses: readonly AnyActiveWebFilterClause[];
  entityTypeKey: string;
  readValue: (subject: Subject, clause: AnyWebRuntimeFilterClause) => unknown;
}): {
  matches(subject: Subject): boolean;
  query: WebRuntimeFilterQuery;
} {
  const query = lowerWebFilterQuery({
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
  return (
    <span data-web-filter-status="unsupported">
      {kind ? `${reason}:${kind}` : reason}
    </span>
  );
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
