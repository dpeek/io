import type { GraphStore } from "@io/graph-kernel";
import { edgeId, typeId } from "@io/graph-kernel";
import type { AnyTypeOutput, EdgeOutput, TypeOutput } from "@io/graph-kernel";

import {
  collectEnumValueIds,
  collectScalarCodecs,
  collectTypeIndex,
  exposeMutationValidationResult,
  exposeValidationResult,
  type CreateInputOfType,
  type EntityLookup,
  type EntityRef,
  type GraphClient,
  type TypeQuerySpec,
  requireGraphClientCoreSchema,
} from "./core";
import { createEntity, createEntityAtId, deleteEntity, updateEntity } from "./entity-actions";
import { createQueryProjector } from "./query";
import { createEntityRef } from "./refs";
import { prepareDeleteEntity, validateCreateEntity, validateUpdateEntity } from "./validation";

export * from "./core";
export { validateGraphStore } from "./validation";

export function createEntityWithId<
  const T extends TypeOutput,
  const Defs extends Record<string, AnyTypeOutput>,
>(
  store: GraphStore,
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

export function createGraphClient<
  const TNamespace extends Record<string, AnyTypeOutput>,
  const TDefs extends Record<string, AnyTypeOutput> = TNamespace,
>(
  store: GraphStore,
  namespace: TNamespace,
  definitionsArg?: TDefs,
): GraphClient<TNamespace, TDefs> {
  const definitions = (definitionsArg ?? (namespace as unknown as TDefs)) as TDefs;
  const coreSchema = requireGraphClientCoreSchema(definitions);
  const nodeTypePredicate = coreSchema.node.fields.type as EdgeOutput;
  const nodeTypePredicateId = edgeId(nodeTypePredicate);
  const scalarByKey = collectScalarCodecs(definitions);
  const typeByKey = collectTypeIndex(definitions);
  const enumValuesByRange = collectEnumValueIds(definitions, typeByKey);
  const entityRefs = new Map<string, EntityRef<any, any>>();
  const getEntityRef = <U extends TypeOutput>(typeDef: U, id: string): EntityRef<U, TDefs> => {
    const cacheKey = `${typeId(typeDef)}\0${id}`;
    const cached = entityRefs.get(cacheKey);
    if (cached) return cached as EntityRef<U, TDefs>;
    const entityRef = createEntityRef(
      store,
      id,
      typeDef,
      definitions,
      scalarByKey,
      typeByKey,
      enumValuesByRange,
      entityLookup,
    );
    entityRefs.set(cacheKey, entityRef);
    return entityRef as EntityRef<U, TDefs>;
  };
  const listEntityRefs = <U extends TypeOutput>(typeDef: U): EntityRef<U, TDefs>[] =>
    store
      .facts(undefined, nodeTypePredicateId, typeId(typeDef))
      .map((edge) => getEntityRef(typeDef, edge.s));
  const entityLookup: EntityLookup<TDefs> = {
    resolve(typeDef, id) {
      return getEntityRef(typeDef, id);
    },
    list(typeDef) {
      return listEntityRefs(typeDef);
    },
  };
  const hasEntity = <U extends TypeOutput>(typeDef: U, id: string): boolean =>
    store.facts(id, nodeTypePredicateId, typeId(typeDef)).length > 0;
  const { projectSelectedEntity } = createQueryProjector<TDefs>(
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
        const typeDef = namespace[key];
        if (!typeDef || typeDef.kind !== "entity") return undefined;
        const entityType = typeDef as Extract<TNamespace[keyof TNamespace], { kind: "entity" }>;

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
                definitions,
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
              definitions,
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
                definitions,
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
              definitions,
            );
          },
          validateDelete(id: string) {
            return exposeValidationResult(
              prepareDeleteEntity(store, id, entityType as any, typeByKey, definitions),
            );
          },
          delete(id: string) {
            deleteEntity(store, id, entityType as any, typeByKey, definitions);
          },
          list() {
            return listEntityRefs(entityType as any).map((entityRef) => entityRef.get());
          },
          async query(query: unknown) {
            const spec = query as TypeQuerySpec<any, TDefs>;
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
  ) as GraphClient<TNamespace, TDefs>;
}
