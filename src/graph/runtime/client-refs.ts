import { deleteEntity, updateEntity } from "./client-actions";
import {
  assertValidResult,
  clearFieldValue,
  exposeMutationValidationResult,
  exposeValidationResult,
  fieldGroupMeta,
  getPredicateCollectionKind,
  isEdgeOutput,
  isTree,
  readPredicateValue,
  sameLogicalValue,
  setNestedValue,
  type CreateInputOfType,
  type EntityLookup,
  type EntityOfType,
  type EntityRef,
  type FieldGroupRef,
  type PredicateItemOf,
  type PredicateRangeEntityRefOf,
  type PredicateRangeEntityTypeOf,
  type PredicateRef,
  type PredicateSetValueOf,
  type PredicateValueOf,
  type RefTree,
  type TypeByKey,
} from "./client-core";
import { projectEntity } from "./client-store";
import {
  planManyRemoveMutation,
  prepareDeleteEntity,
  validateUpdateEntity,
} from "./client-validation";
import { edgeId, isEntityType } from "./schema";
import type {
  AnyTypeOutput,
  EdgeOutput,
  FieldsOutput,
  ScalarTypeOutput,
  TypeOutput,
} from "./schema";
import type { Store } from "./store";

function createPredicateRef<T extends EdgeOutput, Defs extends Record<string, AnyTypeOutput>>(
  store: Store,
  subjectId: string,
  field: T,
  applyMutation: (value: unknown | typeof clearFieldValue) => void,
  validateMutation: (
    value: unknown | typeof clearFieldValue,
  ) => ReturnType<typeof validateUpdateEntity>,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
  entityLookup: EntityLookup<Defs>,
): PredicateRef<T, Defs> {
  const base = {
    subjectId,
    predicateId: edgeId(field),
    field,
    rangeType: typeByKey.get(field.range) as TypeByKey<Defs, T["range"]> | undefined,
    resolveEntity(id: string) {
      const rangeType = typeByKey.get(field.range);
      if (!rangeType || !isEntityType(rangeType)) return undefined;
      return entityLookup.resolve(
        rangeType as PredicateRangeEntityTypeOf<T, Defs>,
        id,
      ) as PredicateRangeEntityRefOf<T, Defs>;
    },
    listEntities() {
      const rangeType = typeByKey.get(field.range);
      if (!rangeType || !isEntityType(rangeType)) return [];
      return entityLookup.list(
        rangeType as PredicateRangeEntityTypeOf<T, Defs>,
      ) as PredicateRangeEntityRefOf<T, Defs>[];
    },
    get() {
      return readPredicateValue(store, subjectId, field, scalarByKey, typeByKey, {
        strictRequired: true,
      }) as PredicateValueOf<T, Defs>;
    },
    subscribe(listener: () => void) {
      let previous = readPredicateValue(store, subjectId, field, scalarByKey, typeByKey, {
        strictRequired: true,
      });

      return store.subscribePredicateSlot(subjectId, edgeId(field), () => {
        const next = readPredicateValue(store, subjectId, field, scalarByKey, typeByKey, {
          strictRequired: true,
        });

        if (sameLogicalValue(previous, next)) return;
        previous = next;
        listener();
      });
    },
    batch<TResult>(fn: () => TResult) {
      return store.batch(fn);
    },
  };

  if (field.cardinality === "many") {
    const collection = {
      kind: getPredicateCollectionKind(field),
    };
    return {
      ...base,
      collection,
      validateReplace(values: PredicateValueOf<T, Defs>) {
        return exposeMutationValidationResult(validateMutation(values));
      },
      replace(values: PredicateValueOf<T, Defs>) {
        applyMutation(values);
      },
      validateAdd(value: PredicateItemOf<T, Defs>) {
        const currentValues = base.get() as unknown as PredicateItemOf<T, Defs>[];
        return exposeMutationValidationResult(validateMutation([...currentValues, value]));
      },
      add(value: PredicateItemOf<T, Defs>) {
        const currentValues = base.get() as unknown as PredicateItemOf<T, Defs>[];
        applyMutation([...currentValues, value]);
      },
      validateRemove(value: PredicateItemOf<T, Defs>) {
        const currentValues = base.get() as unknown as PredicateItemOf<T, Defs>[];
        const planned = planManyRemoveMutation(
          store,
          subjectId,
          field,
          currentValues,
          value,
          scalarByKey,
          typeByKey,
          enumValuesByRange,
        );
        return exposeMutationValidationResult(validateMutation(planned.validationValues));
      },
      remove(value: PredicateItemOf<T, Defs>) {
        const currentValues = base.get() as unknown as PredicateItemOf<T, Defs>[];
        const planned = planManyRemoveMutation(
          store,
          subjectId,
          field,
          currentValues,
          value,
          scalarByKey,
          typeByKey,
          enumValuesByRange,
        );
        if (!sameLogicalValue(planned.validationValues, planned.nextValues)) {
          assertValidResult(validateMutation(planned.validationValues));
        }
        if (sameLogicalValue(currentValues, planned.nextValues)) return;
        applyMutation(planned.nextValues);
      },
      validateClear() {
        return exposeMutationValidationResult(validateMutation([]));
      },
      clear() {
        if ((base.get() as unknown as PredicateItemOf<T, Defs>[]).length === 0) return;
        applyMutation([]);
      },
    } as unknown as PredicateRef<T, Defs>;
  }

  if (field.cardinality === "one?") {
    return {
      ...base,
      validateSet(value: PredicateSetValueOf<T, Defs>) {
        return exposeMutationValidationResult(validateMutation(value));
      },
      set(value: PredicateSetValueOf<T, Defs>) {
        applyMutation(value);
      },
      validateClear() {
        return exposeMutationValidationResult(validateMutation(clearFieldValue));
      },
      clear() {
        if (base.get() === undefined) return;
        applyMutation(clearFieldValue);
      },
    } as unknown as PredicateRef<T, Defs>;
  }

  return {
    ...base,
    validateSet(value: PredicateValueOf<T, Defs>) {
      return exposeMutationValidationResult(validateMutation(value));
    },
    set(value: PredicateValueOf<T, Defs>) {
      applyMutation(value);
    },
  } as unknown as PredicateRef<T, Defs>;
}

function buildFieldRefs<T extends FieldsOutput, Defs extends Record<string, AnyTypeOutput>>(
  store: Store,
  subjectId: string,
  fields: T,
  path: string[],
  applyMutation: (
    path: string[],
    fieldName: string,
    value: unknown | typeof clearFieldValue,
  ) => void,
  validateMutation: (
    path: string[],
    fieldName: string,
    value: unknown | typeof clearFieldValue,
  ) => ReturnType<typeof validateUpdateEntity>,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
  entityLookup: EntityLookup<Defs>,
): FieldGroupRef<T, Defs> {
  const out: Record<string, unknown> = {};
  Object.defineProperty(out, fieldGroupMeta, {
    value: {
      subjectId,
      fieldTree: fields,
      path: Object.freeze([...path]),
    },
    enumerable: false,
    configurable: false,
    writable: false,
  });

  for (const [name, value] of Object.entries(fields)) {
    if (isEdgeOutput(value)) {
      out[name] = createPredicateRef(
        store,
        subjectId,
        value,
        (nextValue) => applyMutation(path, name, nextValue),
        (nextValue) => validateMutation(path, name, nextValue),
        scalarByKey,
        typeByKey,
        enumValuesByRange,
        entityLookup,
      );
      continue;
    }
    if (isTree(value)) {
      out[name] = buildFieldRefs(
        store,
        subjectId,
        value,
        [...path, name],
        applyMutation,
        validateMutation,
        scalarByKey,
        typeByKey,
        enumValuesByRange,
        entityLookup,
      );
    }
  }

  return out as FieldGroupRef<T, Defs>;
}

export function createEntityRef<T extends TypeOutput, Defs extends Record<string, AnyTypeOutput>>(
  store: Store,
  id: string,
  typeDef: T,
  namespace: Defs,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
  entityLookup: EntityLookup<Defs>,
): EntityRef<T, Defs> {
  const applyMutation = (
    path: string[],
    fieldName: string,
    value: unknown | typeof clearFieldValue,
  ) => {
    const patch: Record<string, unknown> = {};
    setNestedValue(patch, path, fieldName, value);
    updateEntity(store, id, typeDef, patch, scalarByKey, typeByKey, enumValuesByRange, namespace);
  };
  const validateMutation = (
    path: string[],
    fieldName: string,
    value: unknown | typeof clearFieldValue,
  ) => {
    const patch: Record<string, unknown> = {};
    setNestedValue(patch, path, fieldName, value);
    return validateUpdateEntity(
      store,
      id,
      typeDef,
      patch,
      scalarByKey,
      typeByKey,
      enumValuesByRange,
      namespace,
    );
  };

  return {
    id,
    type: typeDef,
    fields: buildFieldRefs(
      store,
      id,
      typeDef.fields,
      [],
      applyMutation,
      validateMutation,
      scalarByKey,
      typeByKey,
      enumValuesByRange,
      entityLookup,
    ) as RefTree<T["fields"], Defs>,
    get() {
      return projectEntity(store, id, typeDef, scalarByKey, typeByKey) as EntityOfType<T, Defs>;
    },
    validateUpdate(patch: Partial<CreateInputOfType<T, Defs>>) {
      return exposeMutationValidationResult(
        validateUpdateEntity(
          store,
          id,
          typeDef,
          patch as Record<string, unknown>,
          scalarByKey,
          typeByKey,
          enumValuesByRange,
          namespace,
        ),
      );
    },
    update(patch: Partial<CreateInputOfType<T, Defs>>) {
      return updateEntity(
        store,
        id,
        typeDef,
        patch as Record<string, unknown>,
        scalarByKey,
        typeByKey,
        enumValuesByRange,
        namespace,
      ) as EntityOfType<T, Defs>;
    },
    validateDelete() {
      return exposeValidationResult(prepareDeleteEntity(store, id, typeDef, typeByKey, namespace));
    },
    batch<TResult>(fn: () => TResult) {
      return store.batch(fn);
    },
    delete() {
      deleteEntity(store, id, typeDef, typeByKey, namespace);
    },
  };
}
