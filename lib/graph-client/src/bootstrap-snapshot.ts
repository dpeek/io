import {
  cloneGraphStoreSnapshot,
  createGraphStore,
  edgeId,
  fieldTreeId,
  fieldTreeKey,
  isEntityType,
  isEnumType,
  isFieldsOutput,
  typeId,
  type AnyTypeOutput,
  type EdgeOutput,
  type FieldsOutput,
  type GraphStoreSnapshot,
  type TypeOutput,
} from "@io/graph-kernel";

import {
  graphIconSeedList,
  graphIconSeeds,
  resolvePredicateDefinitionIconId,
  resolveTypeDefinitionIconId,
} from "./bootstrap-icons.js";
import { requireGraphClientCoreSchema } from "./core.js";
import { createEntityWithId, type CreateInputOfType } from "./graph.js";

type SchemaTree = FieldsOutput;

type BootstrapFacts = {
  readonly currentFactKeys: Set<string>;
  readonly existingNodeIds: Set<string>;
};

/**
 * Snapshot bootstrap options for local and synced graph clients.
 *
 * The generated snapshot is intentionally client-oriented: it seeds the schema
 * entities, predicate nodes, field-tree shape ids, and enum members needed for
 * local validation and optimistic mutation replay.
 */
export type GraphClientBootstrapOptions = {
  /**
   * Canonical timestamps applied when seeded entities expose `createdAt` and
   * `updatedAt` fields. Keeping these stable makes repeated client bootstrap
   * snapshots convergent.
   */
  readonly timestamp?: Date;
};

const defaultBootstrapTimestamp = new Date("2000-01-01T00:00:00.000Z");
const bootstrappedSnapshotCache = new WeakMap<Record<string, AnyTypeOutput>, GraphStoreSnapshot>();
const graphIconSeedById = new Map<string, (typeof graphIconSeedList)[number]>(
  graphIconSeedList.map((seed) => [seed.id, seed]),
);

function cloneBootstrapTimestamp(timestamp: Date | undefined): Date {
  return new Date((timestamp ?? defaultBootstrapTimestamp).getTime());
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
      if (isTreeNode(value)) walk(value as SchemaTree);
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
      if (isTreeNode(value)) walk(value as SchemaTree);
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

function rememberBootstrapNodeFacts(
  store: ReturnType<typeof createGraphStore>,
  bootstrapFacts: BootstrapFacts,
  nodeId: string,
): void {
  for (const edge of store.facts(nodeId)) {
    bootstrapFacts.existingNodeIds.add(edge.s);
    bootstrapFacts.currentFactKeys.add(bootstrapFactKey(edge.s, edge.p, edge.o));
  }
}

function assertCurrentFactOnce(
  store: ReturnType<typeof createGraphStore>,
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

function withManagedTimestamps<T extends TypeOutput>(
  input: CreateInputOfType<T, Record<string, AnyTypeOutput>>,
  typeDef: T,
  timestamp: Date,
): CreateInputOfType<T, Record<string, AnyTypeOutput>> {
  if (!("createdAt" in typeDef.fields) || !("updatedAt" in typeDef.fields)) {
    return input;
  }

  return {
    ...input,
    createdAt: cloneBootstrapTimestamp(timestamp),
    updatedAt: cloneBootstrapTimestamp(timestamp),
  } as CreateInputOfType<T, Record<string, AnyTypeOutput>>;
}

function ensureBootstrapEntity<T extends TypeOutput>(
  store: ReturnType<typeof createGraphStore>,
  bootstrapFacts: BootstrapFacts,
  definitions: Record<string, AnyTypeOutput>,
  typeDef: T,
  id: string,
  input: CreateInputOfType<T, Record<string, AnyTypeOutput>>,
  timestamp: Date,
): void {
  if (bootstrapFacts.existingNodeIds.has(id)) return;
  createEntityWithId(
    store,
    definitions,
    typeDef,
    id,
    withManagedTimestamps(input, typeDef, timestamp),
  );
  rememberBootstrapNodeFacts(store, bootstrapFacts, id);
}

function deriveBootstrapIconSeed(id: string) {
  const known = graphIconSeedById.get(id);
  if (known) return known;

  const alias = id.startsWith("seed:icon:") ? id.slice("seed:icon:".length) : id;
  const name = alias
    .split(/[-_:]/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment[0]!.toUpperCase() + segment.slice(1))
    .join(" ");

  return {
    id,
    key: alias,
    name: name.length > 0 ? name : alias,
    svg: graphIconSeeds.unknown.svg,
  };
}

function collectReferencedIconIds(
  types: readonly AnyTypeOutput[],
  predicates: readonly EdgeOutput[],
): readonly string[] {
  const typeById = new Map(types.map((typeDef) => [typeId(typeDef), typeDef]));
  const iconIds = new Set<string>();

  for (const typeDef of types) {
    iconIds.add(resolveTypeDefinitionIconId(typeDef));
  }

  for (const predicateDef of predicates) {
    iconIds.add(resolvePredicateDefinitionIconId(predicateDef, typeById.get(predicateDef.range)));
  }

  return [...iconIds];
}

function seedBootstrapIcons(
  store: ReturnType<typeof createGraphStore>,
  bootstrapFacts: BootstrapFacts,
  definitions: Record<string, AnyTypeOutput>,
  iconIds: readonly string[],
  timestamp: Date,
): void {
  const coreSchema = requireGraphClientCoreSchema(definitions);
  const iconKeyPredicateId = edgeId(coreSchema.icon.fields.key);
  const namePredicateId = edgeId(coreSchema.node.fields.name);
  const nodeTypePredicateId = edgeId(coreSchema.node.fields.type);
  const iconTypeId = typeId(coreSchema.icon);

  for (const iconId of iconIds) {
    const seed = deriveBootstrapIconSeed(iconId);
    ensureBootstrapEntity(
      store,
      bootstrapFacts,
      definitions,
      coreSchema.icon,
      seed.id,
      {
        key: seed.key,
        name: seed.name,
        svg: seed.svg,
      } satisfies CreateInputOfType<typeof coreSchema.icon, Record<string, AnyTypeOutput>>,
      timestamp,
    );
    assertCurrentFactOnce(store, bootstrapFacts, seed.id, iconKeyPredicateId, seed.key);
    assertCurrentFactOnce(store, bootstrapFacts, seed.id, namePredicateId, seed.name);
    assertCurrentFactOnce(store, bootstrapFacts, seed.id, nodeTypePredicateId, iconTypeId);
  }
}

/**
 * Creates a schema bootstrap snapshot suitable for local typed clients and
 * synced client replay.
 *
 * Callers should pass definitions that already include the built-in core graph
 * schema when the namespace references it. The returned snapshot is convergent
 * across repeated calls for the same definitions object.
 */
export function createBootstrappedSnapshot<const T extends Record<string, AnyTypeOutput>>(
  definitions: T,
  options: GraphClientBootstrapOptions = {},
): GraphStoreSnapshot {
  const cached = bootstrappedSnapshotCache.get(definitions);
  if (cached && options.timestamp === undefined) return cloneGraphStoreSnapshot(cached);

  const coreSchema = requireGraphClientCoreSchema(definitions);
  const bootstrapTimestamp = cloneBootstrapTimestamp(options.timestamp);
  const store = createGraphStore();
  const orderedTypes = Object.values(definitions).sort((left, right) =>
    compareBootstrapTypeOrder(left, right, typeId(coreSchema.type)),
  );
  const typeById = new Map(orderedTypes.map((typeDef) => [typeId(typeDef), typeDef]));
  const entities = orderedTypes.filter(isEntityType);
  const enums = orderedTypes.filter(isEnumType);
  const allPredicates = entities.flatMap((typeDef) => collectPredicates(typeDef.fields));
  const allShapes = entities.flatMap((typeDef) => collectShapeNodes(typeDef.fields));
  const referencedIconIds = collectReferencedIconIds(orderedTypes, allPredicates);
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

  for (const typeDef of orderedTypes) {
    const subjectId = typeId(typeDef);
    ensureBootstrapEntity(
      store,
      bootstrapFacts,
      definitions,
      coreSchema.type,
      subjectId,
      {
        name: typeDef.values.name ?? typeDef.values.key,
      },
      bootstrapTimestamp,
    );
    assertCurrentFactOnce(store, bootstrapFacts, subjectId, keyPredicateId, typeDef.values.key);
    if (typeDef.values.name) {
      assertCurrentFactOnce(store, bootstrapFacts, subjectId, namePredicateId, typeDef.values.name);
    }
    assertCurrentFactOnce(store, bootstrapFacts, subjectId, nodeTypePredicateId, schemaTypeId);
  }

  seedBootstrapIcons(store, bootstrapFacts, definitions, referencedIconIds, bootstrapTimestamp);

  for (const typeDef of orderedTypes) {
    const typeIconId = resolveTypeDefinitionIconId(typeDef);
    assertCurrentFactOnce(store, bootstrapFacts, typeId(typeDef), typeIconPredicateId, typeIconId);
  }

  for (const shape of allShapes) {
    assertCurrentFactOnce(store, bootstrapFacts, shape.id, keyPredicateId, shape.key);
  }

  for (const predicateDef of allPredicates) {
    const predicateId = edgeId(predicateDef);
    const cardinalityValueId = cardinalityValueByLiteral[predicateDef.cardinality];
    ensureBootstrapEntity(
      store,
      bootstrapFacts,
      definitions,
      coreSchema.predicate,
      predicateId,
      {
        key: predicateDef.key,
        name: predicateDef.key,
        range: predicateDef.range,
        cardinality: cardinalityValueId,
        icon: resolvePredicateDefinitionIconId(predicateDef, typeById.get(predicateDef.range)),
      } satisfies CreateInputOfType<typeof coreSchema.predicate, Record<string, AnyTypeOutput>>,
      bootstrapTimestamp,
    );
    assertCurrentFactOnce(store, bootstrapFacts, predicateId, keyPredicateId, predicateDef.key);
    assertCurrentFactOnce(store, bootstrapFacts, predicateId, namePredicateId, predicateDef.key);
    assertCurrentFactOnce(store, bootstrapFacts, predicateId, rangePredicateId, predicateDef.range);
    assertCurrentFactOnce(
      store,
      bootstrapFacts,
      predicateId,
      cardinalityPredicateId,
      cardinalityValueId,
    );
    assertCurrentFactOnce(store, bootstrapFacts, predicateId, nodeTypePredicateId, predicateTypeId);

    const predicateIconId = resolvePredicateDefinitionIconId(
      predicateDef,
      typeById.get(predicateDef.range),
    );
    assertCurrentFactOnce(
      store,
      bootstrapFacts,
      predicateId,
      predicateIconPredicateId,
      predicateIconId,
    );
  }

  for (const enumDef of enums) {
    const enumId = typeId(enumDef);
    for (const option of Object.values(enumDef.options)) {
      const optionId = option.id ?? option.key;
      ensureBootstrapEntity(
        store,
        bootstrapFacts,
        definitions,
        coreSchema.type,
        optionId,
        {
          name: option.name ?? option.key,
        },
        bootstrapTimestamp,
      );
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

  const snapshot = store.snapshot();
  if (options.timestamp === undefined) bootstrappedSnapshotCache.set(definitions, snapshot);
  return cloneGraphStoreSnapshot(snapshot);
}
