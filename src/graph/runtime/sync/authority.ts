import { GraphValidationError, type GraphValidationResult } from "../client";
import type { AnyTypeOutput } from "../schema";
import type { Store } from "../store";
import {
  cloneAuthoritativeGraphWriteResult,
  type AuthoritativeGraphChangesAfterResult,
  type AuthoritativeGraphWriteHistory,
  type AuthoritativeGraphWriteResult,
  type AuthoritativeGraphWriteSession,
  type AuthoritativeWriteScope,
  type GraphWriteTransaction,
  type IncrementalSyncResult,
  type SyncFreshness,
} from "./contracts";
import { classifyIncrementalSyncFallbackReason, formatAuthoritativeGraphCursor } from "./cursor";
import {
  createEdgeIndex,
  createFieldAuthorityPolicyIndex,
  filterReplicatedWriteResult,
} from "./replication";
import {
  materializeGraphWriteTransactionSnapshot,
  prepareGraphWriteTransaction,
  sameGraphWriteTransaction,
} from "./transactions";
import {
  createIncrementalSyncFallback,
  createIncrementalSyncPayload,
  prepareAuthoritativeGraphWriteResult,
  validateAuthoritativeGraphWriteTransaction,
} from "./validation";
import { createTransactionValidationIssue, invalidTransactionResult } from "./validation-helpers";

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
    baseSequence: history.baseSequence,
    results: history.results.map((result) => cloneAuthoritativeGraphWriteResult(result)),
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

export function createAuthoritativeGraphWriteSession<const T extends Record<string, AnyTypeOutput>>(
  store: Store,
  namespace: T,
  options: {
    cursorPrefix?: string;
    initialSequence?: number;
    history?: readonly AuthoritativeGraphWriteResult[];
    maxRetainedResults?: number;
  } = {},
): AuthoritativeGraphWriteSession {
  const cursorPrefix = options.cursorPrefix ?? "tx:";
  let baseSequence = options.initialSequence ?? 0;
  const maxRetainedResults = options.maxRetainedResults;
  const policiesByTypeId = createFieldAuthorityPolicyIndex(namespace);
  if (!Number.isInteger(baseSequence) || baseSequence < 0) {
    throw new Error(
      "Authoritative graph write sessions require a non-negative integer initial sequence.",
    );
  }
  if (
    maxRetainedResults !== undefined &&
    (!Number.isInteger(maxRetainedResults) || maxRetainedResults < 1)
  ) {
    throw new Error(
      "Authoritative graph write sessions require maxRetainedResults to be a positive integer.",
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
    if (maxRetainedResults === undefined || acceptedResults.length <= maxRetainedResults) return;
    const pruneCount = acceptedResults.length - maxRetainedResults;
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
      freshness?: SyncFreshness;
    } = {},
  ): IncrementalSyncResult {
    const changes = getChangesAfter(after);
    if (changes.kind === "changes") {
      const edgeById = createEdgeIndex(store.snapshot());
      const transactions = changes.changes.flatMap((result) => {
        const filtered = filterReplicatedWriteResult(result, store, policiesByTypeId, edgeById);
        return filtered ? [filtered] : [];
      });
      return createIncrementalSyncPayload(transactions, {
        after,
        cursor: changes.cursor,
        freshness: options.freshness,
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
      baseSequence,
      results: acceptedResults,
    });
  }

  function apply(
    transaction: GraphWriteTransaction,
    options: {
      writeScope?: AuthoritativeWriteScope;
    } = {},
  ): AuthoritativeGraphWriteResult {
    const prepared = prepareGraphWriteTransaction(transaction);
    if (!prepared.ok) throw new GraphValidationError(prepared.result);

    const existing = txRecords.get(prepared.value.id);
    if (existing) {
      if (!sameGraphWriteTransaction(existing.transaction, prepared.value)) {
        throw new GraphValidationError(
          invalidTransactionResult(prepared.value, [
            createTransactionValidationIssue(
              ["id"],
              "sync.tx.id.conflict",
              'Field "id" must not be reused for a different transaction.',
            ),
          ]),
        );
      }

      if (existing.ok) return buildAuthoritativeGraphWriteReplayResult(existing.result);
      throw new GraphValidationError(existing.result);
    }

    const materialized = materializeGraphWriteTransactionSnapshot(store, prepared.value);
    if (!materialized.ok) {
      txRecords.set(prepared.value.id, {
        ok: false,
        transaction: prepared.value,
        result: materialized.result,
      });
      throw new GraphValidationError(materialized.result);
    }

    const validation = validateAuthoritativeGraphWriteTransaction(
      prepared.value,
      store,
      namespace,
      {
        writeScope: options.writeScope,
      },
    );
    if (!validation.ok) {
      txRecords.set(prepared.value.id, {
        ok: false,
        transaction: prepared.value,
        result: validation,
      });
      throw new GraphValidationError(validation);
    }

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
    return cloneAuthoritativeGraphWriteResult(storedResult);
  }

  return {
    apply,
    getBaseCursor: baseCursor,
    getChangesAfter,
    getIncrementalSyncResult,
    getCursor: currentCursor,
    getHistory,
  };
}
