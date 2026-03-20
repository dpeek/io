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
import type { Store } from "./store.js";

type SchemaTree = FieldsOutput;
const bootstrapTimestamp = new Date("2000-01-01T00:00:00.000Z");

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

function assertCurrentFactOnce(
  store: Store,
  subjectId: string,
  predicateId: string,
  objectId: string,
): void {
  if (store.facts(subjectId, predicateId, objectId).length > 0) return;
  store.assert(subjectId, predicateId, objectId);
}

function ensureBootstrapEntity<T extends TypeOutput>(
  store: Store,
  namespace: Record<string, AnyTypeOutput>,
  typeDef: T,
  id: string,
  input: CreateInputOfType<T, Record<string, AnyTypeOutput>>,
): void {
  if (store.facts(id).length > 0) return;
  const nextInput =
    "createdAt" in typeDef.fields && "updatedAt" in typeDef.fields
      ? ({
          ...input,
          createdAt: new Date(bootstrapTimestamp.getTime()),
          updatedAt: new Date(bootstrapTimestamp.getTime()),
        } as CreateInputOfType<T, Record<string, AnyTypeOutput>>)
      : input;
  createEntityWithId(store, namespace, typeDef, id, nextInput);
}

function assertSeedIcons(store: Store, namespace: Record<string, AnyTypeOutput>): void {
  const iconKeyPredicateId = edgeId(core.icon.fields.key);
  const namePredicateId = edgeId(core.node.fields.name);
  const nodeTypePredicateId = edgeId(core.node.fields.type);
  const iconTypeId = typeId(core.icon);

  for (const icon of graphIconSeedList) {
    ensureBootstrapEntity(store, namespace, core.icon, icon.id, {
      key: icon.key,
      name: icon.name,
      svg: icon.svg,
    });
    assertCurrentFactOnce(store, icon.id, iconKeyPredicateId, icon.key);
    assertCurrentFactOnce(store, icon.id, namePredicateId, icon.name);
    assertCurrentFactOnce(store, icon.id, nodeTypePredicateId, iconTypeId);
  }
}

export function bootstrap(store: Store, types: Record<string, AnyTypeOutput> = core): void {
  const namespace = { ...core, ...types };
  const orderedTypes = Object.values(types).sort(compareBootstrapTypeOrder);
  const typeById = new Map(
    [...Object.values(core), ...Object.values(types)].map((typeDef) => [typeId(typeDef), typeDef]),
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

  for (const typeDef of orderedTypes) {
    const subjectId = typeId(typeDef);
    ensureBootstrapEntity(store, namespace, core.type, subjectId, {
      name: typeDef.values.name ?? typeDef.values.key,
    });
    assertCurrentFactOnce(store, subjectId, keyPredicateId, typeDef.values.key);
    if (typeDef.values.name) {
      assertCurrentFactOnce(store, subjectId, namePredicateId, typeDef.values.name);
    }
    assertCurrentFactOnce(store, subjectId, nodeTypePredicateId, schemaTypeId);
  }

  assertSeedIcons(store, namespace);

  for (const typeDef of orderedTypes) {
    assertCurrentFactOnce(
      store,
      typeId(typeDef),
      typeIconPredicateId,
      resolveTypeDefinitionIconId(typeDef),
    );
  }

  for (const shape of allShapes) {
    assertCurrentFactOnce(store, shape.id, keyPredicateId, shape.key);
  }

  for (const predicateDef of allPredicates) {
    const predicateId = edgeId(predicateDef);
    const cardinalityValueId = cardinalityValueByLiteral[predicateDef.cardinality];
    if (!cardinalityValueId) {
      throw new Error(
        `Unknown cardinality "${predicateDef.cardinality}" for "${predicateDef.key}"`,
      );
    }
    ensureBootstrapEntity(store, namespace, core.predicate, predicateId, {
      key: predicateDef.key,
      name: predicateDef.key,
      range: predicateDef.range,
      cardinality: cardinalityValueId,
      icon: resolvePredicateDefinitionIconId(predicateDef, typeById.get(predicateDef.range)),
    });
    assertCurrentFactOnce(store, predicateId, keyPredicateId, predicateDef.key);
    assertCurrentFactOnce(store, predicateId, namePredicateId, predicateDef.key);
    assertCurrentFactOnce(store, predicateId, rangePredicateId, predicateDef.range);
    assertCurrentFactOnce(store, predicateId, cardinalityPredicateId, cardinalityValueId);
    assertCurrentFactOnce(
      store,
      predicateId,
      predicateIconPredicateId,
      resolvePredicateDefinitionIconId(predicateDef, typeById.get(predicateDef.range)),
    );
    assertCurrentFactOnce(store, predicateId, nodeTypePredicateId, predicateTypeId);
  }

  for (const enumDef of enums) {
    const enumId = typeId(enumDef);
    for (const option of Object.values(enumDef.options)) {
      const optionId = option.id ?? option.key;
      ensureBootstrapEntity(store, namespace, core.type, optionId, {
        name: option.name ?? option.key,
      });
      assertCurrentFactOnce(store, optionId, keyPredicateId, option.key);
      if (option.name) assertCurrentFactOnce(store, optionId, namePredicateId, option.name);
      if (option.description) {
        assertCurrentFactOnce(store, optionId, descriptionPredicateId, option.description);
      }
      assertCurrentFactOnce(store, optionId, nodeTypePredicateId, schemaTypeId);
      assertCurrentFactOnce(store, enumId, enumMemberPredicateId, optionId);
    }
  }
}
