import type { GraphId } from "./id.js";
import type { GraphFieldWritePolicy } from "./schema.js";
import type { GraphFact, GraphStoreSnapshot } from "./store.js";

/**
 * Opaque cursor issued by an authoritative write session.
 */
export type AuthoritativeGraphCursor = string;

/**
 * Assert one edge as part of a write transaction.
 */
export type GraphWriteAssertOperation = {
  readonly op: "assert";
  readonly edge: GraphFact;
};

/**
 * Retract one prior edge as part of a write transaction.
 */
export type GraphWriteRetractOperation = {
  readonly op: "retract";
  readonly edgeId: GraphId;
};

/**
 * One canonical write operation.
 */
export type GraphWriteOperation = GraphWriteAssertOperation | GraphWriteRetractOperation;

/**
 * Caller-supplied authoritative write envelope.
 *
 * `id` is the idempotency key for the transaction.
 */
export type GraphWriteTransaction = {
  readonly id: string;
  readonly ops: readonly GraphWriteOperation[];
};

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

/**
 * Retained-history policy for authoritative write results.
 *
 * Authorities may either retain every acknowledged transaction or keep only a
 * suffix window by transaction count.
 */
export type AuthoritativeGraphRetainedHistoryPolicy =
  | {
      readonly kind: "all";
    }
  | {
      readonly kind: "transaction-count";
      readonly maxTransactions: number;
    };

/**
 * Canonical retained-history policy value representing an unbounded window.
 */
export const unboundedAuthoritativeGraphRetainedHistoryPolicy = Object.freeze({
  kind: "all",
}) satisfies AuthoritativeGraphRetainedHistoryPolicy;

/**
 * Clone one retained-history policy value.
 */
export function cloneAuthoritativeGraphRetainedHistoryPolicy(
  policy: AuthoritativeGraphRetainedHistoryPolicy,
): AuthoritativeGraphRetainedHistoryPolicy {
  return policy.kind === "all" ? unboundedAuthoritativeGraphRetainedHistoryPolicy : { ...policy };
}

/**
 * Compare two retained-history policies for logical equality.
 */
export function sameAuthoritativeGraphRetainedHistoryPolicy(
  left: AuthoritativeGraphRetainedHistoryPolicy,
  right: AuthoritativeGraphRetainedHistoryPolicy,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "all") return true;
  return right.kind === "transaction-count" && left.maxTransactions === right.maxTransactions;
}

/**
 * Runtime guard for retained-history policies.
 */
export function isAuthoritativeGraphRetainedHistoryPolicy(
  value: unknown,
): value is AuthoritativeGraphRetainedHistoryPolicy {
  if (value === unboundedAuthoritativeGraphRetainedHistoryPolicy) return true;
  if (value === null || typeof value !== "object") return false;

  const policy = value as Partial<AuthoritativeGraphRetainedHistoryPolicy>;
  return (
    policy.kind === "all" ||
    (policy.kind === "transaction-count" &&
      typeof policy.maxTransactions === "number" &&
      Number.isInteger(policy.maxTransactions) &&
      policy.maxTransactions >= 1)
  );
}

/**
 * Lowest-level write scope accepted by an authority for one transaction.
 */
export type GraphWriteScope = GraphFieldWritePolicy;

/**
 * Stable write-scope literals published by the kernel.
 */
export const graphWriteScopes = [
  "client-tx",
  "server-command",
  "authority-only",
] as const satisfies readonly GraphWriteScope[];

/**
 * Runtime guard for graph write scopes.
 */
export function isGraphWriteScope(value: unknown): value is GraphWriteScope {
  return typeof value === "string" && (graphWriteScopes as readonly string[]).includes(value);
}

/**
 * Compare two graph write transactions for exact logical equality.
 *
 * Operation order is significant. Canonicalize transactions first when callers
 * want order-insensitive comparison.
 */
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

/**
 * Canonicalize one graph write transaction.
 *
 * Retracts are de-duplicated by edge id, asserts are de-duplicated by edge id,
 * and the resulting operations are sorted into a stable deterministic order.
 */
export function canonicalizeGraphWriteTransaction(
  transaction: GraphWriteTransaction,
): GraphWriteTransaction {
  const retractIds = new Set<GraphId>();
  const assertById = new Map<GraphId, GraphStoreSnapshot["edges"][number]>();

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

/**
 * Derive the canonical write operations that transform one store snapshot into
 * another.
 */
export function createGraphWriteOperationsFromSnapshots(
  before: GraphStoreSnapshot,
  after: GraphStoreSnapshot,
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

/**
 * Derive one canonical graph write transaction from two store snapshots.
 */
export function createGraphWriteTransactionFromSnapshots(
  before: GraphStoreSnapshot,
  after: GraphStoreSnapshot,
  txId: string,
): GraphWriteTransaction {
  return canonicalizeGraphWriteTransaction({
    id: txId,
    ops: createGraphWriteOperationsFromSnapshots(before, after),
  });
}

/**
 * Accepted authoritative acknowledgement for one transaction.
 *
 * `cursor` is the authority-issued position after this transaction has been
 * applied or replayed. `replayed` indicates that the authority recognized the
 * transaction id as an already-applied write rather than applying it again.
 */
export type AuthoritativeGraphWriteResult = {
  readonly txId: string;
  readonly cursor: AuthoritativeGraphCursor;
  readonly replayed: boolean;
  readonly writeScope: GraphWriteScope;
  readonly transaction: GraphWriteTransaction;
};

/**
 * Retained suffix of accepted authoritative results.
 *
 * `cursorPrefix` and `baseSequence` together describe the cursor immediately
 * before the first retained result in `results`.
 */
export type AuthoritativeGraphWriteHistory = {
  readonly cursorPrefix: string;
  readonly retainedHistoryPolicy: AuthoritativeGraphRetainedHistoryPolicy;
  readonly baseSequence: number;
  readonly results: readonly AuthoritativeGraphWriteResult[];
};

/**
 * Result of asking an authority for changes after one cursor.
 *
 * `"changes"` means the cursor stayed inside the retained history window and
 * incremental replay is available. `"reset"` means the caller's cursor fell
 * outside the retained window and must resynchronize from a fresher base.
 */
export type AuthoritativeGraphChangesAfterResult =
  | {
      readonly kind: "changes";
      readonly cursor: AuthoritativeGraphCursor;
      readonly changes: readonly AuthoritativeGraphWriteResult[];
    }
  | {
      readonly kind: "reset";
      readonly cursor: AuthoritativeGraphCursor;
      readonly changes: readonly [];
    };

/**
 * Narrow helper for safe object-shape checks in cloning helpers.
 */
export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/**
 * Clone one graph write operation, normalizing unknown input to the public
 * contract shape.
 *
 * Invalid or missing fields are replaced with empty strings so downstream code
 * can handle one consistent object shape.
 */
export function cloneGraphWriteOperation(operation: unknown): GraphWriteOperation {
  if (isObjectRecord(operation) && operation.op === "retract") {
    return {
      op: "retract",
      edgeId: typeof operation.edgeId === "string" ? operation.edgeId : "",
    };
  }

  const edge = isObjectRecord(operation) && isObjectRecord(operation.edge) ? operation.edge : {};
  return {
    op: "assert",
    edge: {
      id: typeof edge.id === "string" ? edge.id : "",
      s: typeof edge.s === "string" ? edge.s : "",
      p: typeof edge.p === "string" ? edge.p : "",
      o: typeof edge.o === "string" ? edge.o : "",
    },
  };
}

/**
 * Clone one graph write transaction into a detached value.
 */
export function cloneGraphWriteTransaction(
  transaction: GraphWriteTransaction,
): GraphWriteTransaction {
  const candidate = transaction as Partial<GraphWriteTransaction> & Record<string, unknown>;
  return {
    id: typeof candidate.id === "string" ? candidate.id : "",
    ops: Array.isArray(candidate.ops)
      ? candidate.ops.map((operation) => cloneGraphWriteOperation(operation))
      : [],
  };
}

/**
 * Clone one authoritative write result into a detached value.
 */
export function cloneAuthoritativeGraphWriteResult(
  result: AuthoritativeGraphWriteResult,
  options: {
    replayed?: boolean;
  } = {},
): AuthoritativeGraphWriteResult {
  return {
    ...result,
    replayed: options.replayed ?? result.replayed,
    transaction: cloneGraphWriteTransaction(result.transaction),
  };
}
