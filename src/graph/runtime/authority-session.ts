import {
  cloneAuthoritativeGraphRetainedHistoryPolicy,
  cloneAuthoritativeGraphWriteResult,
  type AuthoritativeGraphChangesAfterResult,
  type AuthoritativeGraphRetainedHistoryPolicy,
  type AuthoritativeGraphWriteHistory,
  type AuthoritativeGraphWriteResult,
  type AuthoritativeWriteScope,
  type GraphWriteTransaction,
  sameGraphWriteTransaction,
  unboundedAuthoritativeGraphRetainedHistoryPolicy,
} from "@io/graph-kernel";
import {
  classifyIncrementalSyncFallbackReason,
  cloneSyncDiagnostics,
  cloneSyncScope,
  createIncrementalSyncFallback,
  createIncrementalSyncPayload,
  graphSyncScope,
  prepareGraphWriteTransaction,
  type IncrementalSyncResult,
  type SyncCompleteness,
  type SyncDiagnostics,
  type SyncFreshness,
  type SyncScope,
  type TotalSyncPayload,
} from "@io/graph-sync";
import { materializeGraphWriteTransactionSnapshot } from "@io/graph-sync";

import {
  createEdgeIndex,
  createFieldAuthorityPolicyIndex,
  filterReplicatedSnapshot,
  filterReplicatedWriteResult,
} from "./authority-replication";
import type { AuthoritativeGraphWriteSession, ReplicationReadAuthorizer } from "./authority-types";
import {
  prepareAuthoritativeGraphWriteResult,
  validateAuthoritativeGraphWriteTransaction,
} from "./authority-validation";
import {
  createTransactionValidationIssue,
  invalidTransactionResult,
} from "./authority-validation-helpers";
import {
  GraphValidationError,
  type GraphValidationIssue,
  type GraphValidationResult,
} from "./client";
import type { AnyTypeOutput } from "./schema";
import { createStore, type GraphStore, type GraphStoreSnapshot } from "./store";

function buildAuthoritativeGraphWriteReplayResult(
  result: AuthoritativeGraphWriteResult,
): AuthoritativeGraphWriteResult {
  return cloneAuthoritativeGraphWriteResult(result, { replayed: true });
}

function cloneAuthoritativeGraphWriteHistory(
  history: AuthoritativeGraphWriteHistory,
): AuthoritativeGraphWriteHistory {
  return {
    cursorPrefix: history.cursorPrefix,
    retainedHistoryPolicy: cloneAuthoritativeGraphRetainedHistoryPolicy(
      history.retainedHistoryPolicy,
    ),
    baseSequence: history.baseSequence,
    results: history.results.map((result) => cloneAuthoritativeGraphWriteResult(result)),
  };
}

function normalizeAuthoritativeGraphRetainedHistoryPolicy(
  policy: AuthoritativeGraphRetainedHistoryPolicy,
): AuthoritativeGraphRetainedHistoryPolicy {
  if (policy.kind === "all") {
    return unboundedAuthoritativeGraphRetainedHistoryPolicy;
  }

  if (!Number.isInteger(policy.maxTransactions) || policy.maxTransactions < 1) {
    throw new Error(
      "Authoritative graph write sessions require transaction-count retained-history policies to use a positive integer maxTransactions value.",
    );
  }

  return {
    kind: "transaction-count",
    maxTransactions: policy.maxTransactions,
  };
}

type AuthoritativeGraphWriteRecord =
  | {
      ok: true;
      transaction: GraphWriteTransaction;
      result: AuthoritativeGraphWriteResult;
    }
  | {
      ok: false;
      transaction: GraphWriteTransaction;
      result: Extract<GraphValidationResult<GraphWriteTransaction>, { ok: false }>;
    };

function normalizePreparedTransactionResult(result: {
  value: GraphWriteTransaction;
  issues: readonly Pick<GraphValidationIssue, "code" | "message" | "path">[];
}): Extract<GraphValidationResult<GraphWriteTransaction>, { ok: false }> {
  return invalidTransactionResult(
    result.value,
    result.issues.map((issue) =>
      createTransactionValidationIssue(issue.path, issue.code, issue.message),
    ),
  );
}

export function createAuthoritativeGraphWriteSession<const T extends Record<string, AnyTypeOutput>>(
  store: GraphStore,
  namespace: T,
  options: {
    cursorPrefix?: string;
    initialSequence?: number;
    history?: readonly AuthoritativeGraphWriteResult[];
    retainedHistoryPolicy?: AuthoritativeGraphRetainedHistoryPolicy;
  } = {},
): AuthoritativeGraphWriteSession {
  const cursorPrefix = options.cursorPrefix ?? "tx:";
  let baseSequence = options.initialSequence ?? 0;
  const retainedHistoryPolicy = normalizeAuthoritativeGraphRetainedHistoryPolicy(
    options.retainedHistoryPolicy ?? unboundedAuthoritativeGraphRetainedHistoryPolicy,
  );
  const policiesByTypeId = createFieldAuthorityPolicyIndex(namespace);
  if (!Number.isInteger(baseSequence) || baseSequence < 0) {
    throw new Error(
      "Authoritative graph write sessions require a non-negative integer initial sequence.",
    );
  }
  const txRecords = new Map<string, AuthoritativeGraphWriteRecord>();
  const acceptedResults: AuthoritativeGraphWriteResult[] = [];
  const cursorToIndex = new Map<string, number>();
  let sequence = baseSequence;

  function rebuildRetainedCursorIndex(): void {
    cursorToIndex.clear();
    acceptedResults.forEach((result, index) => {
      cursorToIndex.set(result.cursor, index);
    });
  }

  function enforceRetentionWindow(): void {
    if (retainedHistoryPolicy.kind !== "transaction-count") return;
    if (acceptedResults.length <= retainedHistoryPolicy.maxTransactions) return;
    const pruneCount = acceptedResults.length - retainedHistoryPolicy.maxTransactions;
    acceptedResults.splice(0, pruneCount);
    baseSequence += pruneCount;
    rebuildRetainedCursorIndex();
  }

  function baseCursor(): string {
    return formatAuthoritativeGraphCursor(cursorPrefix, baseSequence);
  }

  function currentCursor(): string | undefined {
    return sequence > 0 ? formatAuthoritativeGraphCursor(cursorPrefix, sequence) : undefined;
  }

  function currentHeadCursor(): string {
    return currentCursor() ?? baseCursor();
  }

  function currentSyncDiagnostics(): SyncDiagnostics {
    return {
      retainedHistoryPolicy: cloneAuthoritativeGraphRetainedHistoryPolicy(retainedHistoryPolicy),
      retainedBaseCursor: baseCursor(),
    };
  }

  function cloneAcceptedResults(startIndex = 0): AuthoritativeGraphWriteResult[] {
    return acceptedResults
      .slice(startIndex)
      .map((result) => cloneAuthoritativeGraphWriteResult(result));
  }

  function getChangesAfter(cursor?: string): AuthoritativeGraphChangesAfterResult {
    if (cursor === undefined || cursor === baseCursor()) {
      return {
        kind: "changes",
        cursor: currentHeadCursor(),
        changes: cloneAcceptedResults(),
      };
    }

    if (cursor === currentHeadCursor()) {
      return {
        kind: "changes",
        cursor,
        changes: [],
      };
    }

    const index = cursorToIndex.get(cursor);
    if (index === undefined) {
      return {
        kind: "reset",
        cursor: currentHeadCursor(),
        changes: [],
      };
    }

    return {
      kind: "changes",
      cursor: currentHeadCursor(),
      changes: cloneAcceptedResults(index + 1),
    };
  }

  function getIncrementalSyncResult(
    after = baseCursor(),
    options: {
      authorizeRead?: ReplicationReadAuthorizer;
      freshness?: SyncFreshness;
    } = {},
  ): IncrementalSyncResult {
    const changes = getChangesAfter(after);
    if (changes.kind === "changes") {
      const edgeById = createEdgeIndex(store.snapshot());
      const transactions = changes.changes.flatMap((result) => {
        const filtered = filterReplicatedWriteResult(result, store, policiesByTypeId, edgeById, {
          authorizeRead: options.authorizeRead,
        });
        return filtered ? [filtered] : [];
      });
      return createIncrementalSyncPayload(transactions, {
        after,
        cursor: changes.cursor,
        freshness: options.freshness,
        diagnostics: currentSyncDiagnostics(),
      });
    }

    return createIncrementalSyncFallback(
      classifyIncrementalSyncFallbackReason(after, {
        cursorPrefix,
        baseSequence,
      }),
      {
        after,
        cursor: changes.cursor,
        freshness: options.freshness,
        diagnostics: currentSyncDiagnostics(),
      },
    );
  }

  const history = options.history ?? [];
  history.forEach((result, index) => {
    const prepared = prepareAuthoritativeGraphWriteResult(result);
    if (!prepared.ok) throw new GraphValidationError(prepared.result);

    const normalized = cloneAuthoritativeGraphWriteResult(prepared.value, { replayed: false });
    const expectedCursor = formatAuthoritativeGraphCursor(cursorPrefix, baseSequence + index + 1);
    if (normalized.cursor !== expectedCursor) {
      throw new Error(
        `Invalid authoritative graph write history at index ${index}: expected cursor "${expectedCursor}".`,
      );
    }
    if (txRecords.has(normalized.txId)) {
      throw new Error(
        `Invalid authoritative graph write history at index ${index}: duplicate transaction id "${normalized.txId}".`,
      );
    }

    txRecords.set(normalized.txId, {
      ok: true,
      transaction: normalized.transaction,
      result: normalized,
    });
    acceptedResults.push(normalized);
  });
  rebuildRetainedCursorIndex();
  enforceRetentionWindow();
  sequence = baseSequence + acceptedResults.length;

  function getHistory(): AuthoritativeGraphWriteHistory {
    return cloneAuthoritativeGraphWriteHistory({
      cursorPrefix,
      retainedHistoryPolicy,
      baseSequence,
      results: acceptedResults,
    });
  }

  function getRetainedHistoryPolicy(): AuthoritativeGraphRetainedHistoryPolicy {
    return cloneAuthoritativeGraphRetainedHistoryPolicy(retainedHistoryPolicy);
  }

  function apply(
    transaction: GraphWriteTransaction,
    options: {
      writeScope?: AuthoritativeWriteScope;
    } = {},
  ): AuthoritativeGraphWriteResult {
    return applyWithSnapshot(transaction, options).result;
  }

  function applyWithSnapshot(
    transaction: GraphWriteTransaction,
    options: {
      writeScope?: AuthoritativeWriteScope;
      sourceSnapshot?: GraphStoreSnapshot;
    } = {},
  ): {
    result: AuthoritativeGraphWriteResult;
    snapshot: GraphStoreSnapshot;
  } {
    const validationStore = options.sourceSnapshot ? createStore(options.sourceSnapshot) : store;
    const preparedTransaction = prepareGraphWriteTransaction(transaction);
    if (!preparedTransaction.ok) {
      throw new GraphValidationError(
        normalizePreparedTransactionResult(preparedTransaction.result),
      );
    }

    const normalizedTransaction = preparedTransaction.value;
    const existing = txRecords.get(normalizedTransaction.id);
    if (existing) {
      if (!sameGraphWriteTransaction(existing.transaction, normalizedTransaction)) {
        throw new GraphValidationError(
          invalidTransactionResult(normalizedTransaction, [
            createTransactionValidationIssue(
              ["id"],
              "sync.tx.id.conflict",
              'Field "id" must not be reused for a different transaction.',
            ),
          ]),
        );
      }

      if (existing.ok) {
        return {
          result: buildAuthoritativeGraphWriteReplayResult(existing.result),
          snapshot: options.sourceSnapshot ?? store.snapshot(),
        };
      }
      throw new GraphValidationError(existing.result);
    }

    const prepared = validateAuthoritativeGraphWriteTransaction(
      normalizedTransaction,
      validationStore,
      namespace,
      {
        writeScope: options.writeScope,
      },
    );
    if (!prepared.ok) throw new GraphValidationError(prepared);

    const materialized = materializeGraphWriteTransactionSnapshot(validationStore, prepared.value, {
      sourceSnapshot: options.sourceSnapshot,
    });
    if (!materialized.ok) throw new Error("Validated transactions must materialize successfully.");

    store.replace(materialized.value);
    sequence += 1;
    const storedResult: AuthoritativeGraphWriteResult = {
      txId: prepared.value.id,
      cursor: formatAuthoritativeGraphCursor(cursorPrefix, sequence),
      replayed: false,
      writeScope: options.writeScope ?? "client-tx",
      transaction: prepared.value,
    };
    txRecords.set(prepared.value.id, {
      ok: true,
      transaction: prepared.value,
      result: storedResult,
    });
    acceptedResults.push(storedResult);
    rebuildRetainedCursorIndex();
    enforceRetentionWindow();
    return {
      result: cloneAuthoritativeGraphWriteResult(storedResult),
      snapshot: materialized.value,
    };
  }

  return {
    apply,
    applyWithSnapshot,
    getBaseCursor: baseCursor,
    getChangesAfter,
    getIncrementalSyncResult,
    getCursor: currentCursor,
    getHistory,
    getRetainedHistoryPolicy,
  };
}

export function createAuthoritativeTotalSyncPayload<const T extends Record<string, AnyTypeOutput>>(
  store: GraphStore,
  namespace: T,
  options: {
    authorizeRead?: ReplicationReadAuthorizer;
    completeness?: SyncCompleteness;
    cursor?: string;
    diagnostics?: SyncDiagnostics;
    freshness?: SyncFreshness;
    scope?: SyncScope;
  } = {},
): TotalSyncPayload {
  return {
    mode: "total",
    scope: cloneSyncScope(options.scope ?? graphSyncScope),
    snapshot: filterReplicatedSnapshot(store, namespace, {
      authorizeRead: options.authorizeRead,
    }),
    cursor: options.cursor ?? "full",
    completeness: options.completeness ?? "complete",
    freshness: options.freshness ?? "current",
    ...(options.diagnostics ? { diagnostics: cloneSyncDiagnostics(options.diagnostics) } : {}),
  };
}

function formatAuthoritativeGraphCursor(prefix: string, sequence: number): string {
  return `${prefix}${sequence}`;
}

export type { AuthoritativeGraphWriteSession, ReplicationReadAuthorizer } from "./authority-types";
