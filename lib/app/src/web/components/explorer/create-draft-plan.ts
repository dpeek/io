import {
  edgeId,
  fieldWritePolicy,
  isEnumType,
  isFieldsOutput,
  type AnyTypeOutput,
  type EdgeOutput,
} from "@io/app/graph";

import { setDraftValue } from "./create-draft-values.js";
import { createdAtPredicateId, typePredicateId, updatedAtPredicateId } from "./model.js";
import type { EntityCatalogEntry } from "./model.js";

const defaultTagColors = [
  "#2563eb",
  "#0f766e",
  "#d97706",
  "#be123c",
  "#7c3aed",
  "#0891b2",
] as const;

export type DraftFieldDefinition = {
  field: EdgeOutput;
  fieldName: string;
  path: string[];
  pathLabel: string;
  predicateId: string;
};

export type CreatePlan = {
  clientFields: DraftFieldDefinition[];
  supported: boolean;
};

export function isEdgeOutputValue(value: unknown): value is EdgeOutput {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EdgeOutput>;
  return (
    typeof candidate.key === "string" &&
    typeof candidate.range === "string" &&
    typeof candidate.cardinality === "string"
  );
}

function collectDraftFields(
  node: Record<string, unknown>,
  path: string[] = [],
  out: DraftFieldDefinition[] = [],
): DraftFieldDefinition[] {
  for (const [fieldName, value] of Object.entries(node)) {
    if (isEdgeOutputValue(value)) {
      out.push({
        field: value,
        fieldName,
        path,
        pathLabel: [...path, fieldName].join("."),
        predicateId: edgeId(value),
      });
      continue;
    }

    if (!isFieldsOutput(value)) continue;
    collectDraftFields(value as Record<string, unknown>, [...path, fieldName], out);
  }

  return out;
}

export function buildCreatePlan(entry: EntityCatalogEntry): CreatePlan {
  const clientFields: DraftFieldDefinition[] = [];
  let supported = true;

  for (const field of collectDraftFields(entry.typeDef.fields as Record<string, unknown>)) {
    const isManagedField =
      field.predicateId === typePredicateId ||
      field.predicateId === createdAtPredicateId ||
      field.predicateId === updatedAtPredicateId;
    if (isManagedField) {
      continue;
    }

    const writePolicy = fieldWritePolicy(field.field as Parameters<typeof fieldWritePolicy>[0]);
    if (writePolicy !== "client-tx") {
      if (field.field.cardinality === "one") {
        supported = false;
      }
      continue;
    }

    clientFields.push(field);
  }

  return {
    clientFields,
    supported,
  };
}

export function buildCreateDefaults(
  entry: EntityCatalogEntry,
  typeById: ReadonlyMap<string, AnyTypeOutput>,
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};

  for (const field of collectDraftFields(entry.typeDef.fields as Record<string, unknown>)) {
    if (fieldWritePolicy(field.field as Parameters<typeof fieldWritePolicy>[0]) !== "client-tx") {
      continue;
    }
    if (field.field.cardinality !== "one") continue;

    const rangeType = typeById.get(field.field.range);
    if (!rangeType || !isEnumType(rangeType)) continue;
    const firstOption = Object.values(rangeType.options)[0];
    if (!firstOption) continue;
    const optionId = firstOption.id ?? firstOption.key;
    Object.assign(defaults, setDraftValue(defaults, field.path, field.fieldName, optionId));
  }

  if (entry.key === "workflow:documentBlock" || entry.key === "workflow:documentPlacement") {
    return setDraftValue(defaults, [], "order", entry.count);
  }

  if (entry.key === "core:tag") {
    return setDraftValue(
      defaults,
      [],
      "color",
      defaultTagColors[entry.count % defaultTagColors.length] ?? defaultTagColors[0],
    );
  }

  return defaults;
}
