import { performValidatedMutation, usePredicateField } from "@io/graph-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@io/web/select";

import { getDefinitionDisplayLabel } from "./helpers.js";
import type { MutableOptionalPredicateRef, TypeCatalogEntry } from "./model.js";

const unsetSelectValue = "__io_unset_select_value__";

export function PredicateRangeEditor({
  onMutationError,
  onMutationSuccess,
  options,
  predicate,
}: {
  onMutationError?: (error: unknown) => void;
  onMutationSuccess?: () => void;
  options: readonly TypeCatalogEntry[];
  predicate: MutableOptionalPredicateRef;
}) {
  const { value } = usePredicateField(predicate);
  const selectedId = typeof value === "string" ? value : "";
  const knownOptionIds = new Set(options.map((option) => option.id));

  function handleValueChange(nextValue: string): void {
    if (nextValue === unsetSelectValue) {
      performValidatedMutation(
        { onMutationError, onMutationSuccess },
        () => predicate.validateClear(),
        () => {
          predicate.clear();
          return true;
        },
      );
      return;
    }
    performValidatedMutation(
      { onMutationError, onMutationSuccess },
      () => predicate.validateSet(nextValue),
      () => {
        predicate.set(nextValue);
        return true;
      },
    );
  }

  return (
    <>
      <Select
        items={[
          { label: "Unset range", value: unsetSelectValue },
          ...(!knownOptionIds.has(selectedId) && selectedId.length > 0
            ? [{ label: "Unrecognized range", value: selectedId }]
            : []),
          ...options.map((option) => ({
            label: getDefinitionDisplayLabel(option.name, option.key),
            value: option.id,
          })),
        ]}
        onValueChange={(nextValue) => {
          if (typeof nextValue !== "string") {
            handleValueChange(unsetSelectValue);
            return;
          }
          handleValueChange(nextValue);
        }}
        value={selectedId.length > 0 ? selectedId : null}
      >
        <SelectTrigger
          aria-label="Predicate range"
          className="h-10 w-full justify-between"
          data-explorer-range-editor={predicate.subjectId}
        >
          <SelectValue placeholder="Unset range" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={unsetSelectValue}>Unset range</SelectItem>
          {!knownOptionIds.has(selectedId) && selectedId.length > 0 ? (
            <SelectItem data-web-select-item-value={selectedId} value={selectedId}>
              Unrecognized range
            </SelectItem>
          ) : null}
          {options.map((option) => (
            <SelectItem data-web-select-item-value={option.id} key={option.id} value={option.id}>
              {getDefinitionDisplayLabel(option.name, option.key)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <select
        aria-hidden="true"
        className="sr-only"
        data-explorer-range-editor={predicate.subjectId}
        onChange={(event) => {
          handleValueChange(event.target.value);
        }}
        tabIndex={-1}
        value={selectedId}
      >
        <option value={unsetSelectValue}>Unset range</option>
        {!knownOptionIds.has(selectedId) && selectedId.length > 0 ? (
          <option value={selectedId}>Unrecognized range</option>
        ) : null}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {getDefinitionDisplayLabel(option.name, option.key)}
          </option>
        ))}
      </select>
    </>
  );
}
