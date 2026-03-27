import {
  edgeId,
  isEntityType,
  isEnumType,
  type AnyTypeOutput,
  type GraphStore,
  typeId,
} from "@io/graph-kernel";

import {
  assertBootstrapManagedTimestampsOnce,
  assertCurrentFactOnce,
  cloneBootstrapTimestamp,
  createBootstrapFacts,
} from "./bootstrap-facts.js";
import type { GraphBootstrapOptions } from "./contracts.js";
import { requireGraphBootstrapCoreSchema } from "./core-schema.js";
import {
  createBootstrapIconSeedLookup,
  resolveBootstrapPredicateIconId,
  resolveBootstrapTypeIconId,
  seedBootstrapIcon,
} from "./icons.js";
import { collectPredicates, collectShapeNodes, compareBootstrapTypeOrder } from "./schema-tree.js";

function createResolutionTypeById(
  orderedTypes: readonly AnyTypeOutput[],
  availableDefinitions: Record<string, AnyTypeOutput> | undefined,
): Map<string, AnyTypeOutput> {
  const resolutionTypeById = new Map<string, AnyTypeOutput>();

  for (const typeDef of Object.values(availableDefinitions ?? {})) {
    resolutionTypeById.set(typeId(typeDef), typeDef);
  }

  for (const typeDef of orderedTypes) {
    resolutionTypeById.set(typeId(typeDef), typeDef);
  }

  return resolutionTypeById;
}

/**
 * Adds schema bootstrap state into an existing graph store.
 *
 * This operation is additive and idempotent for a resolved definition slice.
 * It does not retract existing facts or rewrite already-materialized schema
 * nodes, but it will fill in missing bootstrap-owned facts that have not been
 * asserted yet.
 */
export function bootstrap<const T extends Record<string, AnyTypeOutput>>(
  store: GraphStore,
  definitions: T,
  options: GraphBootstrapOptions = {},
): void {
  store.batch(() => {
    const coreSchema = options.coreSchema ?? requireGraphBootstrapCoreSchema(definitions);
    const bootstrapTimestamp = cloneBootstrapTimestamp(options.timestamp);
    const orderedTypes = Object.values(definitions).sort((left, right) =>
      compareBootstrapTypeOrder(left, right, typeId(coreSchema.type)),
    );
    const resolutionTypeById = createResolutionTypeById(orderedTypes, options.availableDefinitions);
    const resolutionTypes = [...resolutionTypeById.values()];
    const entities = orderedTypes.filter(isEntityType);
    const enums = orderedTypes.filter(isEnumType);
    const allPredicates = entities.flatMap((typeDef) => collectPredicates(typeDef.fields));
    const allShapes = entities.flatMap((typeDef) => collectShapeNodes(typeDef.fields));
    const resolutionPredicates = resolutionTypes
      .filter(isEntityType)
      .flatMap((typeDef) => collectPredicates(typeDef.fields));
    const resolveIconSeed = createBootstrapIconSeedLookup(
      resolutionTypes,
      resolutionPredicates,
      options,
    );
    const resolvedTypeIconIds = new Map<string, string>();
    const resolvedPredicateIconIds = new Map<string, string>();
    const referencedIconIds = new Set<string>();
    const keyPredicateId = edgeId(coreSchema.predicate.fields.key);
    const namePredicateId = edgeId(coreSchema.node.fields.name);
    const descriptionPredicateId = edgeId(coreSchema.node.fields.description);
    const rangePredicateId = edgeId(coreSchema.predicate.fields.range);
    const cardinalityPredicateId = edgeId(coreSchema.predicate.fields.cardinality);
    const typeIconPredicateId = edgeId(coreSchema.type.fields.icon);
    const predicateIconPredicateId = edgeId(coreSchema.predicate.fields.icon);
    const enumMemberPredicateId = edgeId(coreSchema.enum.fields.member);
    const nodeTypePredicateId = edgeId(coreSchema.node.fields.type);
    const schemaTypeId = typeId(coreSchema.type);
    const predicateTypeId = typeId(coreSchema.predicate);
    const cardinalityValueByLiteral = {
      many: coreSchema.cardinality.values.many.id,
      one: coreSchema.cardinality.values.one.id,
      "one?": coreSchema.cardinality.values.oneOptional.id,
    } as const;
    const bootstrapFacts = createBootstrapFacts(store);

    for (const typeDef of orderedTypes) {
      const iconId = resolveBootstrapTypeIconId(typeDef, options);
      if (!iconId) continue;
      resolvedTypeIconIds.set(typeId(typeDef), iconId);
      referencedIconIds.add(iconId);
    }

    for (const predicateDef of allPredicates) {
      const iconId = resolveBootstrapPredicateIconId(
        store,
        predicateDef,
        resolutionTypeById.get(predicateDef.range),
        options,
        typeIconPredicateId,
      );
      if (!iconId) continue;
      resolvedPredicateIconIds.set(edgeId(predicateDef), iconId);
      referencedIconIds.add(iconId);
    }

    for (const iconId of referencedIconIds) {
      const seed = resolveIconSeed(iconId);
      if (!seed) continue;
      seedBootstrapIcon(
        store,
        bootstrapFacts,
        coreSchema,
        seed,
        bootstrapTimestamp,
        resolutionTypeById,
      );
    }

    for (const typeDef of orderedTypes) {
      const subjectId = typeId(typeDef);
      if (!bootstrapFacts.existingNodeIds.has(subjectId)) {
        assertBootstrapManagedTimestampsOnce(
          store,
          bootstrapFacts,
          subjectId,
          coreSchema,
          bootstrapTimestamp,
          resolutionTypeById,
        );
      }

      assertCurrentFactOnce(store, bootstrapFacts, subjectId, keyPredicateId, typeDef.values.key);
      if (typeDef.values.name) {
        assertCurrentFactOnce(
          store,
          bootstrapFacts,
          subjectId,
          namePredicateId,
          typeDef.values.name,
        );
      }
      assertCurrentFactOnce(store, bootstrapFacts, subjectId, nodeTypePredicateId, schemaTypeId);

      const typeIconId = resolvedTypeIconIds.get(subjectId);
      if (typeIconId && bootstrapFacts.existingNodeIds.has(typeIconId)) {
        assertCurrentFactOnce(store, bootstrapFacts, subjectId, typeIconPredicateId, typeIconId);
      }
    }

    for (const shape of allShapes) {
      assertCurrentFactOnce(store, bootstrapFacts, shape.id, keyPredicateId, shape.key);
    }

    for (const predicateDef of allPredicates) {
      const predicateId = edgeId(predicateDef);
      const cardinalityValueId = cardinalityValueByLiteral[predicateDef.cardinality];
      if (!cardinalityValueId) {
        throw new Error(
          `Unknown cardinality "${predicateDef.cardinality}" for "${predicateDef.key}"`,
        );
      }

      if (!bootstrapFacts.existingNodeIds.has(predicateId)) {
        assertBootstrapManagedTimestampsOnce(
          store,
          bootstrapFacts,
          predicateId,
          coreSchema,
          bootstrapTimestamp,
          resolutionTypeById,
        );
      }

      assertCurrentFactOnce(store, bootstrapFacts, predicateId, keyPredicateId, predicateDef.key);
      assertCurrentFactOnce(store, bootstrapFacts, predicateId, namePredicateId, predicateDef.key);
      assertCurrentFactOnce(
        store,
        bootstrapFacts,
        predicateId,
        rangePredicateId,
        predicateDef.range,
      );
      assertCurrentFactOnce(
        store,
        bootstrapFacts,
        predicateId,
        cardinalityPredicateId,
        cardinalityValueId,
      );
      assertCurrentFactOnce(
        store,
        bootstrapFacts,
        predicateId,
        nodeTypePredicateId,
        predicateTypeId,
      );

      const predicateIconId = resolvedPredicateIconIds.get(predicateId);
      if (predicateIconId && bootstrapFacts.existingNodeIds.has(predicateIconId)) {
        assertCurrentFactOnce(
          store,
          bootstrapFacts,
          predicateId,
          predicateIconPredicateId,
          predicateIconId,
        );
      }
    }

    for (const enumDef of enums) {
      const enumId = typeId(enumDef);
      for (const option of Object.values(enumDef.options)) {
        const optionId = option.id ?? option.key;
        if (!bootstrapFacts.existingNodeIds.has(optionId)) {
          assertBootstrapManagedTimestampsOnce(
            store,
            bootstrapFacts,
            optionId,
            coreSchema,
            bootstrapTimestamp,
            resolutionTypeById,
          );
        }

        assertCurrentFactOnce(store, bootstrapFacts, optionId, keyPredicateId, option.key);
        if (option.name) {
          assertCurrentFactOnce(store, bootstrapFacts, optionId, namePredicateId, option.name);
        }
        if (option.description) {
          assertCurrentFactOnce(
            store,
            bootstrapFacts,
            optionId,
            descriptionPredicateId,
            option.description,
          );
        }
        assertCurrentFactOnce(store, bootstrapFacts, optionId, nodeTypePredicateId, schemaTypeId);
        assertCurrentFactOnce(store, bootstrapFacts, enumId, enumMemberPredicateId, optionId);
      }
    }
  });
}
