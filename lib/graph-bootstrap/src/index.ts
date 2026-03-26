import {
  cloneGraphStoreSnapshot,
  createGraphStore,
  edgeId,
  fieldTreeId,
  fieldTreeKey,
  isEntityType,
  isEnumType,
  isFieldsOutput,
  isScalarType,
  typeId,
  type AnyTypeOutput,
  type EdgeOutput,
  type FieldsOutput,
  type GraphStore,
  type GraphStoreSnapshot,
} from "@io/graph-kernel";

import { requireGraphBootstrapCoreSchema, type GraphBootstrapCoreSchema } from "./core-schema.js";

type SchemaTree = FieldsOutput;
type DefinitionIconRef = string | { id: string };

type BootstrapFacts = {
  readonly currentFactKeys: Set<string>;
  readonly existingNodeIds: Set<string>;
};

export type GraphBootstrapIconSeed = Readonly<{
  id: string;
  key: string;
  name: string;
  svg: string;
}>;

export type GraphBootstrapTypeIconResolver = (
  typeDef: Pick<AnyTypeOutput, "kind" | "values">,
) => string | undefined;

export type GraphBootstrapPredicateIconResolver = (
  predicateDef: Pick<EdgeOutput, "icon" | "range">,
  rangeType?: Pick<AnyTypeOutput, "kind" | "values">,
) => string | undefined;

export type GraphBootstrapIconSeedResolver = (iconId: string) => GraphBootstrapIconSeed | undefined;

export type GraphBootstrapOptions = {
  /**
   * Additional definitions available for icon and scalar resolution when the
   * bootstrapped slice itself does not include every referenced type.
   */
  readonly availableDefinitions?: Record<string, AnyTypeOutput>;
  /**
   * Stable object identity used for snapshot cache hits when callers provide a
   * reusable bootstrap configuration.
   */
  readonly cacheKey?: object;
  /**
   * Explicit core schema contract for bootstrap flows whose definition slice
   * does not include the core namespace directly.
   */
  readonly coreSchema?: GraphBootstrapCoreSchema;
  /**
   * Concrete icon records owned by the caller's domain.
   */
  readonly iconSeeds?: readonly GraphBootstrapIconSeed[];
  /**
   * Optional per-id seed lookup for installable or remapped icon catalogs.
   */
  readonly resolveIconSeed?: GraphBootstrapIconSeedResolver;
  /**
   * Optional type-icon resolver. When omitted, bootstrap only links explicit
   * icon refs already authored on the type definition.
   */
  readonly resolveTypeIconId?: GraphBootstrapTypeIconResolver;
  /**
   * Optional predicate-icon resolver. When omitted, bootstrap only links
   * explicit predicate icon refs or existing range-type icon links.
   */
  readonly resolvePredicateIconId?: GraphBootstrapPredicateIconResolver;
  /**
   * Canonical timestamps applied to bootstrap-created schema entities when the
   * core node contract exposes managed timestamps.
   */
  readonly timestamp?: Date;
};

const defaultBootstrapTimestamp = new Date("2000-01-01T00:00:00.000Z");
const defaultBootstrapCacheKey = Object.freeze({});
const bootstrappedSnapshotCache = new WeakMap<
  Record<string, AnyTypeOutput>,
  WeakMap<object, GraphStoreSnapshot>
>();

function cloneBootstrapTimestamp(timestamp: Date | undefined): Date {
  return new Date((timestamp ?? defaultBootstrapTimestamp).getTime());
}

function isDefinitionIconObject(value: DefinitionIconRef | undefined): value is { id: string } {
  return typeof value === "object" && value !== null && typeof value.id === "string";
}

function readDefinitionIconId(value: DefinitionIconRef | undefined): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (isDefinitionIconObject(value) && value.id.length > 0) return value.id;
  return undefined;
}

function isBootstrapIconSeed(value: unknown): value is GraphBootstrapIconSeed {
  const candidate = value as Partial<GraphBootstrapIconSeed> | undefined;
  return (
    typeof candidate?.id === "string" &&
    typeof candidate.key === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.svg === "string"
  );
}

function readDefinitionIconSeed(
  value: DefinitionIconRef | undefined,
): GraphBootstrapIconSeed | undefined {
  return isBootstrapIconSeed(value) ? value : undefined;
}

function isPredicateDef(value: unknown): value is EdgeOutput {
  const candidate = value as Partial<EdgeOutput>;
  return typeof candidate.key === "string" && typeof candidate.range === "string";
}

function isTreeNode(value: unknown): value is SchemaTree {
  return isFieldsOutput(value);
}

function collectPredicates(tree: SchemaTree): EdgeOutput[] {
  const out: EdgeOutput[] = [];

  function walk(node: SchemaTree): void {
    for (const value of Object.values(node)) {
      if (isPredicateDef(value)) {
        out.push(value);
        continue;
      }
      if (isTreeNode(value)) walk(value);
    }
  }

  walk(tree);
  return out;
}

function collectShapeNodes(tree: SchemaTree): Array<{ id: string; key: string }> {
  const out: Array<{ id: string; key: string }> = [];

  function walk(node: SchemaTree): void {
    out.push({ id: fieldTreeId(node), key: fieldTreeKey(node) });
    for (const value of Object.values(node)) {
      if (isTreeNode(value)) walk(value);
    }
  }

  walk(tree);
  return out;
}

function compareBootstrapTypeOrder(left: AnyTypeOutput, right: AnyTypeOutput, coreTypeId: string) {
  if (typeId(left) === coreTypeId) return -1;
  if (typeId(right) === coreTypeId) return 1;
  return 0;
}

function bootstrapFactKey(subjectId: string, predicateId: string, objectId: string): string {
  return `${subjectId}\0${predicateId}\0${objectId}`;
}

function assertCurrentFactOnce(
  store: GraphStore,
  bootstrapFacts: BootstrapFacts,
  subjectId: string,
  predicateId: string,
  objectId: string,
): void {
  const factKey = bootstrapFactKey(subjectId, predicateId, objectId);
  if (bootstrapFacts.currentFactKeys.has(factKey)) return;
  store.assert(subjectId, predicateId, objectId);
  bootstrapFacts.existingNodeIds.add(subjectId);
  bootstrapFacts.currentFactKeys.add(factKey);
}

function encodeBootstrapValue(
  value: string | Date,
  rangeId: string,
  typeById: ReadonlyMap<string, AnyTypeOutput>,
): string {
  if (typeof value === "string") return value;
  const rangeType = typeById.get(rangeId);
  if (rangeType && isScalarType(rangeType)) {
    return rangeType.encode(value);
  }
  return value.toISOString();
}

function assertBootstrapManagedTimestampsOnce(
  store: GraphStore,
  bootstrapFacts: BootstrapFacts,
  nodeId: string,
  coreSchema: GraphBootstrapCoreSchema,
  bootstrapTimestamp: Date,
  typeById: ReadonlyMap<string, AnyTypeOutput>,
): void {
  const createdAt = coreSchema.node.fields.createdAt;
  const updatedAt = coreSchema.node.fields.updatedAt;
  if (!createdAt || !updatedAt) return;

  assertCurrentFactOnce(
    store,
    bootstrapFacts,
    nodeId,
    edgeId(createdAt),
    encodeBootstrapValue(bootstrapTimestamp, createdAt.range, typeById),
  );
  assertCurrentFactOnce(
    store,
    bootstrapFacts,
    nodeId,
    edgeId(updatedAt),
    encodeBootstrapValue(bootstrapTimestamp, updatedAt.range, typeById),
  );
}

function collectInlineIconSeeds(
  types: readonly AnyTypeOutput[],
  predicates: readonly EdgeOutput[],
): Map<string, GraphBootstrapIconSeed> {
  const seeds = new Map<string, GraphBootstrapIconSeed>();

  for (const typeDef of types) {
    const seed = readDefinitionIconSeed(typeDef.values.icon);
    if (seed) seeds.set(seed.id, seed);
  }

  for (const predicateDef of predicates) {
    const seed = readDefinitionIconSeed(predicateDef.icon);
    if (seed) seeds.set(seed.id, seed);
  }

  return seeds;
}

function createBootstrapIconSeedLookup(
  types: readonly AnyTypeOutput[],
  predicates: readonly EdgeOutput[],
  options: GraphBootstrapOptions,
): GraphBootstrapIconSeedResolver {
  const inlineSeeds = collectInlineIconSeeds(types, predicates);
  const seedById = new Map<string, GraphBootstrapIconSeed>(inlineSeeds);

  for (const seed of options.iconSeeds ?? []) {
    seedById.set(seed.id, seed);
  }

  return (iconId) => seedById.get(iconId) ?? options.resolveIconSeed?.(iconId);
}

function resolveBootstrapTypeIconId(
  typeDef: AnyTypeOutput,
  options: GraphBootstrapOptions,
): string | undefined {
  return options.resolveTypeIconId?.(typeDef) ?? readDefinitionIconId(typeDef.values.icon);
}

function resolveBootstrapPredicateIconId(
  store: GraphStore,
  predicateDef: EdgeOutput,
  rangeType: AnyTypeOutput | undefined,
  options: GraphBootstrapOptions,
  typeIconPredicateId: string,
): string | undefined {
  const explicitIconId = readDefinitionIconId(predicateDef.icon);
  if (explicitIconId) {
    return options.resolvePredicateIconId?.(predicateDef, rangeType) ?? explicitIconId;
  }

  if (!rangeType) {
    const existingRangeIcon = store.facts(predicateDef.range, typeIconPredicateId)[0]?.o;
    if (typeof existingRangeIcon === "string" && existingRangeIcon.length > 0) {
      return existingRangeIcon;
    }
  }

  return options.resolvePredicateIconId?.(predicateDef, rangeType);
}

function seedBootstrapIcon(
  store: GraphStore,
  bootstrapFacts: BootstrapFacts,
  coreSchema: GraphBootstrapCoreSchema,
  iconSeed: GraphBootstrapIconSeed,
  bootstrapTimestamp: Date,
  typeById: ReadonlyMap<string, AnyTypeOutput>,
): void {
  const shouldSeedManagedTimestamps = !bootstrapFacts.existingNodeIds.has(iconSeed.id);
  if (shouldSeedManagedTimestamps) {
    assertBootstrapManagedTimestampsOnce(
      store,
      bootstrapFacts,
      iconSeed.id,
      coreSchema,
      bootstrapTimestamp,
      typeById,
    );
  }

  const iconTypeId = typeId(coreSchema.icon);
  const iconKeyPredicateId = edgeId(coreSchema.icon.fields.key);
  const iconSvgPredicateId = edgeId(coreSchema.icon.fields.svg);
  const namePredicateId = edgeId(coreSchema.node.fields.name);
  const nodeTypePredicateId = edgeId(coreSchema.node.fields.type);

  assertCurrentFactOnce(store, bootstrapFacts, iconSeed.id, iconKeyPredicateId, iconSeed.key);
  assertCurrentFactOnce(store, bootstrapFacts, iconSeed.id, iconSvgPredicateId, iconSeed.svg);
  assertCurrentFactOnce(store, bootstrapFacts, iconSeed.id, namePredicateId, iconSeed.name);
  assertCurrentFactOnce(store, bootstrapFacts, iconSeed.id, nodeTypePredicateId, iconTypeId);
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
    const resolutionTypeById = new Map<string, AnyTypeOutput>();
    for (const typeDef of Object.values(options.availableDefinitions ?? {})) {
      resolutionTypeById.set(typeId(typeDef), typeDef);
    }
    for (const typeDef of orderedTypes) {
      resolutionTypeById.set(typeId(typeDef), typeDef);
    }
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
    const cardinalityValueByLiteral: Record<"one" | "one?" | "many", string> = {
      one: coreSchema.cardinality.values.one.id,
      "one?": coreSchema.cardinality.values.oneOptional.id,
      many: coreSchema.cardinality.values.many.id,
    };
    const bootstrapFacts: BootstrapFacts = {
      currentFactKeys: new Set<string>(),
      existingNodeIds: new Set<string>(),
    };

    for (const edge of store.facts()) {
      bootstrapFacts.existingNodeIds.add(edge.s);
      bootstrapFacts.currentFactKeys.add(bootstrapFactKey(edge.s, edge.p, edge.o));
    }

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
      const shouldSeedManagedTimestamps = !bootstrapFacts.existingNodeIds.has(subjectId);
      if (shouldSeedManagedTimestamps) {
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

      const shouldSeedManagedTimestamps = !bootstrapFacts.existingNodeIds.has(predicateId);
      if (shouldSeedManagedTimestamps) {
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
        const shouldSeedManagedTimestamps = !bootstrapFacts.existingNodeIds.has(optionId);
        if (shouldSeedManagedTimestamps) {
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

/**
 * Creates a convergent schema snapshot suitable for local graph clients, sync
 * replay, and other client-safe bootstrap flows.
 */
export function createBootstrappedSnapshot<const T extends Record<string, AnyTypeOutput>>(
  definitions: T,
  options: GraphBootstrapOptions = {},
): GraphStoreSnapshot {
  const cacheKey =
    options.cacheKey ?? (Object.keys(options).length === 0 ? defaultBootstrapCacheKey : options);
  const shouldUseCache = options.timestamp === undefined;
  const cachedByDefinitions = shouldUseCache
    ? bootstrappedSnapshotCache.get(definitions)
    : undefined;
  const cached = shouldUseCache ? cachedByDefinitions?.get(cacheKey) : undefined;
  if (cached) return cloneGraphStoreSnapshot(cached);

  const store = createGraphStore();
  bootstrap(store, definitions, options);

  const snapshot = store.snapshot();
  if (shouldUseCache) {
    const nextCache = cachedByDefinitions ?? new WeakMap<object, GraphStoreSnapshot>();
    nextCache.set(cacheKey, snapshot);
    if (!cachedByDefinitions) {
      bootstrappedSnapshotCache.set(definitions, nextCache);
    }
  }
  return cloneGraphStoreSnapshot(snapshot);
}

export { requireGraphBootstrapCoreSchema, type GraphBootstrapCoreSchema } from "./core-schema.js";
