import { defineScalar } from "../graph/schema.js";
import {
  defineScalarModule,
  type EditorInputMode,
  type TypeModuleFilter,
  type TypeModuleMeta,
} from "../graph/type-module.js";

type ValidatedStringModuleInput<
  Key extends string,
  Filter extends TypeModuleFilter<string, any>,
> = {
  values: {
    key: Key;
    name: string;
  };
  parse: (raw: string) => string;
  filter: Filter;
  placeholder?: string;
  searchable?: boolean;
  inputType?: string;
  inputMode?: EditorInputMode;
  autocomplete?: string;
};

export function defineValidatedStringTypeModule<
  const Key extends string,
  const Filter extends TypeModuleFilter<string, any>,
>(input: ValidatedStringModuleInput<Key, Filter>) {
  const formatValue = (value: string) => value;

  const type = defineScalar({
    values: input.values,
    encode: input.parse,
    decode: input.parse,
  });

  const meta = {
    searchable: input.searchable ?? true,
    summary: {
      kind: "value",
      format: formatValue,
    },
    display: {
      kind: "text",
      allowed: ["text"] as const,
      format: formatValue,
    },
    editor: {
      kind: "text",
      allowed: ["text"] as const,
      ...(input.placeholder ? { placeholder: input.placeholder } : {}),
      ...(input.inputType ? { inputType: input.inputType } : {}),
      ...(input.inputMode ? { inputMode: input.inputMode } : {}),
      ...(input.autocomplete ? { autocomplete: input.autocomplete } : {}),
      parse: input.parse,
      format: formatValue,
    },
  } satisfies TypeModuleMeta<string, readonly ["text"], readonly ["text"]>;

  return defineScalarModule({
    type,
    meta,
    filter: input.filter,
  });
}
