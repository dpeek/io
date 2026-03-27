import type { EnumTypeOutput } from "@io/graph-kernel";

import {
  defineEnumModule,
  type EnumModuleValue,
  type TypeModuleFilter,
  type TypeModuleMeta,
} from "./type.js";

type DefaultEnumModuleValue<Type extends EnumTypeOutput<any, any>> = EnumModuleValue<Type>;

function formatEnumValue<Type extends EnumTypeOutput<any, any>>(
  type: Type,
  value: DefaultEnumModuleValue<Type>,
): string {
  const option = Object.values(type.options).find((candidate) => candidate.key === value) as
    | { key: DefaultEnumModuleValue<Type>; name?: string }
    | undefined;
  return option?.name ?? value;
}

function createEnumValueParser<Type extends EnumTypeOutput<any, any>>(
  type: Type,
): (raw: string) => DefaultEnumModuleValue<Type> {
  const validValues = new Set<DefaultEnumModuleValue<Type>>(
    Object.values(type.options).map((option) => option.key as DefaultEnumModuleValue<Type>),
  );

  return (raw: string) => {
    if (!validValues.has(raw as DefaultEnumModuleValue<Type>)) {
      throw new Error(`Invalid enum value "${raw}"`);
    }
    return raw as DefaultEnumModuleValue<Type>;
  };
}

/**
 * Builds the default type-module metadata and filter contract for an enum
 * definition.
 */
export function defineDefaultEnumTypeModule<const Type extends EnumTypeOutput<any, any>>(
  type: Type,
) {
  const formatValue = (value: DefaultEnumModuleValue<Type>) => formatEnumValue(type, value);
  const parseValue = createEnumValueParser(type);

  const meta = {
    searchable: true,
    summary: {
      kind: "value",
      format: formatValue,
    },
    display: {
      kind: "text",
      allowed: ["text", "badge"] as const,
      format: formatValue,
    },
    editor: {
      kind: "select",
      allowed: ["select", "segmented-control"] as const,
    },
  } satisfies TypeModuleMeta<
    DefaultEnumModuleValue<Type>,
    readonly ["text", "badge"],
    readonly ["select", "segmented-control"]
  >;

  const filter = {
    defaultOperator: "is",
    operators: {
      is: {
        label: "Is",
        operand: {
          kind: "enum",
          selection: "one",
        },
        parse: parseValue,
        format: (operand: DefaultEnumModuleValue<Type>) => operand,
        test: (value: DefaultEnumModuleValue<Type>, operand: DefaultEnumModuleValue<Type>) =>
          value === operand,
      },
      oneOf: {
        label: "Is one of",
        operand: {
          kind: "enum",
          selection: "many",
        },
        parse: (raw: string) => raw.split(",").map((value) => parseValue(value.trim())),
        format: (operand: DefaultEnumModuleValue<Type>[]) => operand.join(","),
        test: (value: DefaultEnumModuleValue<Type>, operand: DefaultEnumModuleValue<Type>[]) =>
          operand.includes(value),
      },
    },
  } satisfies TypeModuleFilter<DefaultEnumModuleValue<Type>>;

  return defineEnumModule({
    type,
    meta,
    filter,
  });
}
