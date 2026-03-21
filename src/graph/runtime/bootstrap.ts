import {
  graphIconSeedList,
  resolvePredicateDefinitionIconId,
  resolveTypeDefinitionIconId,
} from "../modules/core/icon/seed.js";
import { createEntityWithId, type CreateInputOfType } from "./client.js";
import { core } from "./core.js";
import {
  edgeId,
  fieldTreeId,
  fieldTreeKey,
  isEntityType,
  isEnumType,
  isFieldsOutput,
  typeId,
} from "./schema.js";
import type { AnyTypeOutput, EdgeOutput, FieldsOutput, TypeOutput } from "./schema.js";
import { cloneStoreSnapshot, createStore, type Store, type StoreSnapshot } from "./store.js";

type SchemaTree = FieldsOutput;
const bootstrapTimestamp = new Date("2000-01-01T00:00:00.000Z");
const bootstrappedSnapshotCache = new WeakMap<Record<string, AnyTypeOutput>, StoreSnapshot>();

type BootstrapFacts = {
  readonly currentFactKeys: Set<string>;
  readonly existingNodeIds: Set<string>;
};

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
    for (const [_name, value] of Object.entries(node)) {
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
    for (const [_name, value] of Object.entries(node)) {
      if (isTreeNode(value)) walk(value as SchemaTree);
    }
  }
  walk(tree);
  return out;
}

function compareBootstrapTypeOrder(left: AnyTypeOutput, right: AnyTypeOutput): number {
  const coreTypeId = typeId(core.type);
  if (typeId(left) === coreTypeId) return -1;
  if (typeId(right) === coreTypeId) return 1;
  return 0;
}

function bootstrapFactKey(subjectId: string, predicateId: string, objectId: string): string {
  return `${subjectId}\0${predicateId}\0${objectId}`;
}

function rememberBootstrapNodeFacts(
  store: Store,
  bootstrapFacts: BootstrapFacts,
  nodeId: string,
): void {
  for (const edge of store.facts(nodeId)) {
    bootstrapFacts.existingNodeIds.add(edge.s);
    bootstrapFacts.currentFactKeys.add(bootstrapFactKey(edge.s, edge.p, edge.o));
  }
}

function assertCurrentFactOnce(
  store: Store,
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

function ensureBootstrapEntity<T extends TypeOutput>(
  store: Store,
  bootstrapFacts: BootstrapFacts,
  namespace: Record<string, AnyTypeOutput>,
  typeDef: T,
  id: string,
  input: CreateInputOfType<T, Record<string, AnyTypeOutput>>,
): void {
  if (bootstrapFacts.existingNodeIds.has(id)) return;
  const nextInput =
    "createdAt" in typeDef.fields && "updatedAt" in typeDef.fields
      ? ({
          ...input,
          createdAt: new Date(bootstrapTimestamp.getTime()),
          updatedAt: new Date(bootstrapTimestamp.getTime()),
        } as CreateInputOfType<T, Record<string, AnyTypeOutput>>)
      : input;
  createEntityWithId(store, namespace, typeDef, id, nextInput);
  rememberBootstrapNodeFacts(store, bootstrapFacts, id);
}

function assertSeedIcons(
  store: Store,
  namespace: Record<string, AnyTypeOutput>,
  bootstrapFacts: BootstrapFacts,
): void {
  const iconKeyPredicateId = edgeId(core.icon.fields.key);
  const namePredicateId = edgeId(core.node.fields.name);
  const nodeTypePredicateId = edgeId(core.node.fields.type);
  const iconTypeId = typeId(core.icon);

  for (const icon of graphIconSeedList) {
    ensureBootstrapEntity(store, bootstrapFacts, namespace, core.icon, icon.id, {
      key: icon.key,
      name: icon.name,
      svg: icon.svg,
    });
    assertCurrentFactOnce(store, bootstrapFacts, icon.id, iconKeyPredicateId, icon.key);
    assertCurrentFactOnce(store, bootstrapFacts, icon.id, namePredicateId, icon.name);
    assertCurrentFactOnce(store, bootstrapFacts, icon.id, nodeTypePredicateId, iconTypeId);
  }
}

export function bootstrap(store: Store, types: Record<string, AnyTypeOutput> = core): void {
  store.batch(() => {
    const namespace = { ...core, ...types };
    const orderedTypes = Object.values(types).sort(compareBootstrapTypeOrder);
    const typeById = new Map(
      [...Object.values(core), ...Object.values(types)].map((typeDef) => [
        typeId(typeDef),
        typeDef,
      ]),
    );
    const entities = Object.values(types).filter(isEntityType);
    const enums = Object.values(types).filter(isEnumType);
    const allPredicates = entities.flatMap((typeDef) => collectPredicates(typeDef.fields));
    const allShapes = entities.flatMap((typeDef) => collectShapeNodes(typeDef.fields));
    const keyPredicateId = edgeId(core.predicate.fields.key);
    const namePredicateId = edgeId(core.node.fields.name);
    const descriptionPredicateId = edgeId(core.node.fields.description);
    const rangePredicateId = edgeId(core.predicate.fields.range);
    const cardinalityPredicateId = edgeId(core.predicate.fields.cardinality);
    const typeIconPredicateId = edgeId(core.type.fields.icon);
    const predicateIconPredicateId = edgeId(core.predicate.fields.icon);
    const enumMemberPredicateId = edgeId(core.enum.fields.member);
    const nodeTypePredicateId = edgeId(core.node.fields.type);
    const schemaTypeId = typeId(core.type);
    const predicateTypeId = typeId(core.predicate);
    const cardinalityValueByLiteral: Record<string, string> = {
      one: core.cardinality.values.one.id,
      "one?": core.cardinality.values.oneOptional.id,
      many: core.cardinality.values.many.id,
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
      const subjectId = typeId(typeDef);
      ensureBootstrapEntity(store, bootstrapFacts, namespace, core.type, subjectId, {
        name: typeDef.values.name ?? typeDef.values.key,
      });
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
    }

    assertSeedIcons(store, namespace, bootstrapFacts);

    for (const typeDef of orderedTypes) {
      assertCurrentFactOnce(
        store,
        bootstrapFacts,
        typeId(typeDef),
        typeIconPredicateId,
        resolveTypeDefinitionIconId(typeDef),
      );
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
      ensureBootstrapEntity(store, bootstrapFacts, namespace, core.predicate, predicateId, {
        key: predicateDef.key,
        name: predicateDef.key,
        range: predicateDef.range,
        cardinality: cardinalityValueId,
        icon: resolvePredicateDefinitionIconId(predicateDef, typeById.get(predicateDef.range)),
      });
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
        predicateIconPredicateId,
        resolvePredicateDefinitionIconId(predicateDef, typeById.get(predicateDef.range)),
      );
      assertCurrentFactOnce(
        store,
        bootstrapFacts,
        predicateId,
        nodeTypePredicateId,
        predicateTypeId,
      );
    }

    for (const enumDef of enums) {
      const enumId = typeId(enumDef);
      for (const option of Object.values(enumDef.options)) {
        const optionId = option.id ?? option.key;
        ensureBootstrapEntity(store, bootstrapFacts, namespace, core.type, optionId, {
          name: option.name ?? option.key,
        });
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

export function createBootstrappedSnapshot(
  types: Record<string, AnyTypeOutput> = core,
): StoreSnapshot {
  const cached = bootstrappedSnapshotCache.get(types);
  if (cached) return cloneStoreSnapshot(cached);

  const store = createStore();
  bootstrap(store, core);
  if (types !== core) bootstrap(store, types);

  const snapshot = store.snapshot();
  bootstrappedSnapshotCache.set(types, snapshot);
  return cloneStoreSnapshot(snapshot);
}
