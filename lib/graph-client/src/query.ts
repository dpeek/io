import type { GraphStore } from "@io/graph-kernel";
import { fieldTreeKey, isEntityType } from "@io/graph-kernel";
import type {
  AnyTypeOutput,
  EdgeOutput,
  FieldsOutput,
  ScalarTypeOutput,
  TypeOutput,
} from "@io/graph-kernel";

import {
  isEdgeOutput,
  isTree,
  readPredicateValue,
  type FieldQuerySelection,
  type QueryFieldResult,
  type TypeQueryResult,
  type TypeQuerySelection,
} from "./core";

export function createQueryProjector<const TDefs extends Record<string, AnyTypeOutput>>(
  store: GraphStore,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  hasEntity: <U extends TypeOutput>(typeDef: U, id: string) => boolean,
) {
  const assertEntity = <U extends TypeOutput>(typeDef: U, id: string): void => {
    if (hasEntity(typeDef, id)) return;
    throw new Error(`Missing entity "${id}" for type "${typeDef.values.key}"`);
  };

  const projectQueryFields = <
    U extends FieldsOutput,
    Selection extends FieldQuerySelection<U, TDefs>,
  >(
    subjectId: string,
    fields: U,
    selection: Selection,
  ): QueryFieldResult<U, Selection, TDefs> => {
    const out: Record<string, unknown> = {};

    for (const [fieldName, selected] of Object.entries(selection)) {
      if (fieldName === "id" || selected === undefined) continue;
      const field = fields[fieldName as keyof U];
      if (!field) throw new Error(`Unknown selected field "${fieldName}"`);

      if (isEdgeOutput(field)) {
        const edge = field as unknown as EdgeOutput;
        if (selected !== true) {
          const rangeType = typeByKey.get(edge.range);
          if (
            !rangeType ||
            !isEntityType(rangeType) ||
            !selected ||
            typeof selected !== "object" ||
            !("select" in selected)
          ) {
            throw new Error(`Predicate "${edge.key}" does not support nested selection`);
          }

          const nested = readPredicateValue(store, subjectId, edge, scalarByKey, typeByKey, {
            strictRequired: true,
          });
          const nestedSelection = selected.select as TypeQuerySelection<typeof rangeType, TDefs>;

          if (edge.cardinality === "many") {
            out[fieldName] = (nested as string[]).map((entityId) => {
              assertEntity(rangeType, entityId);
              return projectSelectedEntity(rangeType, entityId, nestedSelection);
            });
            continue;
          }

          if (nested === undefined) {
            out[fieldName] = undefined;
            continue;
          }

          const entityId = nested as string;
          assertEntity(rangeType, entityId);
          out[fieldName] = projectSelectedEntity(rangeType, entityId, nestedSelection);
          continue;
        }

        out[fieldName] = readPredicateValue(store, subjectId, edge, scalarByKey, typeByKey, {
          strictRequired: true,
        });
        continue;
      }

      if (!isTree(field)) throw new Error(`Unknown selected field "${fieldName}"`);
      const fieldTree = field as unknown as FieldsOutput;
      if (!selected || typeof selected !== "object" || Array.isArray(selected)) {
        throw new Error(
          `Field group "${fieldTreeKey(fieldTree)}" requires a nested selection object`,
        );
      }
      out[fieldName] = projectQueryFields(
        subjectId,
        fieldTree,
        selected as FieldQuerySelection<typeof fieldTree, TDefs>,
      );
    }

    return out as QueryFieldResult<U, Selection, TDefs>;
  };

  const projectSelectedEntity = <
    U extends TypeOutput,
    Selection extends TypeQuerySelection<U, TDefs>,
  >(
    typeDef: U,
    id: string,
    selection: Selection,
  ): TypeQueryResult<U, Selection, TDefs> => {
    const out = projectQueryFields(id, typeDef.fields, selection);
    if (selection.id) {
      const withId: Record<string, unknown> = { ...out };
      withId.id = id;
      return withId as TypeQueryResult<U, Selection, TDefs>;
    }
    return out as TypeQueryResult<U, Selection, TDefs>;
  };

  return {
    projectSelectedEntity,
  };
}
