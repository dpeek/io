import { isEnumType } from "../../../index.js";
import {
  getPredicateEnumOptions,
  performValidatedMutation,
  usePredicateField,
} from "../../../runtime/react/index.js";
import { OptionComboboxEditor } from "./option-combobox.js";
import {
  addPredicateItem,
  clearPredicateValue,
  getPredicateFieldLabel,
  removePredicateItem,
  setPredicateValue,
  useFieldMutationCallbacks,
  validatePredicateAdd,
  validatePredicateClear,
  validatePredicateRemove,
  validatePredicateValue,
  type AnyFieldProps,
} from "./shared.js";

export function EnumComboboxEditor({
  onMutationError,
  onMutationSuccess,
  predicate,
}: AnyFieldProps) {
  const callbacks = useFieldMutationCallbacks({ onMutationError, onMutationSuccess });
  const { value } = usePredicateField(predicate);
  const fieldLabel = getPredicateFieldLabel(predicate);
  const options = getPredicateEnumOptions(predicate).map((option) => ({
    id: option.id,
    keywords: [option.key],
    label: option.label,
    option,
  }));
  const optionById = new Map(options.map((option) => [option.id, option]));
  const selectedIds = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? [value]
      : [];
  const selected = selectedIds.flatMap((id) => optionById.get(id) ?? []);
  const isEnum = predicate.rangeType ? isEnumType(predicate.rangeType) : false;

  function commitSelection(nextValue: string): void {
    if (predicate.field.cardinality === "many") {
      if (selectedIds.includes(nextValue)) return;
      performValidatedMutation(
        callbacks,
        () => validatePredicateAdd(predicate, nextValue),
        () => addPredicateItem(predicate, nextValue),
      );
      return;
    }

    if (value === nextValue) return;
    performValidatedMutation(
      callbacks,
      () => validatePredicateValue(predicate, nextValue),
      () => setPredicateValue(predicate, nextValue),
    );
  }

  function commitRemove(nextValue: string): void {
    if (predicate.field.cardinality !== "many") return;
    performValidatedMutation(
      callbacks,
      () => validatePredicateRemove(predicate, nextValue),
      () => removePredicateItem(predicate, nextValue),
    );
  }

  function commitClear(): void {
    if (predicate.field.cardinality === "one") return;
    performValidatedMutation(
      callbacks,
      () => validatePredicateClear(predicate),
      () => clearPredicateValue(predicate),
    );
  }

  if (!isEnum) {
    return <span data-web-field-status="unsupported">unsupported-editor-kind:select</span>;
  }

  return (
    <OptionComboboxEditor
      cardinality={predicate.field.cardinality}
      fieldKind="option-combobox"
      fieldLabel={fieldLabel}
      onClear={commitClear}
      onRemove={commitRemove}
      onSelect={commitSelection}
      options={options}
      renderOption={(option) => option.label}
      selected={selected}
    />
  );
}
