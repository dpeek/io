import type { Cardinality, RangeRef } from "@io/graph-module";
import { existingEntityReferenceField, type EntityReferenceEditorKind } from "@io/graph-module";

export function kitchenSinkReferenceField<
  const Range extends RangeRef,
  const Card extends Cardinality,
>(
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
