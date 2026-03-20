import {
  isEdgeOutput,
  isTree,
  readPredicateValue,
  type AllDefs,
  type FieldQuerySelection,
  type QueryFieldResult,
  type TypeQueryResult,
  type TypeQuerySelection,
} from "./client-core";
import { fieldTreeKey, isEntityType } from "./schema";
import type {
  AnyTypeOutput,
  EdgeOutput,
  FieldsOutput,
  ScalarTypeOutput,
  TypeOutput,
} from "./schema";
import type { Store } from "./store";

export function createQueryProjector<const T extends Record<string, AnyTypeOutput>>(
  store: Store,
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
    Selection extends FieldQuerySelection<U, AllDefs<T>>,
  >(
    subjectId: string,
    fields: U,
    selection: Selection,
  ): QueryFieldResult<U, Selection, AllDefs<T>> => {
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
          const nestedSelection = selected.select as TypeQuerySelection<
            typeof rangeType,
            AllDefs<T>
          >;

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
        selected as FieldQuerySelection<typeof fieldTree, AllDefs<T>>,
      );
    }

    return out as QueryFieldResult<U, Selection, AllDefs<T>>;
  };

  const projectSelectedEntity = <
    U extends TypeOutput,
    Selection extends TypeQuerySelection<U, AllDefs<T>>,
  >(
    typeDef: U,
    id: string,
    selection: Selection,
  ): TypeQueryResult<U, Selection, AllDefs<T>> => {
    const out = projectQueryFields(id, typeDef.fields, selection);
    if (selection.id) {
      const withId: Record<string, unknown> = { ...out };
      withId.id = id;
      return withId as TypeQueryResult<U, Selection, AllDefs<T>>;
    }
    return out as TypeQueryResult<U, Selection, AllDefs<T>>;
  };

  return {
    projectSelectedEntity,
  };
}
