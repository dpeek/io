import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@io/web/combobox";
import { useDeferredValue, useState, type ReactNode } from "react";

type HtmlProps = Record<string, string | undefined>;

export type OptionComboboxOption<TOption> = {
  id: string;
  keywords?: readonly string[];
  label: string;
  option: TOption;
};

export type OptionComboboxCreateAction = {
  description?: string;
  label: string;
  query: string;
};

type OptionComboboxOptionItem<TOption> = OptionComboboxOption<TOption> & {
  kind: "option";
};

type OptionComboboxCreateActionItem = OptionComboboxCreateAction & {
  kind: "create";
};

type OptionComboboxItem<TOption> =
  | OptionComboboxOptionItem<TOption>
  | OptionComboboxCreateActionItem;

type OptionComboboxCreateActionContext<TOption> = {
  matchingOptions: readonly OptionComboboxOptionItem<TOption>[];
  normalizedQuery: string;
  options: readonly OptionComboboxOptionItem<TOption>[];
  query: string;
  selected: readonly OptionComboboxOptionItem<TOption>[];
  visibleOptions: readonly OptionComboboxOptionItem<TOption>[];
};

function isCreateAction<TOption>(
  item: OptionComboboxItem<TOption>,
): item is OptionComboboxCreateActionItem {
  return item.kind === "create";
}

function isOptionItem<TOption>(
  item: OptionComboboxItem<TOption>,
): item is OptionComboboxOptionItem<TOption> {
  return item.kind === "option";
}

function getSearchLabel<TOption>(item: OptionComboboxItem<TOption>): string {
  return item.label;
}

function getSearchValue<TOption>(item: OptionComboboxItem<TOption>): string {
  return item.kind === "create" ? item.query : item.id;
}

function itemsEqual<TOption>(
  left: OptionComboboxItem<TOption>,
  right: OptionComboboxItem<TOption>,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "create" && right.kind === "create") {
    return left.query === right.query;
  }
  if (left.kind === "option" && right.kind === "option") {
    return left.id === right.id;
  }
  return false;
}

function filterItem<TOption>(item: OptionComboboxItem<TOption>, query: string): boolean {
  if (item.kind === "create") return true;
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) return true;
  const haystack = [item.label, item.id, ...(item.keywords ?? [])].join(" ").toLowerCase();
  return haystack.includes(normalizedQuery);
}

export function OptionComboboxEditor<TOption>({
  cardinality,
  emptySelectionMessage,
  fieldKind,
  fieldLabel,
  getCreateAction,
  getCreateItemProps,
  getOptionItemProps,
  getSelectionProps,
  noMatchesMessage = "No matching options.",
  onClear,
  onCreate,
  onRemove,
  onSelect,
  options,
  renderCreateAction,
  renderOption,
  renderSelection,
  selected,
}: {
  cardinality: "many" | "one" | "one?";
  emptySelectionMessage?: ReactNode;
  fieldKind: string;
  fieldLabel: string;
  getCreateAction?: (
    context: OptionComboboxCreateActionContext<TOption>,
  ) => OptionComboboxCreateAction | null;
  getCreateItemProps?: (item: OptionComboboxCreateActionItem) => HtmlProps;
  getOptionItemProps?: (item: OptionComboboxOptionItem<TOption>) => HtmlProps;
  getSelectionProps?: (item: OptionComboboxOptionItem<TOption>) => HtmlProps;
  noMatchesMessage?: ReactNode;
  onClear: () => void;
  onCreate?: (query: string) => void;
  onRemove?: (id: string) => void;
  onSelect: (id: string) => void;
  options: readonly OptionComboboxOption<TOption>[];
  renderCreateAction?: (item: OptionComboboxCreateActionItem) => ReactNode;
  renderOption: (item: OptionComboboxOptionItem<TOption>) => ReactNode;
  renderSelection?: (item: OptionComboboxOptionItem<TOption>) => ReactNode;
  selected: readonly OptionComboboxOption<TOption>[];
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const anchorRef = useComboboxAnchor();
  const optionItems = options.map((option) => ({ kind: "option" as const, ...option }));
  const selectedItems = selected.map((option) => ({ kind: "option" as const, ...option }));
  const selectedIds = new Set(selectedItems.map((option) => option.id));
  const visibleOptionItems =
    cardinality === "many"
      ? optionItems.filter((option) => !selectedIds.has(option.id))
      : optionItems;
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const matchingOptions = visibleOptionItems.filter((option) =>
    filterItem(option, normalizedQuery),
  );
  const createAction = getCreateAction?.({
    matchingOptions,
    normalizedQuery,
    options: optionItems,
    query: deferredQuery.trim(),
    selected: selectedItems,
    visibleOptions: visibleOptionItems,
  });
  const items: OptionComboboxItem<TOption>[] = createAction
    ? [{ kind: "create", ...createAction }, ...visibleOptionItems]
    : [...visibleOptionItems];

  function resetQuery(): void {
    setQuery("");
  }

  function renderCreateItem(item: OptionComboboxCreateActionItem): ReactNode {
    if (renderCreateAction) return renderCreateAction(item);
    return (
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{item.label}</span>
        {item.description ? (
          <span className="text-muted-foreground truncate text-xs">{item.description}</span>
        ) : null}
      </span>
    );
  }

  function renderItem(item: OptionComboboxItem<TOption>, index: number): ReactNode {
    if (item.kind === "create") {
      return (
        <ComboboxItem
          className="items-start py-2"
          index={index}
          key={`create:${item.query}`}
          value={item}
          {...getCreateItemProps?.(item)}
        >
          {renderCreateItem(item)}
        </ComboboxItem>
      );
    }

    return (
      <ComboboxItem index={index} key={item.id} value={item} {...getOptionItemProps?.(item)}>
        {renderOption(item)}
      </ComboboxItem>
    );
  }

  if (cardinality === "many") {
    return (
      <div data-web-field-kind={fieldKind}>
        <Combobox<OptionComboboxItem<TOption>, true>
          autoHighlight
          filter={filterItem}
          isItemEqualToValue={itemsEqual}
          itemToStringLabel={getSearchLabel}
          itemToStringValue={getSearchValue}
          items={items}
          multiple
          onInputValueChange={(nextQuery) => {
            setQuery(nextQuery);
          }}
          onOpenChange={(open) => {
            if (open) return;
            resetQuery();
          }}
          onValueChange={(nextValues) => {
            const createSelection = nextValues.find(isCreateAction);
            if (createSelection) {
              onCreate?.(createSelection.query);
              resetQuery();
              return;
            }

            const nextOptionValues = nextValues.filter(isOptionItem);
            if (nextOptionValues.length === 0 && selectedItems.length > 0) {
              onClear();
              resetQuery();
              return;
            }

            if (nextOptionValues.length < selectedItems.length) {
              const removed =
                selectedItems.find(
                  (selectedItem) =>
                    !nextOptionValues.some((nextOption) => nextOption.id === selectedItem.id),
                ) ?? null;
              if (removed) {
                onRemove?.(removed.id);
              }
              return;
            }

            const added =
              nextOptionValues.find((nextOption) => !selectedIds.has(nextOption.id)) ?? null;
            if (!added) return;
            onSelect(added.id);
            resetQuery();
          }}
          value={selectedItems}
        >
          <ComboboxChips className="w-full" ref={anchorRef}>
            <ComboboxValue>
              {selectedItems.map((item) => (
                <ComboboxChip className="max-w-full" key={item.id} {...getSelectionProps?.(item)}>
                  {(renderSelection ?? renderOption)(item)}
                </ComboboxChip>
              ))}
            </ComboboxValue>
            <ComboboxChipsInput className="text-base" data-web-field-kind={`${fieldKind}-input`} />
          </ComboboxChips>
          <ComboboxContent anchor={anchorRef}>
            <ComboboxEmpty>{noMatchesMessage}</ComboboxEmpty>
            <ComboboxList>{renderItem}</ComboboxList>
          </ComboboxContent>
        </Combobox>
        {emptySelectionMessage && selectedItems.length === 0 ? (
          <div className="text-muted-foreground mt-2 text-sm">{emptySelectionMessage}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3" data-web-field-kind={fieldKind}>
      <Combobox<OptionComboboxItem<TOption>>
        autoHighlight
        filter={filterItem}
        isItemEqualToValue={itemsEqual}
        itemToStringLabel={getSearchLabel}
        itemToStringValue={getSearchValue}
        items={items}
        onInputValueChange={(nextQuery) => {
          setQuery(nextQuery);
        }}
        onOpenChange={(open) => {
          if (open) return;
          resetQuery();
        }}
        onValueChange={(nextValue) => {
          if (nextValue == null) {
            if (cardinality === "one?") {
              onClear();
            }
            resetQuery();
            return;
          }

          if (isCreateAction(nextValue)) {
            onCreate?.(nextValue.query);
            resetQuery();
            return;
          }

          onSelect(nextValue.id);
          resetQuery();
        }}
        value={selectedItems[0] ?? null}
      >
        <ComboboxInput
          aria-label={fieldLabel}
          className="w-full"
          data-web-field-kind={`${fieldKind}-input`}
          placeholder={`Select ${fieldLabel.toLowerCase()}`}
          showClear={cardinality === "one?"}
        />
        <ComboboxContent>
          <ComboboxEmpty>{noMatchesMessage}</ComboboxEmpty>
          <ComboboxList>{renderItem}</ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
