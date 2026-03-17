import type { Cardinality, RangeRef } from "./schema.js";
import type { ReferenceFieldInput } from "./type-module.js";
import { defineReferenceField } from "./type-module.js";

export const entityReferenceListDisplayKind = "entity-reference-list";
export const entityReferenceComboboxEditorKind = "entity-reference-combobox";

export type EntityReferenceEditorKind = typeof entityReferenceComboboxEditorKind;
export type EntityReferenceCollectionKind = "ordered" | "unordered";

export type ExistingEntityReferencePolicy = {
  selection: "existing-only";
  create: boolean;
  excludeSubject?: boolean;
};

export type EntityReferenceFieldMeta = {
  label?: string;
  reference: ExistingEntityReferencePolicy;
  editor?: {
    kind: EntityReferenceEditorKind;
  };
  collection?: {
    kind: EntityReferenceCollectionKind;
  };
};

export function existingEntityReferenceFieldMeta(input?: {
  label?: string;
  create?: boolean;
  editorKind?: EntityReferenceEditorKind;
  collection?: EntityReferenceCollectionKind;
  excludeSubject?: boolean;
}): EntityReferenceFieldMeta {
  return {
    ...(input?.label ? { label: input.label } : {}),
    reference: {
      selection: "existing-only",
      create: input?.create ?? false,
      ...(input?.excludeSubject ? { excludeSubject: true } : {}),
    },
    ...(input?.editorKind ? { editor: { kind: input.editorKind } } : {}),
    ...(input?.collection ? { collection: { kind: input.collection } } : {}),
  };
}

type ExistingEntityReferenceFieldInput<Range extends RangeRef, Card extends Cardinality> = Omit<
  ReferenceFieldInput<Range, { meta: EntityReferenceFieldMeta }, Card>,
  "meta" | "range"
> & {
  label?: string;
  create?: boolean;
  editorKind?: EntityReferenceEditorKind;
  collection?: EntityReferenceCollectionKind;
  excludeSubject?: boolean;
};

export function existingEntityReferenceField<
  const Range extends RangeRef,
  const Card extends Cardinality,
>(range: Range, input: ExistingEntityReferenceFieldInput<Range, Card>) {
  const { collection, create, editorKind, excludeSubject, label, ...rest } = input;
  const field: ReferenceFieldInput<Range, { meta: EntityReferenceFieldMeta }, Card> = {
    ...rest,
    range,
    meta: existingEntityReferenceFieldMeta({
      collection,
      create,
      editorKind,
      excludeSubject,
      label,
    }),
  };
  return defineReferenceField<Range, { meta: EntityReferenceFieldMeta }, Card>(field);
}
