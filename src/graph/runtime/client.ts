import { createEntity, createEntityAtId, deleteEntity, updateEntity } from "./client-actions";
import {
  collectEnumValueIds,
  collectScalarCodecs,
  collectTypeIndex,
  exposeMutationValidationResult,
  exposeValidationResult,
  type AllDefs,
  type CreateInputOfType,
  type EntityLookup,
  type EntityRef,
  type NamespaceClient,
  type TypeQuerySpec,
} from "./client-core";
import { createQueryProjector } from "./client-query";
import { createEntityRef } from "./client-refs";
import {
  prepareDeleteEntity,
  validateCreateEntity,
  validateUpdateEntity,
} from "./client-validation";
import { core } from "./core";
import { edgeId, typeId } from "./schema";
import type { AnyTypeOutput, EdgeOutput, TypeOutput } from "./schema";
import type { Store } from "./store";

export * from "./client-core";
export { validateGraphStore } from "./client-validation";

export function createEntityWithId<
  const T extends TypeOutput,
  const Defs extends Record<string, AnyTypeOutput>,
>(
  store: Store,
  namespace: Defs,
  typeDef: T,
  id: string,
  input: CreateInputOfType<T, Defs>,
): string {
  if (store.facts(id).length > 0) {
    throw new Error(`Cannot create "${typeDef.values.key}" at existing node id "${id}".`);
  }

  const allTypes = namespace as Record<string, AnyTypeOutput>;
  const scalarByKey = collectScalarCodecs(allTypes);
  const typeByKey = collectTypeIndex(allTypes);
  const enumValuesByRange = collectEnumValueIds(allTypes, typeByKey);
  return createEntityAtId(
    store,
    id,
    typeDef,
    input as CreateInputOfType<T, Record<string, AnyTypeOutput>>,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
    allTypes,
  );
}

export function createTypeClient<const T extends Record<string, AnyTypeOutput>>(
  store: Store,
  namespace: T,
): NamespaceClient<T> {
  const nodeTypePredicate = core.node.fields.type as EdgeOutput;
  const nodeTypePredicateId = edgeId(nodeTypePredicate);
  const scalarByKey = collectScalarCodecs(namespace);
  const typeByKey = collectTypeIndex(namespace);
  const enumValuesByRange = collectEnumValueIds(namespace, typeByKey);
  const entityRefs = new Map<string, EntityRef<any, any>>();
  const getEntityRef = <U extends TypeOutput>(typeDef: U, id: string): EntityRef<U, AllDefs<T>> => {
    const cacheKey = `${typeId(typeDef)}\0${id}`;
    const cached = entityRefs.get(cacheKey);
    if (cached) return cached as EntityRef<U, AllDefs<T>>;
    const entityRef = createEntityRef(
      store,
      id,
      typeDef,
      namespace as AllDefs<T>,
      scalarByKey,
      typeByKey,
      enumValuesByRange,
      entityLookup,
    );
    entityRefs.set(cacheKey, entityRef);
    return entityRef as EntityRef<U, AllDefs<T>>;
  };
  const listEntityRefs = <U extends TypeOutput>(typeDef: U): EntityRef<U, AllDefs<T>>[] =>
    store
      .facts(undefined, nodeTypePredicateId, typeId(typeDef))
      .map((edge) => getEntityRef(typeDef, edge.s));
  const entityLookup: EntityLookup<AllDefs<T>> = {
    resolve(typeDef, id) {
      return getEntityRef(typeDef, id);
    },
    list(typeDef) {
      return listEntityRefs(typeDef);
    },
  };
  const hasEntity = <U extends TypeOutput>(typeDef: U, id: string): boolean =>
    store.facts(id, nodeTypePredicateId, typeId(typeDef)).length > 0;
  const { projectSelectedEntity } = createQueryProjector<T>(
    store,
    scalarByKey,
    typeByKey,
    hasEntity,
  );

  return new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key !== "string") return undefined;
        const typeDef = namespace[key as keyof T];
        if (!typeDef || typeDef.kind !== "entity") return undefined;
        const entityType = typeDef as Extract<T[keyof T], { kind: "entity" }>;

        return {
          validateCreate(input: unknown) {
            return exposeMutationValidationResult(
              validateCreateEntity(
                store,
                entityType as any,
                input as any,
                scalarByKey,
                typeByKey,
                enumValuesByRange,
                namespace,
              ),
            );
          },
          create(input: unknown) {
            return createEntity(
              store,
              entityType as any,
              input as any,
              scalarByKey,
              typeByKey,
              enumValuesByRange,
              namespace,
            );
          },
          get(id: string) {
            return getEntityRef(entityType as any, id).get();
          },
          validateUpdate(id: string, patch: unknown) {
            return exposeMutationValidationResult(
              validateUpdateEntity(
                store,
                id,
                entityType as any,
                patch as Record<string, unknown>,
                scalarByKey,
                typeByKey,
                enumValuesByRange,
                namespace,
              ),
            );
          },
          update(id: string, patch: unknown) {
            return updateEntity(
              store,
              id,
              entityType as any,
              patch as Record<string, unknown>,
              scalarByKey,
              typeByKey,
              enumValuesByRange,
              namespace,
            );
          },
          validateDelete(id: string) {
            return exposeValidationResult(
              prepareDeleteEntity(store, id, entityType as any, typeByKey, namespace),
            );
          },
          delete(id: string) {
            deleteEntity(store, id, entityType as any, typeByKey, namespace);
          },
          list() {
            return listEntityRefs(entityType as any).map((entityRef) => entityRef.get());
          },
          async query(query: unknown) {
            const spec = query as TypeQuerySpec<any, AllDefs<T>>;
            if (
              !spec ||
              typeof spec !== "object" ||
              !spec.select ||
              typeof spec.select !== "object"
            ) {
              throw new Error("Query spec must include a selection object");
            }
            if (spec.where?.id !== undefined && spec.where.ids !== undefined) {
              throw new Error('Query "where" cannot include both "id" and "ids"');
            }

            if (spec.where?.id !== undefined) {
              if (!hasEntity(entityType as any, spec.where.id)) return undefined;
              return projectSelectedEntity(entityType as any, spec.where.id, spec.select);
            }

            const ids =
              spec.where?.ids?.map((id) => String(id)) ??
              listEntityRefs(entityType as any).map((entityRef) => entityRef.id);

            return ids.flatMap((id) =>
              hasEntity(entityType as any, id)
                ? [projectSelectedEntity(entityType as any, id, spec.select)]
                : [],
            );
          },
          ref(id: string) {
            return getEntityRef(entityType as any, id);
          },
          node(id: string) {
            return getEntityRef(entityType as any, id);
          },
        };
      },
    },
  ) as NamespaceClient<T>;
}
