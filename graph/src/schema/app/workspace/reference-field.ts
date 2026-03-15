import type { Cardinality, RangeRef } from "../../../graph/schema.js";
import { defineReferenceField } from "../../../graph/type-module.js";

const existingReferencePolicy = {
  selection: "existing-only",
  create: false,
} as const;

export function workspaceReferenceField<const Range extends RangeRef, const Card extends Cardinality>(
  range: Range,
  input: {
    cardinality: Card;
    collection?: "ordered" | "unordered";
    label: string;
  },
) {
  const { cardinality, collection, label } = input;
  return defineReferenceField({
    range,
    cardinality,
    meta: {
      label,
      ...(collection ? { collection: { kind: collection } } : {}),
      reference: existingReferencePolicy,
    },
  });
}
