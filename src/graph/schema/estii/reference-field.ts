import type { Cardinality, RangeRef } from "@io/core/graph/def";

import {
  existingEntityReferenceField,
  type EntityReferenceEditorKind,
} from "../../graph/reference-policy.js";

export function estiiReferenceField<const Range extends RangeRef, const Card extends Cardinality>(
  range: Range,
  input: {
    cardinality: Card;
    collection?: "ordered" | "unordered";
    create?: boolean;
    editorKind?: EntityReferenceEditorKind;
    label?: string;
  },
) {
  return existingEntityReferenceField<Range, Card>(range, input);
}
