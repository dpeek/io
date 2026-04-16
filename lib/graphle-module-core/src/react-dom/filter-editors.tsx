import type {
  FilterOperandProps,
  GraphFilterEnumOption,
  GraphFilterOperandEditorCapability,
} from "@dpeek/graphle-react";
import { Input } from "@dpeek/graphle-web-ui/input";
import { NativeSelect, NativeSelectOption } from "@dpeek/graphle-web-ui/native-select";
import { useEffect, useState } from "react";

type AnyOperandProps = FilterOperandProps<any, any, any>;

function TextFilterOperandEditor({ operator, onChange, value }: AnyOperandProps) {
  return (
    <Input
      data-web-filter-operand-kind="string"
      onChange={(event) => {
        const nextValue = event.target.value;
        if (nextValue === "") {
          onChange(undefined);
          return;
        }
        onChange(operator.parse(nextValue));
      }}
      placeholder={operator.operand.placeholder}
      type="text"
      value={typeof value === "string" ? operator.format(value) : ""}
    />
  );
}

function NumberFilterOperandEditor({ operator, onChange, value }: AnyOperandProps) {
  const committedValue = typeof value === "number" ? operator.format(value) : "";
  const [draft, setDraft] = useState(committedValue);
  const [isInvalid, setIsInvalid] = useState(false);

  useEffect(() => {
    setDraft(committedValue);
    setIsInvalid(false);
  }, [committedValue]);

  return (
    <Input
      aria-invalid={isInvalid || undefined}
      data-web-filter-operand-kind="number"
      inputMode={
        operator.operand.kind === "number" ? (operator.operand.inputMode ?? "numeric") : "numeric"
      }
      onChange={(event) => {
        const nextValue = event.target.value;
        setDraft(nextValue);

        if (nextValue === "") {
          setIsInvalid(false);
          onChange(undefined);
          return;
        }

        try {
          const parsed = operator.parse(nextValue);
          if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
            setIsInvalid(true);
            return;
          }
          setIsInvalid(false);
          onChange(parsed);
        } catch {
          setIsInvalid(true);
        }
      }}
      placeholder={operator.operand.placeholder}
      type="number"
      value={draft}
    />
  );
}

function DateFilterOperandEditor({ operator, onChange, value }: AnyOperandProps) {
  const committedValue = value instanceof Date ? operator.format(value) : "";
  const [draft, setDraft] = useState(committedValue);
  const [isInvalid, setIsInvalid] = useState(false);

  useEffect(() => {
    setDraft(committedValue);
    setIsInvalid(false);
  }, [committedValue]);

  return (
    <Input
      aria-invalid={isInvalid || undefined}
      data-web-filter-operand-kind="date"
      onChange={(event) => {
        const nextValue = event.target.value;
        setDraft(nextValue);

        if (nextValue === "") {
          setIsInvalid(false);
          onChange(undefined);
          return;
        }

        try {
          const parsed = operator.parse(nextValue);
          if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
            setIsInvalid(true);
            return;
          }
          setIsInvalid(false);
          onChange(parsed);
        } catch {
          setIsInvalid(true);
        }
      }}
      placeholder={operator.operand.placeholder}
      type="text"
      value={draft}
    />
  );
}

function UrlFilterOperandEditor({ operator, onChange, value }: AnyOperandProps) {
  const committedValue = value instanceof URL ? operator.format(value) : "";
  const [draft, setDraft] = useState(committedValue);
  const [isInvalid, setIsInvalid] = useState(false);

  useEffect(() => {
    setDraft(committedValue);
    setIsInvalid(false);
  }, [committedValue]);

  return (
    <Input
      aria-invalid={isInvalid || undefined}
      data-web-filter-operand-kind="url"
      onChange={(event) => {
        const nextValue = event.target.value;
        setDraft(nextValue);

        if (nextValue === "") {
          setIsInvalid(false);
          onChange(undefined);
          return;
        }

        try {
          const parsed = operator.parse(nextValue);
          if (!(parsed instanceof URL)) {
            setIsInvalid(true);
            return;
          }
          setIsInvalid(false);
          onChange(parsed);
        } catch {
          setIsInvalid(true);
        }
      }}
      placeholder={operator.operand.placeholder}
      type="url"
      value={draft}
    />
  );
}

function EnumFilterOperandEditor({ operator, onChange, value }: AnyOperandProps) {
  if (operator.operand.kind !== "enum") {
    return <span data-web-filter-status="unsupported">unsupported-operand-kind:enum</span>;
  }

  const isMany = operator.operand.selection === "many";
  const selectedValues = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? [value]
      : [];

  return (
    <NativeSelect
      className="w-full"
      data-web-filter-operand-kind="enum"
      data-web-filter-selection={operator.operand.selection}
      multiple={isMany}
      onChange={(event) => {
        if (isMany) {
          const nextValues = Array.from(
            event.target.selectedOptions,
            (option: { value: string }) => option.value,
          );
          if (nextValues.length === 0) {
            onChange(undefined);
            return;
          }
          onChange(operator.parse(nextValues.join(",")));
          return;
        }

        const nextValue = event.target.value;
        if (nextValue === "") {
          onChange(undefined);
          return;
        }
        onChange(operator.parse(nextValue));
      }}
      value={isMany ? selectedValues : (selectedValues[0] ?? "")}
    >
      {!isMany ? <NativeSelectOption value="">Select an option</NativeSelectOption> : null}
      {operator.operand.options.map((option: GraphFilterEnumOption) => (
        <NativeSelectOption key={option.value} value={option.value}>
          {option.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

function BooleanFilterOperandEditor({ operator, onChange, value }: AnyOperandProps) {
  return (
    <NativeSelect
      className="w-full"
      data-web-filter-operand-kind="boolean"
      onChange={(event) => {
        const nextValue = event.target.value;
        if (nextValue === "") {
          onChange(undefined);
          return;
        }
        onChange(operator.parse(nextValue));
      }}
      value={typeof value === "boolean" ? String(value) : ""}
    >
      <NativeSelectOption value="">Select a value</NativeSelectOption>
      <NativeSelectOption value="true">True</NativeSelectOption>
      <NativeSelectOption value="false">False</NativeSelectOption>
    </NativeSelect>
  );
}

/** Built-in browser operand editors for the core-owned DOM filter layer. */
export const genericWebFilterOperandEditorCapabilities = [
  { kind: "string", Component: TextFilterOperandEditor },
  { kind: "date", Component: DateFilterOperandEditor },
  { kind: "number", Component: NumberFilterOperandEditor },
  { kind: "url", Component: UrlFilterOperandEditor },
  { kind: "enum", Component: EnumFilterOperandEditor },
  { kind: "boolean", Component: BooleanFilterOperandEditor },
] satisfies readonly GraphFilterOperandEditorCapability<any, any, any>[];
