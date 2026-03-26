import type { AnyTypeOutput, EdgeOutput, EntityTypeOutput } from "@io/graph-kernel";

export type GraphBootstrapCoreSchema = {
  readonly cardinality: {
    readonly values: {
      readonly many: { readonly id: string };
      readonly one: { readonly id: string };
      readonly oneOptional: { readonly id: string };
    };
  };
  readonly enum: EntityTypeOutput & {
    readonly fields: {
      readonly member: EdgeOutput;
    };
  };
  readonly icon: EntityTypeOutput & {
    readonly fields: {
      readonly key: EdgeOutput;
      readonly svg: EdgeOutput;
    };
  };
  readonly node: EntityTypeOutput & {
    readonly fields: {
      readonly createdAt?: EdgeOutput;
      readonly description: EdgeOutput;
      readonly name: EdgeOutput;
      readonly type: EdgeOutput;
      readonly updatedAt?: EdgeOutput;
    };
  };
  readonly predicate: EntityTypeOutput & {
    readonly fields: {
      readonly cardinality: EdgeOutput;
      readonly icon: EdgeOutput;
      readonly key: EdgeOutput;
      readonly range: EdgeOutput;
    };
  };
  readonly type: EntityTypeOutput & {
    readonly fields: {
      readonly icon: EdgeOutput;
    };
  };
};

function isEdgeOutputProperty(value: unknown): value is EdgeOutput {
  const candidate = value as Partial<EdgeOutput> | undefined;
  return typeof candidate?.key === "string" && typeof candidate?.range === "string";
}

function assertGraphBootstrapCoreSchema(value: unknown, fieldName: string): void {
  if (value) return;
  throw new Error(`Graph bootstrap definitions must include the core "${fieldName}" contract.`);
}

/**
 * Reads the minimal built-in core schema contracts required by graph bootstrap.
 *
 * Callers may pass explicit `coreSchema` options when bootstrapping a module
 * slice whose definitions do not include the core namespace directly.
 */
export function requireGraphBootstrapCoreSchema(
  definitions: Record<string, AnyTypeOutput>,
): GraphBootstrapCoreSchema {
  const record = definitions as Partial<Record<keyof GraphBootstrapCoreSchema, unknown>>;
  assertGraphBootstrapCoreSchema(record.node, "node");
  assertGraphBootstrapCoreSchema(record.predicate, "predicate");
  assertGraphBootstrapCoreSchema(record.type, "type");
  assertGraphBootstrapCoreSchema(record.icon, "icon");
  assertGraphBootstrapCoreSchema(record.enum, "enum");
  assertGraphBootstrapCoreSchema(record.cardinality, "cardinality");

  const icon = record.icon as Partial<EntityTypeOutput>;
  const node = record.node as Partial<EntityTypeOutput>;
  const predicate = record.predicate as Partial<EntityTypeOutput>;
  const typeDef = record.type as Partial<EntityTypeOutput>;
  const enumDef = record.enum as Partial<EntityTypeOutput>;
  const cardinality = record.cardinality as Partial<GraphBootstrapCoreSchema["cardinality"]>;

  if (
    !isEdgeOutputProperty(icon.fields?.key) ||
    !isEdgeOutputProperty(icon.fields?.svg) ||
    !isEdgeOutputProperty(node.fields?.type) ||
    !isEdgeOutputProperty(node.fields?.name) ||
    !isEdgeOutputProperty(node.fields?.description) ||
    (node.fields?.createdAt !== undefined && !isEdgeOutputProperty(node.fields.createdAt)) ||
    (node.fields?.updatedAt !== undefined && !isEdgeOutputProperty(node.fields.updatedAt)) ||
    !isEdgeOutputProperty(predicate.fields?.key) ||
    !isEdgeOutputProperty(predicate.fields?.range) ||
    !isEdgeOutputProperty(predicate.fields?.cardinality) ||
    !isEdgeOutputProperty(predicate.fields?.icon) ||
    !isEdgeOutputProperty(typeDef.fields?.icon) ||
    !isEdgeOutputProperty(enumDef.fields?.member) ||
    typeof cardinality.values?.one?.id !== "string" ||
    typeof cardinality.values?.oneOptional?.id !== "string" ||
    typeof cardinality.values?.many?.id !== "string"
  ) {
    throw new Error(
      "Graph bootstrap definitions must include the built-in core node, predicate, type, enum, and cardinality contracts.",
    );
  }

  return {
    cardinality: cardinality as GraphBootstrapCoreSchema["cardinality"],
    enum: enumDef as GraphBootstrapCoreSchema["enum"],
    icon: icon as GraphBootstrapCoreSchema["icon"],
    node: node as GraphBootstrapCoreSchema["node"],
    predicate: predicate as GraphBootstrapCoreSchema["predicate"],
    type: typeDef as GraphBootstrapCoreSchema["type"],
  };
}
