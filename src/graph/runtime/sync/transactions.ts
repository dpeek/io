import type { GraphValidationResult } from "../client";
import type { Store, StoreSnapshot } from "../store";
import {
  type GraphWriteAssertOperation,
  type GraphWriteOperation,
  type GraphWriteRetractOperation,
  type GraphWriteTransaction,
  isObjectRecord,
} from "./contracts";
import { createTransactionValidationIssue, invalidTransactionResult } from "./validation-helpers";

function compareGraphWriteOperations(
  left: GraphWriteOperation,
  right: GraphWriteOperation,
): number {
  if (left.op !== right.op) return left.op === "retract" ? -1 : 1;

  if (left.op === "retract" && right.op === "retract") {
    return left.edgeId.localeCompare(right.edgeId);
  }

  if (left.op === "assert" && right.op === "assert") {
    return (
      left.edge.s.localeCompare(right.edge.s) ||
      left.edge.p.localeCompare(right.edge.p) ||
      left.edge.o.localeCompare(right.edge.o) ||
      left.edge.id.localeCompare(right.edge.id)
    );
  }

  return 0;
}

function sameGraphWriteOperation(left: GraphWriteOperation, right: GraphWriteOperation): boolean {
  if (left.op !== right.op) return false;
  if (left.op === "retract" && right.op === "retract") return left.edgeId === right.edgeId;
  if (left.op === "assert" && right.op === "assert") {
    return (
      left.edge.id === right.edge.id &&
      left.edge.s === right.edge.s &&
      left.edge.p === right.edge.p &&
      left.edge.o === right.edge.o
    );
  }
  return false;
}

export function sameGraphWriteTransaction(
  left: GraphWriteTransaction,
  right: GraphWriteTransaction,
): boolean {
  if (left.id !== right.id) return false;
  if (left.ops.length !== right.ops.length) return false;
  for (let index = 0; index < left.ops.length; index += 1) {
    const leftOperation = left.ops[index];
    const rightOperation = right.ops[index];
    if (!leftOperation || !rightOperation) return false;
    if (!sameGraphWriteOperation(leftOperation, rightOperation)) return false;
  }
  return true;
}

export function logicalFactKey(edge: StoreSnapshot["edges"][number]): string {
  return `${edge.s}\0${edge.p}\0${edge.o}`;
}

export function createGraphWriteOperationsFromSnapshots(
  before: StoreSnapshot,
  after: StoreSnapshot,
): readonly GraphWriteOperation[] {
  const beforeEdgeIds = new Set(before.edges.map((edge) => edge.id));
  const beforeRetractedIds = new Set(before.retracted);

  return canonicalizeGraphWriteTransaction({
    id: "$sync:derived",
    ops: [
      ...after.retracted
        .filter((edgeId) => !beforeRetractedIds.has(edgeId))
        .map(
          (edgeId): GraphWriteRetractOperation => ({
            op: "retract",
            edgeId,
          }),
        ),
      ...after.edges
        .filter((edge) => !beforeEdgeIds.has(edge.id))
        .map(
          (edge): GraphWriteAssertOperation => ({
            op: "assert",
            edge: { ...edge },
          }),
        ),
    ],
  }).ops;
}

export function createGraphWriteTransactionFromSnapshots(
  before: StoreSnapshot,
  after: StoreSnapshot,
  txId: string,
): GraphWriteTransaction {
  return canonicalizeGraphWriteTransaction({
    id: txId,
    ops: createGraphWriteOperationsFromSnapshots(before, after),
  });
}

function validateGraphWriteTransactionShape(
  transaction: GraphWriteTransaction,
): readonly ReturnType<typeof createTransactionValidationIssue>[] {
  const issues = [];
  const candidate = transaction as Partial<GraphWriteTransaction> & Record<string, unknown>;
  const assertIds = new Map<string, StoreSnapshot["edges"][number]>();
  const retractIds = new Set<string>();

  if (typeof candidate.id !== "string") {
    issues.push(
      createTransactionValidationIssue(["id"], "sync.tx.id", 'Field "id" must be a string.'),
    );
  } else if (candidate.id.length === 0) {
    issues.push(
      createTransactionValidationIssue(["id"], "sync.tx.id.empty", 'Field "id" must not be empty.'),
    );
  }

  if (!Array.isArray(candidate.ops)) {
    issues.push(
      createTransactionValidationIssue(["ops"], "sync.tx.ops", 'Field "ops" must be an array.'),
    );
    return issues;
  }

  if (candidate.ops.length === 0) {
    issues.push(
      createTransactionValidationIssue(
        ["ops"],
        "sync.tx.ops.empty",
        'Field "ops" must contain at least one operation.',
      ),
    );
  }

  candidate.ops.forEach((operation, index) => {
    const opPath = `ops[${index}]`;
    if (!isObjectRecord(operation)) {
      issues.push(
        createTransactionValidationIssue(
          [opPath],
          "sync.tx.op",
          `Field "${opPath}" must be an operation object.`,
        ),
      );
      return;
    }

    if (operation.op === "retract") {
      if (typeof operation.edgeId !== "string") {
        issues.push(
          createTransactionValidationIssue(
            [opPath, "edgeId"],
            "sync.tx.op.retract.edgeId",
            `Field "${opPath}.edgeId" must be a string.`,
          ),
        );
        return;
      }

      if (assertIds.has(operation.edgeId)) {
        issues.push(
          createTransactionValidationIssue(
            [opPath, "edgeId"],
            "sync.tx.op.edgeId.reused",
            `Field "${opPath}.edgeId" must not reuse an asserted edge id in the same transaction.`,
          ),
        );
      }
      retractIds.add(operation.edgeId);
      return;
    }

    if (operation.op !== "assert") {
      issues.push(
        createTransactionValidationIssue(
          [opPath, "op"],
          "sync.tx.op.kind",
          `Field "${opPath}.op" must be "assert" or "retract".`,
        ),
      );
      return;
    }

    if (!isObjectRecord(operation.edge)) {
      issues.push(
        createTransactionValidationIssue(
          [opPath, "edge"],
          "sync.tx.op.assert.edge",
          `Field "${opPath}.edge" must be an edge object.`,
        ),
      );
      return;
    }

    for (const key of ["id", "s", "p", "o"] as const) {
      if (typeof operation.edge[key] !== "string") {
        issues.push(
          createTransactionValidationIssue(
            [opPath, "edge", key],
            `sync.tx.op.assert.edge.${key}`,
            `Field "${opPath}.edge.${key}" must be a string.`,
          ),
        );
      }
    }

    if (
      typeof operation.edge.id !== "string" ||
      typeof operation.edge.s !== "string" ||
      typeof operation.edge.p !== "string" ||
      typeof operation.edge.o !== "string"
    ) {
      return;
    }
    if (retractIds.has(operation.edge.id)) {
      issues.push(
        createTransactionValidationIssue(
          [opPath, "edge", "id"],
          "sync.tx.op.edgeId.reused",
          `Field "${opPath}.edge.id" must not reuse a retracted edge id in the same transaction.`,
        ),
      );
    }

    const existing = assertIds.get(operation.edge.id);
    if (!existing) {
      assertIds.set(operation.edge.id, {
        id: operation.edge.id,
        s: operation.edge.s,
        p: operation.edge.p,
        o: operation.edge.o,
      });
      return;
    }

    if (
      existing.s !== operation.edge.s ||
      existing.p !== operation.edge.p ||
      existing.o !== operation.edge.o
    ) {
      issues.push(
        createTransactionValidationIssue(
          [opPath, "edge", "id"],
          "sync.tx.op.assert.edge.id.conflict",
          `Field "${opPath}.edge.id" must not describe multiple asserted edges in the same transaction.`,
        ),
      );
    }
  });

  return issues;
}

export function canonicalizeGraphWriteTransaction(
  transaction: GraphWriteTransaction,
): GraphWriteTransaction {
  const retractIds = new Set<string>();
  const assertById = new Map<string, StoreSnapshot["edges"][number]>();

  for (const operation of transaction.ops) {
    if (operation.op === "retract") {
      retractIds.add(operation.edgeId);
      continue;
    }

    if (assertById.has(operation.edge.id)) continue;
    assertById.set(operation.edge.id, { ...operation.edge });
  }

  const ops: GraphWriteOperation[] = [
    ...[...retractIds]
      .sort((left, right) => left.localeCompare(right))
      .map(
        (edgeId): GraphWriteRetractOperation => ({
          op: "retract",
          edgeId,
        }),
      ),
    ...[...assertById.values()]
      .sort((left, right) => {
        return (
          left.s.localeCompare(right.s) ||
          left.p.localeCompare(right.p) ||
          left.o.localeCompare(right.o) ||
          left.id.localeCompare(right.id)
        );
      })
      .map(
        (edge): GraphWriteAssertOperation => ({
          op: "assert",
          edge: { ...edge },
        }),
      ),
  ];
  ops.sort(compareGraphWriteOperations);

  return {
    ...transaction,
    ops,
  };
}

export function prepareGraphWriteTransaction(transaction: GraphWriteTransaction):
  | {
      ok: true;
      value: GraphWriteTransaction;
    }
  | {
      ok: false;
      result: Extract<GraphValidationResult<GraphWriteTransaction>, { ok: false }>;
    } {
  const issues = validateGraphWriteTransactionShape(transaction);
  if (issues.length > 0) {
    return {
      ok: false,
      result: invalidTransactionResult(transaction, issues),
    };
  }

  return {
    ok: true,
    value: canonicalizeGraphWriteTransaction(transaction),
  };
}

export function materializeGraphWriteTransactionSnapshot(
  store: Store,
  transaction: GraphWriteTransaction,
  options: {
    allowExistingAssertEdgeIds?: boolean;
    sourceSnapshot?: StoreSnapshot;
  } = {},
):
  | {
      ok: true;
      value: StoreSnapshot;
    }
  | {
      ok: false;
      result: Extract<GraphValidationResult<GraphWriteTransaction>, { ok: false }>;
    } {
  const snapshot = options.sourceSnapshot ?? store.snapshot();
  const edges = snapshot.edges.map((edge) => ({ ...edge }));
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const retracted = new Set(snapshot.retracted);
  const issues = [];

  for (const [index, operation] of transaction.ops.entries()) {
    const opPath = `ops[${index}]`;
    if (operation.op === "retract") {
      if (!edgeById.has(operation.edgeId)) {
        issues.push(
          createTransactionValidationIssue(
            [opPath, "edgeId"],
            "sync.tx.op.retract.missing",
            `Field "${opPath}.edgeId" must reference an existing edge.`,
          ),
        );
        continue;
      }

      retracted.add(operation.edgeId);
      continue;
    }

    const existing = edgeById.get(operation.edge.id);
    if (existing) {
      if (
        options.allowExistingAssertEdgeIds &&
        existing.s === operation.edge.s &&
        existing.p === operation.edge.p &&
        existing.o === operation.edge.o
      ) {
        continue;
      }
      issues.push(
        createTransactionValidationIssue(
          [opPath, "edge", "id"],
          "sync.tx.op.assert.edge.id.conflict",
          `Field "${opPath}.edge.id" must not collide with an existing edge id.`,
        ),
      );
      continue;
    }

    const edge = { ...operation.edge };
    edges.push(edge);
    edgeById.set(edge.id, edge);
  }

  if (issues.length > 0) {
    return {
      ok: false,
      result: invalidTransactionResult(transaction, issues),
    };
  }

  return {
    ok: true,
    value: {
      edges,
      retracted: [...retracted],
    },
  };
}

export function applyGraphWriteTransaction(store: Store, transaction: GraphWriteTransaction): void {
  store.batch(() => {
    for (const operation of transaction.ops) {
      if (operation.op === "retract") {
        store.retract(operation.edgeId);
        continue;
      }

      store.assertEdge(operation.edge);
    }
  });
}
