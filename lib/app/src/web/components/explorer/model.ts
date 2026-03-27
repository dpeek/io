import { edgeId, type AnyTypeOutput, type Cardinality, typeId } from "@io/app/graph";
import {
  type EntityRef,
  type GraphMutationValidationResult,
  type GraphClient,
  type PredicateRef,
} from "@io/graph-client";
import { core } from "@io/graph-module-core";
import { workflow } from "@io/graph-module-workflow";

import type { WriteSecretFieldInput, WriteSecretFieldResult } from "../../lib/secret-fields.js";
import type { GraphRuntime } from "../graph-runtime-bootstrap.js";

export const explorerNamespace = { ...core, ...workflow } as const;

export type ExplorerNamespace = typeof explorerNamespace;
export type ExplorerClient = GraphClient<ExplorerNamespace>;
export type ExplorerSync = GraphRuntime["sync"];
export type ExplorerRuntime = Pick<GraphRuntime, "graph" | "store" | "sync">;
export type ExplorerSelection = {
  target: string;
  typeId: string;
};
export type AnyEntityRef = EntityRef<any, any>;
export type AnyPredicateRef = PredicateRef<any, any>;
export type MutableOptionalPredicateRef = AnyPredicateRef & {
  clear(): void;
  set(value: unknown): void;
  validateClear(): GraphMutationValidationResult;
  validateSet(value: unknown): GraphMutationValidationResult;
};
export type MutationCallbacks = {
  onMutationError?: (error: unknown) => void;
  onMutationSuccess?: () => void;
};
export type ExplorerSyncSnapshot = {
  pendingTransactions: ReturnType<ExplorerSync["getPendingTransactions"]>;
  state: ReturnType<ExplorerSync["getState"]>;
};

export type DefinitionFieldEntry = {
  cardinality: Cardinality;
  iconId: string;
  key: string;
  pathLabel: string;
  predicateId: string;
  rangeId: string;
};

export type TypeCatalogEntry = {
  compiledIconId: string;
  dataCount: number;
  fieldDefs: DefinitionFieldEntry[];
  id: string;
  key: string;
  kind: AnyTypeOutput["kind"];
  name: string;
  optionDefs: Array<{
    description?: string;
    id: string;
    key: string;
    name?: string;
  }>;
  typeDef: AnyTypeOutput;
};

export type EntityCatalogEntry = {
  count: number;
  create: (input: Record<string, unknown>) => string;
  getRef: (id: string) => AnyEntityRef;
  id: string;
  iconPredicateId?: string;
  ids: string[];
  key: string;
  name: string;
  typeDef: Extract<AnyTypeOutput, { kind: "entity" }>;
  validateCreate: (input: Record<string, unknown>) => GraphMutationValidationResult;
};

export type PredicateOwner = {
  pathLabel: string;
  typeId: string;
  typeKey: string;
  typeName: string;
};

export type PredicateCatalogEntry = {
  compiledCardinality: Cardinality;
  compiledIconId: string;
  compiledRangeId: string;
  getRef: () => AnyEntityRef;
  id: string;
  key: string;
  owners: PredicateOwner[];
};

export type PredicateFieldEntry = {
  pathLabel: string;
  predicate: AnyPredicateRef;
};

export type FieldStatus = {
  label: string;
  tone: "empty" | "missing" | "present";
};

export type FieldValidationMessage = {
  id: string;
  message: string;
  pathLabel: string;
  source: string;
};

export type SubmitSecretFieldMutation = (
  input: WriteSecretFieldInput,
) => Promise<WriteSecretFieldResult>;

export const keyPredicateId = edgeId(core.predicate.fields.key);
export const typePredicateId = edgeId(core.node.fields.type);
export const typeIconPredicateId = edgeId(core.type.fields.icon);
export const predicateIconPredicateId = edgeId(core.predicate.fields.icon);
export const createdAtPredicateId = edgeId(core.node.fields.createdAt);
export const updatedAtPredicateId = edgeId(core.node.fields.updatedAt);
export const iconTypeId = typeId(core.icon);
export const predicateTypeId = typeId(core.predicate);
export const schemaTarget = "schema";
export const newTarget = "new";

export const compiledCardinalityIdByLiteral: Record<Cardinality, string> = {
  one: core.cardinality.values.one.id,
  "one?": core.cardinality.values.oneOptional.id,
  many: core.cardinality.values.many.id,
};

export const cardinalityLabelById = new Map<string, string>([
  [core.cardinality.values.one.id, "one"],
  [core.cardinality.values.oneOptional.id, "one?"],
  [core.cardinality.values.many.id, "many"],
]);
