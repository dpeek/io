import { core } from "../core";
import {
  edgeId,
  fieldVisibility,
  fieldWritePolicy,
  isEntityType,
  isFieldsOutput,
  typeId,
  type AnyTypeOutput,
  type FieldsOutput,
  type GraphFieldVisibility,
  type GraphFieldWritePolicy,
  type ResolvedEdgeOutput,
} from "../schema";
import { createStore, type Store, type StoreSnapshot } from "../store";
import {
  cloneAuthoritativeGraphWriteResult,
  type AuthoritativeGraphWriteResult,
  type AuthoritativeWriteScope,
  type GraphWriteOperation,
  type GraphWriteTransaction,
} from "./contracts";
import { createTransactionValidationIssue } from "./validation-helpers";

type FieldAuthorityPolicy = {
  readonly key: string;
  readonly visibility: GraphFieldVisibility;
  readonly write: GraphFieldWritePolicy;
};

type FieldAuthorityPolicyIndex = Map<string, Map<string, FieldAuthorityPolicy>>;

function isResolvedEdgeOutput(value: unknown): value is ResolvedEdgeOutput {
  const candidate = value as Partial<ResolvedEdgeOutput>;
  return (
    typeof candidate.key === "string" &&
    typeof candidate.range === "string" &&
    typeof candidate.cardinality === "string"
  );
}

function collectFieldAuthorityPolicies(
  fields: FieldsOutput,
  policies: Map<string, FieldAuthorityPolicy>,
): void {
  for (const value of Object.values(fields) as unknown[]) {
    if (isFieldsOutput(value)) {
      collectFieldAuthorityPolicies(value, policies);
      continue;
    }

    if (!isResolvedEdgeOutput(value)) continue;
    policies.set(edgeId(value), {
      key: value.key,
      visibility: fieldVisibility(value as Parameters<typeof fieldVisibility>[0]),
      write: fieldWritePolicy(value as Parameters<typeof fieldWritePolicy>[0]),
    });
  }
}

export function createFieldAuthorityPolicyIndex(
  namespace: Record<string, AnyTypeOutput>,
): FieldAuthorityPolicyIndex {
  const policiesByTypeId: FieldAuthorityPolicyIndex = new Map();

  for (const typeDef of Object.values(namespace)) {
    if (!isEntityType(typeDef)) continue;
    const policies = new Map<string, FieldAuthorityPolicy>();
    collectFieldAuthorityPolicies(typeDef.fields, policies);
    policiesByTypeId.set(typeId(typeDef), policies);
  }

  return policiesByTypeId;
}

function findSubjectTypeId(
  store: Store,
  nodeId: string,
  nodeTypePredicateId: string,
): string | undefined {
  return store.get(nodeId, nodeTypePredicateId) ?? store.find(nodeId, nodeTypePredicateId)[0]?.o;
}

function findFieldAuthorityPolicy(
  policiesByTypeId: FieldAuthorityPolicyIndex,
  store: Store,
  nodeId: string,
  predicateId: string,
): FieldAuthorityPolicy | undefined {
  const subjectTypeId = findSubjectTypeId(store, nodeId, edgeId(core.node.fields.type));
  if (!subjectTypeId) return undefined;
  return policiesByTypeId.get(subjectTypeId)?.get(predicateId);
}

export function createEdgeIndex(
  snapshot: StoreSnapshot,
): Map<string, StoreSnapshot["edges"][number]> {
  return new Map(snapshot.edges.map((edge) => [edge.id, edge]));
}

function resolveTransactionOperationTarget(
  operation: GraphWriteOperation,
  edgeById: Map<string, StoreSnapshot["edges"][number]>,
): { subjectId: string; predicateId: string } | undefined {
  if (operation.op === "assert") {
    return {
      subjectId: operation.edge.s,
      predicateId: operation.edge.p,
    };
  }

  const edge = edgeById.get(operation.edgeId);
  if (!edge) return undefined;
  return {
    subjectId: edge.s,
    predicateId: edge.p,
  };
}

export function filterReplicatedSnapshot(
  store: Store,
  namespace: Record<string, AnyTypeOutput>,
): StoreSnapshot {
  const policiesByTypeId = createFieldAuthorityPolicyIndex(namespace);
  const snapshot = store.snapshot();
  const edges = snapshot.edges
    .filter((edge) => {
      const policy = findFieldAuthorityPolicy(policiesByTypeId, store, edge.s, edge.p);
      return (policy?.visibility ?? "replicated") === "replicated";
    })
    .map((edge) => ({ ...edge }));
  const visibleEdgeIds = new Set(edges.map((edge) => edge.id));

  return {
    edges,
    retracted: snapshot.retracted.filter((edgeId) => visibleEdgeIds.has(edgeId)),
  };
}

export function filterReplicatedWriteResult(
  result: AuthoritativeGraphWriteResult,
  store: Store,
  policiesByTypeId: FieldAuthorityPolicyIndex,
  edgeById: Map<string, StoreSnapshot["edges"][number]>,
): AuthoritativeGraphWriteResult | undefined {
  const ops = result.transaction.ops.filter((operation) => {
    const target = resolveTransactionOperationTarget(operation, edgeById);
    if (!target) return true;

    const policy = findFieldAuthorityPolicy(
      policiesByTypeId,
      store,
      target.subjectId,
      target.predicateId,
    );
    return (policy?.visibility ?? "replicated") === "replicated";
  });

  if (ops.length === 0) return undefined;
  return cloneAuthoritativeGraphWriteResult({
    ...result,
    transaction: {
      ...result.transaction,
      ops,
    },
  });
}

const authoritativeWriteScopeLevel: Record<AuthoritativeWriteScope, number> = {
  "client-tx": 0,
  "server-command": 1,
  "authority-only": 2,
};

function writeScopeAllows(
  writeScope: AuthoritativeWriteScope,
  required: GraphFieldWritePolicy,
): boolean {
  return authoritativeWriteScopeLevel[writeScope] >= authoritativeWriteScopeLevel[required];
}

export function validateAuthoritativeFieldWritePolicies(
  transaction: GraphWriteTransaction,
  snapshot: StoreSnapshot,
  namespace: Record<string, AnyTypeOutput>,
  writeScope: AuthoritativeWriteScope,
) {
  const policiesByTypeId = createFieldAuthorityPolicyIndex(namespace);
  const validationStore = createStore(snapshot);
  const edgeById = createEdgeIndex(snapshot);
  const issues = [];

  for (const [index, operation] of transaction.ops.entries()) {
    const target = resolveTransactionOperationTarget(operation, edgeById);
    if (!target) continue;

    const policy = findFieldAuthorityPolicy(
      policiesByTypeId,
      validationStore,
      target.subjectId,
      target.predicateId,
    );
    if (!policy || writeScopeAllows(writeScope, policy.write)) continue;

    issues.push(
      createTransactionValidationIssue(
        [`ops[${index}]`],
        "sync.tx.op.write.policy",
        `Field "${policy.key}" requires "${policy.write}" writes and cannot be changed through an ordinary transaction.`,
      ),
    );
  }

  return issues;
}
