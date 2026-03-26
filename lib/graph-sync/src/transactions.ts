import {
  canonicalizeGraphWriteTransaction,
  cloneGraphWriteTransaction,
  type GraphStore,
  type GraphStoreSnapshot,
  type GraphWriteTransaction,
} from "@io/graph-kernel";

import { isObjectRecord, type GraphSyncValidationResult } from "./contracts";
import { createGraphSyncValidationIssue, invalidGraphWriteTransactionResult } from "./validation";

export function logicalFactKey(edge: GraphStoreSnapshot["edges"][number]): string {
  return `${edge.s}\0${edge.p}\0${edge.o}`;
}

function validateGraphWriteTransactionShape(
  transaction: GraphWriteTransaction,
): readonly ReturnType<typeof createGraphSyncValidationIssue>[] {
  const issues = [];
  const candidate = transaction as Partial<GraphWriteTransaction> & Record<string, unknown>;
  const assertIds = new Map<string, GraphStoreSnapshot["edges"][number]>();
  const retractIds = new Set<string>();

  if (typeof candidate.id !== "string") {
    issues.push(
      createGraphSyncValidationIssue(["id"], "sync.tx.id", 'Field "id" must be a string.'),
    );
  } else if (candidate.id.length === 0) {
    issues.push(
      createGraphSyncValidationIssue(["id"], "sync.tx.id.empty", 'Field "id" must not be empty.'),
    );
  }

  if (!Array.isArray(candidate.ops)) {
    issues.push(
      createGraphSyncValidationIssue(["ops"], "sync.tx.ops", 'Field "ops" must be an array.'),
    );
    return issues;
  }

  if (candidate.ops.length === 0) {
    issues.push(
      createGraphSyncValidationIssue(
        ["ops"],
        "sync.tx.ops.empty",
        'Field "ops" must contain at least one operation.',
      ),
    );
  }

  candidate.ops.forEach((operation: unknown, index: number) => {
    const opPath = `ops[${index}]`;
    if (!isObjectRecord(operation)) {
      issues.push(
        createGraphSyncValidationIssue(
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
          createGraphSyncValidationIssue(
            [opPath, "edgeId"],
            "sync.tx.op.retract.edgeId",
            `Field "${opPath}.edgeId" must be a string.`,
          ),
        );
        return;
      }

      if (assertIds.has(operation.edgeId)) {
        issues.push(
          createGraphSyncValidationIssue(
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
        createGraphSyncValidationIssue(
          [opPath, "op"],
          "sync.tx.op.kind",
          `Field "${opPath}.op" must be "assert" or "retract".`,
        ),
      );
      return;
    }

    if (!isObjectRecord(operation.edge)) {
      issues.push(
        createGraphSyncValidationIssue(
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
          createGraphSyncValidationIssue(
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
        createGraphSyncValidationIssue(
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
        createGraphSyncValidationIssue(
          [opPath, "edge", "id"],
          "sync.tx.op.assert.edge.id.conflict",
          `Field "${opPath}.edge.id" must not describe multiple asserted edges in the same transaction.`,
        ),
      );
    }
  });

  return issues;
}

export function prepareGraphWriteTransaction(transaction: GraphWriteTransaction):
  | {
      ok: true;
      value: GraphWriteTransaction;
    }
  | {
      ok: false;
      result: Extract<GraphSyncValidationResult<GraphWriteTransaction>, { ok: false }>;
    } {
  const issues = validateGraphWriteTransactionShape(transaction);
  const cloned = cloneGraphWriteTransaction(transaction);
  if (issues.length > 0) {
    return {
      ok: false,
      result: invalidGraphWriteTransactionResult(cloned, issues),
    };
  }

  return {
    ok: true,
    value: canonicalizeGraphWriteTransaction(cloned),
  };
}

export function materializeGraphWriteTransactionSnapshot(
  store: GraphStore,
  transaction: GraphWriteTransaction,
  options: {
    allowExistingAssertEdgeIds?: boolean;
    sourceSnapshot?: GraphStoreSnapshot;
  } = {},
):
  | {
      ok: true;
      value: GraphStoreSnapshot;
    }
  | {
      ok: false;
      result: Extract<GraphSyncValidationResult<GraphWriteTransaction>, { ok: false }>;
    } {
  const snapshot = options.sourceSnapshot
    ? {
        edges: options.sourceSnapshot.edges.map((edge) => ({ ...edge })),
        retracted: [...options.sourceSnapshot.retracted],
      }
    : store.snapshot();
  const edgeIndex = new Map(snapshot.edges.map((edge) => [edge.id, edge]));
  const retracted = new Set(snapshot.retracted);
  const issues = [];

  for (const [index, operation] of transaction.ops.entries()) {
    if (operation.op === "retract") {
      if (!edgeIndex.has(operation.edgeId)) {
        issues.push(
          createGraphSyncValidationIssue(
            [`ops[${index}]`, "edgeId"],
            "sync.tx.op.retract.missing",
            `Field "ops[${index}].edgeId" must reference an existing edge id.`,
          ),
        );
        continue;
      }

      retracted.add(operation.edgeId);
      continue;
    }

    const existing = edgeIndex.get(operation.edge.id);
    if (existing) {
      const matches =
        existing.s === operation.edge.s &&
        existing.p === operation.edge.p &&
        existing.o === operation.edge.o;
      if (!matches || !options.allowExistingAssertEdgeIds) {
        issues.push(
          createGraphSyncValidationIssue(
            [`ops[${index}]`, "edge", "id"],
            "sync.tx.op.assert.edge.id.existing",
            `Field "ops[${index}].edge.id" must not reuse an existing edge id.`,
          ),
        );
      }
      continue;
    }

    edgeIndex.set(operation.edge.id, { ...operation.edge });
  }

  if (issues.length > 0) {
    return {
      ok: false,
      result: invalidGraphWriteTransactionResult(cloneGraphWriteTransaction(transaction), issues),
    };
  }

  return {
    ok: true,
    value: {
      edges: [...edgeIndex.values()].map((edge) => ({ ...edge })),
      retracted: [...retracted],
    },
  };
}

export function applyGraphWriteTransaction(
  store: GraphStore,
  transaction: GraphWriteTransaction,
): void {
  const materialized = materializeGraphWriteTransactionSnapshot(store, transaction);
  if (!materialized.ok) {
    throw new Error(
      `Cannot apply invalid graph write transaction "${transaction.id}" to the target store.`,
    );
  }

  store.replace(materialized.value);
}
