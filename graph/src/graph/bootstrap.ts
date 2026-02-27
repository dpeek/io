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
import type { AnyTypeOutput, EdgeOutput, FieldsOutput } from "./schema.js";
import type { Store } from "./store.js";

type SchemaTree = FieldsOutput;

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

export function bootstrap(store: Store, types: Record<string, AnyTypeOutput> = core): void {
  const entities = Object.values(types).filter(isEntityType);
  const enums = Object.values(types).filter(isEnumType);
  const allPredicates = entities.flatMap((typeDef) => collectPredicates(typeDef.fields));
  const allShapes = entities.flatMap((typeDef) => collectShapeNodes(typeDef.fields));
  const keyPredicateId = edgeId(core.predicate.fields.key);
  const namePredicateId = edgeId(core.node.fields.name);
  const descriptionPredicateId = edgeId(core.node.fields.description);
  const rangePredicateId = edgeId(core.predicate.fields.range);
  const cardinalityPredicateId = edgeId(core.predicate.fields.cardinality);
  const enumMemberPredicateId = edgeId(core.enum.fields.member);
  const nodeTypePredicateId = edgeId(core.node.fields.type);
  const schemaTypeId = typeId(core.type);
  const predicateTypeId = typeId(core.predicate);
  const cardinalityValueByLiteral: Record<string, string> = {
    one: core.cardinality.values.one.id,
    "one?": core.cardinality.values.oneOptional.id,
    many: core.cardinality.values.many.id,
  };

  for (const typeDef of Object.values(types)) {
    const subjectId = typeId(typeDef);
    store.assert(subjectId, keyPredicateId, typeDef.values.key);
    if (typeDef.values.name) store.assert(subjectId, namePredicateId, typeDef.values.name);
    store.assert(subjectId, nodeTypePredicateId, schemaTypeId);
  }

  for (const shape of allShapes) {
    store.assert(shape.id, keyPredicateId, shape.key);
  }

  for (const predicateDef of allPredicates) {
    const predicateId = edgeId(predicateDef);
    store.assert(predicateId, keyPredicateId, predicateDef.key);
    store.assert(predicateId, namePredicateId, predicateDef.key);
    store.assert(predicateId, rangePredicateId, predicateDef.range);
    const cardinalityValueId = cardinalityValueByLiteral[predicateDef.cardinality];
    if (!cardinalityValueId) {
      throw new Error(
        `Unknown cardinality "${predicateDef.cardinality}" for "${predicateDef.key}"`,
      );
    }
    store.assert(predicateId, cardinalityPredicateId, cardinalityValueId);
    store.assert(predicateId, nodeTypePredicateId, predicateTypeId);
  }

  for (const enumDef of enums) {
    const enumId = typeId(enumDef);
    for (const option of Object.values(enumDef.options)) {
      const optionId = option.id ?? option.key;
      store.assert(optionId, keyPredicateId, option.key);
      if (option.name) store.assert(optionId, namePredicateId, option.name);
      if (option.description) {
        store.assert(optionId, descriptionPredicateId, option.description);
      }
      store.assert(optionId, nodeTypePredicateId, schemaTypeId);
      store.assert(enumId, enumMemberPredicateId, optionId);
    }
  }
}
