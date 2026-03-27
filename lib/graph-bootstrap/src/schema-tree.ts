import {
  fieldTreeId,
  fieldTreeKey,
  isFieldsOutput,
  typeId,
  type AnyTypeOutput,
  type EdgeOutput,
  type FieldsOutput,
} from "@io/graph-kernel";

type SchemaTree = FieldsOutput;

export type SchemaShapeNode = {
  readonly id: string;
  readonly key: string;
};

function isPredicateDef(value: unknown): value is EdgeOutput {
  const candidate = value as Partial<EdgeOutput>;
  return typeof candidate.key === "string" && typeof candidate.range === "string";
}

function isTreeNode(value: unknown): value is SchemaTree {
  return isFieldsOutput(value);
}

export function collectPredicates(tree: SchemaTree): EdgeOutput[] {
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

export function collectShapeNodes(tree: SchemaTree): SchemaShapeNode[] {
  const out: SchemaShapeNode[] = [];

  function walk(node: SchemaTree): void {
    out.push({ id: fieldTreeId(node), key: fieldTreeKey(node) });
    for (const value of Object.values(node)) {
      if (isTreeNode(value)) walk(value);
    }
  }

  walk(tree);
  return out;
}

export function compareBootstrapTypeOrder(
  left: AnyTypeOutput,
  right: AnyTypeOutput,
  coreTypeId: string,
): number {
  if (typeId(left) === coreTypeId) return -1;
  if (typeId(right) === coreTypeId) return 1;
  return 0;
}
