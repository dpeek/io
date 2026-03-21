import type { GraphMutationValidationResult } from "../../../index.js";
import { core } from "../../../modules/index.js";
import {
  getPredicateEntityReferenceOptions,
  getPredicateEntityReferencePolicy,
  getPredicateEntityReferenceSelection,
  performValidatedMutation,
  useOptionalMutationRuntime,
  usePredicateField,
  type PredicateFieldViewCapability,
} from "../../../runtime/react/index.js";
import { OptionComboboxEditor } from "./option-combobox.js";
import {
  createTagKey,
  EntityReferenceOptionContent,
  EntityReferenceSummary,
  getEntityReferenceLabel,
  type EntityReferenceEntity,
} from "./reference-ui.js";
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

type TagCreateGraphHandle = {
  create(input: { color: string; key: string; name: string }): string;
  list(): Array<{ id: string; key: string; name: string }>;
  validateCreate(input: {
    color: string;
    key: string;
    name: string;
  }): GraphMutationValidationResult;
};

type EntityReferenceComboboxRuntime = {
  graph?: {
    tag?: TagCreateGraphHandle;
  };
};

const tagColorPalette = ["#2563eb", "#0f766e", "#d97706", "#be123c", "#7c3aed", "#0891b2"] as const;

function EntityReferenceListView({ predicate }: AnyFieldProps) {
  const { value } = usePredicateField(predicate);
  const references = getPredicateEntityReferenceSelection(predicate, value);

  return (
    <ul data-web-field-kind="entity-reference-list">
      {references.map(({ entity, id }) => (
        <li data-web-reference-id={id} key={id}>
          <EntityReferenceSummary entity={entity} />
        </li>
      ))}
    </ul>
  );
}

export const entityReferenceListViewCapability = {
  kind: "entity-reference-list",
  Component: EntityReferenceListView,
} satisfies PredicateFieldViewCapability<any, any>;

export function EntityReferenceComboboxEditor({
  onMutationError,
  onMutationSuccess,
  predicate,
}: AnyFieldProps) {
  const callbacks = useFieldMutationCallbacks({ onMutationError, onMutationSuccess });
  const runtime = useOptionalMutationRuntime() as EntityReferenceComboboxRuntime | null;
  const { value } = usePredicateField(predicate);
  const options = getPredicateEntityReferenceOptions(predicate).map(({ entity, id }) => ({
    id,
    keywords: [id],
    label: getEntityReferenceLabel(entity),
    option: entity,
  }));
  const optionById = new Map(options.map((option) => [option.id, option]));
  const selected = getPredicateEntityReferenceSelection(predicate, value).map(({ entity, id }) => {
    const option = optionById.get(id);
    if (option) return option;
    return {
      id,
      keywords: [id],
      label: getEntityReferenceLabel(entity),
      option: entity,
    };
  });
  const selectedIds = new Set(selected.map((option) => option.id));
  const referencePolicy = getPredicateEntityReferencePolicy(predicate.field);
  const fieldLabel = getPredicateFieldLabel(predicate);
  const tagGraph = runtime?.graph?.tag;
  const canCreateTag =
    referencePolicy?.create === true &&
    predicate.rangeType?.values.key === core.tag.values.key &&
    !!tagGraph;

  function commitSelection(nextValue: string): void {
    if (predicate.field.cardinality === "many") {
      if (selectedIds.has(nextValue)) return;
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

  function commitClear(): void {
    performValidatedMutation(
      callbacks,
      () => validatePredicateClear(predicate),
      () => clearPredicateValue(predicate),
    );
  }

  function createTagFromQuery(nextQuery: string): void {
    if (!canCreateTag || !tagGraph) return;
    const trimmedQuery = nextQuery.trim();
    if (trimmedQuery.length === 0) return;

    const existingTags = tagGraph.list();
    const normalizedTagQuery = trimmedQuery.toLowerCase();
    const normalizedKey = createTagKey(trimmedQuery, new Set());
    const existingTag =
      existingTags.find((tag) => tag.name.trim().toLowerCase() === normalizedTagQuery) ??
      existingTags.find((tag) => tag.key === normalizedKey);
    if (existingTag) {
      commitSelection(existingTag.id);
      return;
    }

    const input = {
      color: tagColorPalette[existingTags.length % tagColorPalette.length] ?? tagColorPalette[0],
      key: createTagKey(trimmedQuery, new Set(existingTags.map((tag) => tag.key))),
      name: trimmedQuery,
    };
    let createdTagId = "";

    const committed = performValidatedMutation(
      callbacks,
      () => tagGraph.validateCreate(input),
      () => {
        createdTagId = tagGraph.create(input);
        if (predicate.field.cardinality === "many") {
          return addPredicateItem(predicate, createdTagId);
        }
        return setPredicateValue(predicate, createdTagId);
      },
    );
    if (!committed || createdTagId.length === 0) return;
  }

  return (
    <OptionComboboxEditor
      cardinality={predicate.field.cardinality}
      fieldKind="entity-reference-combobox"
      fieldLabel={fieldLabel}
      getCreateAction={({ matchingOptions, normalizedQuery, options: allOptions, query }) =>
        canCreateTag &&
        normalizedQuery.length > 0 &&
        matchingOptions.length === 0 &&
        !allOptions.some(
          (option) =>
            option.label.toLowerCase() === normalizedQuery ||
            option.id.toLowerCase() === normalizedQuery,
        )
          ? {
              description: "Press Enter to create and attach it.",
              label: `Create tag "${query}"`,
              query,
            }
          : null
      }
      getCreateItemProps={() => ({ "data-proof-mutation": "entity-reference" })}
      getOptionItemProps={(item) => ({
        "data-proof-mutation": "entity-reference",
        "data-web-reference-option-id": item.id,
      })}
      getSelectionProps={(item) => ({ "data-web-reference-selected-id": item.id })}
      noMatchesMessage="No matching references."
      onClear={commitClear}
      onCreate={createTagFromQuery}
      onRemove={(id) => {
        performValidatedMutation(
          callbacks,
          () => validatePredicateRemove(predicate, id),
          () => removePredicateItem(predicate, id),
        );
      }}
      onSelect={commitSelection}
      options={options}
      renderOption={(item) => (
        <EntityReferenceOptionContent
          entity={item.option as EntityReferenceEntity}
          iconClassName="text-foreground/70 size-3.5"
        />
      )}
      renderSelection={(item) => (
        <EntityReferenceOptionContent
          entity={item.option as EntityReferenceEntity}
          iconClassName="text-foreground/70 size-3.5"
        />
      )}
      selected={selected}
    />
  );
}
