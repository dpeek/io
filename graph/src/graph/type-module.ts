import type { Cardinality, EdgeInput, EnumTypeOutput, ScalarTypeOutput } from "./schema";

type EnumOptionLike = { key: string; id?: string };
type EnumTypeLike = { options: Record<string, EnumOptionLike> };
type EnumOptionIdentity<Option extends EnumOptionLike> = Option extends { id: infer Id extends string }
  ? Id
  : Option["key"];
type MetaDecoded<Meta extends TypeModuleMeta<any, any, any>> = Meta extends TypeModuleMeta<
  infer Decoded,
  any,
  any
>
  ? Decoded
  : never;
type MetaDisplayKinds<Meta extends TypeModuleMeta<any, any, any>> = Meta extends TypeModuleMeta<
  any,
  infer DisplayKinds,
  any
>
  ? DisplayKinds
  : readonly string[];
type MetaEditorKinds<Meta extends TypeModuleMeta<any, any, any>> = Meta extends TypeModuleMeta<
  any,
  any,
  infer EditorKinds
>
  ? EditorKinds
  : readonly string[];
type FilterKey<Filter extends { operators: Record<string, unknown> }> = Extract<
  keyof Filter["operators"],
  string
>;
type NormalizedMeta<Meta extends TypeModuleMeta<any, any, any>> = Omit<
  TypeModuleMeta<MetaDecoded<Meta>, MetaDisplayKinds<Meta>, MetaEditorKinds<Meta>>,
  "display" | "editor"
> & {
  display: Omit<
    TypeModuleMeta<MetaDecoded<Meta>, MetaDisplayKinds<Meta>, MetaEditorKinds<Meta>>["display"],
    "kind"
  > & { kind: MetaDisplayKinds<Meta>[number] };
  editor: Omit<
    TypeModuleMeta<MetaDecoded<Meta>, MetaDisplayKinds<Meta>, MetaEditorKinds<Meta>>["editor"],
    "kind"
  > & { kind: MetaEditorKinds<Meta>[number] };
};
type NormalizedFilter<Filter extends { operators: Record<string, unknown> }> = {
  defaultOperator: FilterKey<Filter>;
  operators: Filter["operators"];
};
type FieldFilterOperators<
  Filter extends { operators: Record<string, unknown> },
  Allowed extends readonly FilterKey<Filter>[] | undefined,
> = Allowed extends readonly FilterKey<Filter>[] ? Pick<Filter["operators"], Allowed[number]> : Filter["operators"];

export type TypeModuleMeta<
  Decoded,
  DisplayKinds extends readonly string[] = readonly string[],
  EditorKinds extends readonly string[] = readonly string[],
> = {
  label?: string;
  description?: string;
  group?: string;
  priority?: number;
  searchable?: boolean;
  collection?: {
    kind: "ordered" | "unordered";
  };
  summary?: {
    kind: "value" | "count";
    format?: (value: Decoded) => string;
  };
  display: {
    kind: DisplayKinds[number];
    allowed: DisplayKinds;
    format?: (value: Decoded) => string;
  };
  editor: {
    kind: EditorKinds[number];
    allowed: EditorKinds;
    placeholder?: string;
    multiline?: boolean;
  };
};

type TypeFilterEnumOperand<Operand> = unknown extends Operand
  ? {
      kind: "enum";
      placeholder?: string;
      selection: "one" | "many";
    }
  : Operand extends readonly unknown[]
    ? {
        kind: "enum";
        placeholder?: string;
        selection: "many";
      }
    : {
        kind: "enum";
        placeholder?: string;
        selection: "one";
      };

export type TypeFilterOperand<Operand> =
  | {
      kind: "string";
      placeholder?: string;
    }
  | {
      kind: "number";
      placeholder?: string;
      inputMode?: "decimal" | "numeric";
    }
  | {
      kind: "url";
      placeholder?: string;
    }
  | {
      kind: "boolean";
    }
  | TypeFilterEnumOperand<Operand>;

export type TypeFilterOperator<
  Decoded,
  Operand,
  OperandShape extends TypeFilterOperand<Operand> = TypeFilterOperand<Operand>,
> = {
  label: string;
  operand: OperandShape;
  parse: (raw: string) => Operand;
  format: (operand: Operand) => string;
  test: (value: Decoded, operand: Operand) => boolean;
};

export type TypeModuleFilter<
  Decoded,
  Operators extends Record<string, TypeFilterOperator<Decoded, any>> = Record<
    string,
    TypeFilterOperator<Decoded, any>
  >,
> = {
  defaultOperator: Extract<keyof Operators, string>;
  operators: Operators;
};

export type ScalarModuleValue<Type extends ScalarTypeOutput<any, any>> = Type extends ScalarTypeOutput<
  infer Decoded,
  any
>
  ? Decoded
  : never;
export type EnumModuleValue<Type extends EnumTypeLike> = EnumOptionIdentity<
  Type["options"][keyof Type["options"]]
>;
export type TypeModuleValue<Type extends ScalarTypeOutput<any, any> | EnumTypeLike> =
  Type extends ScalarTypeOutput<any, any>
    ? ScalarModuleValue<Type>
    : Type extends EnumTypeLike
      ? EnumModuleValue<Type>
      : never;

export type FieldMetaOverride<Meta extends TypeModuleMeta<any, any, any>> = Omit<
  Partial<Meta>,
  "display" | "editor"
> & {
  display?: Omit<Partial<Meta["display"]>, "allowed" | "kind"> & {
    kind?: Meta["display"]["allowed"][number];
  };
  editor?: Omit<Partial<Meta["editor"]>, "allowed" | "kind"> & {
    kind?: Meta["editor"]["allowed"][number];
  };
};

export type FieldFilterOverride<
  Filter extends { operators: Record<string, unknown>; defaultOperator: string },
  Allowed extends readonly FilterKey<Filter>[] | undefined = undefined,
> = {
  operators?: Allowed;
  defaultOperator?: Allowed extends readonly FilterKey<Filter>[] ? Allowed[number] : FilterKey<Filter>;
};

export type TypeModuleFieldInput<
  Type extends ScalarTypeOutput<any, any> | EnumTypeOutput<any, any>,
  Meta extends TypeModuleMeta<any, any, any>,
  Filter extends { operators: Record<string, unknown>; defaultOperator: string },
  Card extends Cardinality,
  Allowed extends readonly FilterKey<Filter>[] | undefined = undefined,
> = EdgeInput<
  Type,
  {
    meta: NormalizedMeta<Meta>;
    filter: {
      defaultOperator: Allowed extends readonly FilterKey<Filter>[] ? Allowed[number] : FilterKey<Filter>;
      operators: FieldFilterOperators<Filter, Allowed>;
    };
  }
> & { cardinality: Card };

type TypeModuleShape<
  Type extends ScalarTypeOutput<any, any> | EnumTypeOutput<any, any>,
  Meta extends TypeModuleMeta<any, any, any>,
  Filter extends TypeModuleFilter<any, any>,
> = {
  type: Type;
  meta: NormalizedMeta<Meta>;
  filter: NormalizedFilter<Filter>;
  field<
    Card extends Cardinality,
    Allowed extends readonly FilterKey<NormalizedFilter<Filter>>[] | undefined = undefined,
  >(
    input: TypeModuleFieldConfig<Meta, Filter, Type, Card, Allowed>,
  ): TypeModuleFieldInput<Type, NormalizedMeta<Meta>, NormalizedFilter<Filter>, Card, Allowed>;
};

type TypeModuleFieldConfig<
  Meta extends TypeModuleMeta<any, any, any>,
  Filter extends TypeModuleFilter<any, any>,
  Type extends ScalarTypeOutput<any, any> | EnumTypeOutput<any, any>,
  Card extends Cardinality,
  Allowed extends readonly FilterKey<NormalizedFilter<Filter>>[] | undefined = undefined,
> = Omit<EdgeInput<Type>, "cardinality" | "range"> & {
  cardinality: Card;
  meta?: FieldMetaOverride<NormalizedMeta<Meta>>;
  filter?: FieldFilterOverride<NormalizedFilter<Filter>, Allowed>;
};

function composeMeta<Meta extends TypeModuleMeta<any, any, any>>(
  defaults: NormalizedMeta<Meta>,
  override?: FieldMetaOverride<NormalizedMeta<Meta>>,
): NormalizedMeta<Meta> {
  if (!override) return defaults;
  return {
    ...defaults,
    ...override,
    display: {
      ...defaults.display,
      ...override.display,
    },
    editor: {
      ...defaults.editor,
      ...override.editor,
    },
  };
}

function composeFilter<
  Filter extends { operators: Record<string, unknown>; defaultOperator: string },
  Allowed extends readonly FilterKey<Filter>[] | undefined = undefined,
>(
  defaults: NormalizedFilter<Filter>,
  override?: FieldFilterOverride<NormalizedFilter<Filter>, Allowed>,
): {
  defaultOperator: Allowed extends readonly FilterKey<Filter>[] ? Allowed[number] : FilterKey<Filter>;
  operators: FieldFilterOperators<Filter, Allowed>;
} {
  if (!override?.operators?.length) {
    return {
      defaultOperator: (override?.defaultOperator ?? defaults.defaultOperator) as Allowed extends readonly FilterKey<
        Filter
      >[]
        ? Allowed[number]
        : FilterKey<Filter>,
      operators: defaults.operators as FieldFilterOperators<Filter, Allowed>,
    };
  }

  const operators = Object.fromEntries(
    override.operators.map((key) => [key, defaults.operators[key]]),
  ) as FieldFilterOperators<Filter, Allowed>;
  const defaultOperator =
    override.defaultOperator ??
    (override.operators.includes(defaults.defaultOperator as FilterKey<Filter>)
      ? defaults.defaultOperator
      : override.operators[0]);

  if (!defaultOperator) {
    throw new Error("Field filter overrides must include at least one operator");
  }

  return {
    defaultOperator: defaultOperator as Allowed extends readonly FilterKey<Filter>[] ? Allowed[number] : FilterKey<Filter>,
    operators,
  };
}

function createTypeModule<
  Type extends ScalarTypeOutput<any, any> | EnumTypeOutput<any, any>,
  Meta extends TypeModuleMeta<any, any, any>,
  Filter extends TypeModuleFilter<any, any>,
>(input: {
  type: Type;
  meta: Meta;
  filter: Filter;
}): TypeModuleShape<Type, Meta, Filter> {
  const moduleMeta = input.meta as NormalizedMeta<Meta>;
  const moduleFilter = input.filter as unknown as NormalizedFilter<Filter>;

  return {
    type: input.type,
    meta: moduleMeta,
    filter: moduleFilter,
    field<Card extends Cardinality, Allowed extends readonly FilterKey<NormalizedFilter<Filter>>[] | undefined = undefined>({
      cardinality,
      filter,
      key,
      meta,
      onCreate,
      onUpdate,
    }: TypeModuleFieldConfig<Meta, Filter, Type, Card, Allowed>) {
      return {
        ...(key ? { key } : {}),
        range: input.type,
        cardinality,
        ...(onCreate ? { onCreate } : {}),
        ...(onUpdate ? { onUpdate } : {}),
        meta: composeMeta(moduleMeta, meta),
        filter: composeFilter(moduleFilter, filter),
      } as unknown as TypeModuleFieldInput<
        Type,
        NormalizedMeta<Meta>,
        NormalizedFilter<Filter>,
        Card,
        Allowed
      >;
    },
  };
}

export function defineScalarModule<
  const Type extends ScalarTypeOutput<any, any>,
  const Meta extends TypeModuleMeta<ScalarModuleValue<Type>, any, any>,
  const Filter extends TypeModuleFilter<ScalarModuleValue<Type>, any>,
>(input: {
  type: Type;
  meta: Meta;
  filter: Filter;
}): TypeModuleShape<Type, Meta, Filter> {
  return createTypeModule(input);
}

export function defineEnumModule<
  const Type extends EnumTypeOutput<any, any>,
  const Meta extends TypeModuleMeta<EnumModuleValue<Type>, any, any>,
  const Filter extends TypeModuleFilter<EnumModuleValue<Type>, any>,
>(input: {
  type: Type;
  meta: Meta;
  filter: Filter;
}): TypeModuleShape<Type, Meta, Filter> {
  return createTypeModule(input);
}
