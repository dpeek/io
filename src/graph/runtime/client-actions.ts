import {
  assertValidResult,
  getStableCreateNodeId,
  type CreateInputOfType,
  type EntityOfType,
} from "./client-core";
import { commitCreateEntity, commitUpdateEntity } from "./client-store";
import {
  prepareDeleteEntity,
  validateCreateEntity,
  validateUpdateEntity,
} from "./client-validation";
import type { AnyTypeOutput, ScalarTypeOutput, TypeOutput } from "./schema";
import type { Store } from "./store";

export function createEntityAtId<T extends TypeOutput>(
  store: Store,
  id: string,
  typeDef: T,
  data: CreateInputOfType<T, Record<string, AnyTypeOutput>>,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
  namespace: Record<string, AnyTypeOutput>,
): string {
  const validation = validateCreateEntity(
    store,
    typeDef,
    data,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
    namespace,
    { nodeId: id },
  );
  assertValidResult(validation);
  return commitCreateEntity(
    store,
    id,
    typeDef,
    validation.value,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
  );
}

export function createEntity<T extends TypeOutput>(
  store: Store,
  typeDef: T,
  data: CreateInputOfType<T, Record<string, AnyTypeOutput>>,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
  namespace: Record<string, AnyTypeOutput>,
): string {
  return createEntityAtId(
    store,
    getStableCreateNodeId(store),
    typeDef,
    data,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
    namespace,
  );
}

export function updateEntity<T extends TypeOutput>(
  store: Store,
  id: string,
  typeDef: T,
  patch: Record<string, unknown>,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
  namespace: Record<string, AnyTypeOutput>,
): EntityOfType<T, Record<string, AnyTypeOutput>> {
  const prepared = validateUpdateEntity(
    store,
    id,
    typeDef,
    patch,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
    namespace,
  );
  assertValidResult(prepared);
  return commitUpdateEntity(
    store,
    id,
    typeDef,
    prepared.value,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
  );
}

export function deleteEntity<T extends TypeOutput, Defs extends Record<string, AnyTypeOutput>>(
  store: Store,
  id: string,
  typeDef: T,
  typeByKey: Map<string, AnyTypeOutput>,
  namespace: Defs,
): void {
  assertValidResult(prepareDeleteEntity(store, id, typeDef, typeByKey, namespace));
  store.batch(() => {
    for (const edge of store.facts(id)) store.retract(edge.id);
  });
}
