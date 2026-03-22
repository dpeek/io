import {
  GraphValidationError,
  validateGraphStore,
  type GraphValidationIssue,
  type GraphValidationResult,
} from "../client";
import type { AnyTypeOutput } from "../schema";
import { createStore, type Store, type StoreSnapshot } from "../store";
import {
  cloneAuthoritativeGraphWriteResult,
  cloneGraphWriteTransaction,
  graphSyncScope,
  isAuthoritativeWriteScope,
  isObjectRecord,
  type AuthoritativeGraphWriteResult,
  type AuthoritativeGraphWriteResultValidator,
  type AuthoritativeWriteScope,
  type GraphWriteTransaction,
  type IncrementalSyncFallback,
  type IncrementalSyncFallbackReason,
  type IncrementalSyncPayload,
  type IncrementalSyncResult,
  type SyncFreshness,
  type TotalSyncPayload,
  type TotalSyncPayloadValidator,
} from "./contracts";
import { isCursorAtOrAfter, parseAuthoritativeGraphCursor } from "./cursor";
import { validateAuthoritativeFieldWritePolicies } from "./replication";
import {
  logicalFactKey,
  materializeGraphWriteTransactionSnapshot,
  prepareGraphWriteTransaction,
} from "./transactions";
import {
  createGraphWriteResultValidationIssue,
  createIncrementalSyncValidationIssue,
  createPayloadValidationIssue,
  exposeGraphWriteResultValidationResult,
  exposeGraphWriteValidationResult,
  exposeIncrementalSyncValidationResult,
  exposeTotalSyncValidationResult,
  invalidGraphWriteResult,
  invalidIncrementalSyncResult,
  invalidPayloadResult,
  invalidTransactionResult,
  prefixGraphWriteResultIssues,
  prefixIncrementalSyncTransactionIssues,
  withValidationValue,
} from "./validation-helpers";

function materializeTotalSyncPayload(
  payload: TotalSyncPayload,
  preserveSnapshot?: StoreSnapshot,
): TotalSyncPayload {
  if (
    !preserveSnapshot ||
    (preserveSnapshot.edges.length === 0 && preserveSnapshot.retracted.length === 0)
  ) {
    return payload;
  }

  const payloadFactKeys = new Set(payload.snapshot.edges.map((edge) => logicalFactKey(edge)));
  const edgeIds = new Set(payload.snapshot.edges.map((edge) => edge.id));
  const mergedRetractedIds = new Set(payload.snapshot.retracted);
  const edges = payload.snapshot.edges.map((edge) => ({ ...edge }));
  const retracted = [...payload.snapshot.retracted];

  for (const edge of preserveSnapshot.edges) {
    if (payloadFactKeys.has(logicalFactKey(edge))) continue;
    if (edgeIds.has(edge.id)) continue;
    edges.push({ ...edge });
    edgeIds.add(edge.id);
  }

  for (const edgeId of preserveSnapshot.retracted) {
    if (!edgeIds.has(edgeId) || mergedRetractedIds.has(edgeId)) continue;
    retracted.push(edgeId);
    mergedRetractedIds.add(edgeId);
  }

  return {
    ...payload,
    snapshot: {
      edges,
      retracted,
    },
  };
}

export function prepareTotalSyncPayload(
  payload: TotalSyncPayload,
  options: {
    preserveSnapshot?: StoreSnapshot;
  } = {},
):
  | {
      ok: true;
      value: TotalSyncPayload;
    }
  | {
      ok: false;
      result: Extract<GraphValidationResult<TotalSyncPayload>, { ok: false }>;
    } {
  const issues = validateTotalSyncPayloadShape(payload);
  if (issues.length > 0) {
    return {
      ok: false,
      result: invalidPayloadResult(payload, issues),
    };
  }

  return {
    ok: true,
    value: materializeTotalSyncPayload(payload, options.preserveSnapshot),
  };
}

export function prepareAuthoritativeGraphWriteResult(result: AuthoritativeGraphWriteResult):
  | {
      ok: true;
      value: AuthoritativeGraphWriteResult;
    }
  | {
      ok: false;
      result: Extract<GraphValidationResult<AuthoritativeGraphWriteResult>, { ok: false }>;
    } {
  const candidate = result as Partial<AuthoritativeGraphWriteResult> & Record<string, unknown>;
  const issues: GraphValidationIssue[] = [];

  if (typeof candidate.txId !== "string") {
    issues.push(
      createGraphWriteResultValidationIssue(
        ["txId"],
        "sync.txResult.txId",
        'Field "txId" must be a string.',
      ),
    );
  } else if (candidate.txId.length === 0) {
    issues.push(
      createGraphWriteResultValidationIssue(
        ["txId"],
        "sync.txResult.txId.empty",
        'Field "txId" must not be empty.',
      ),
    );
  }

  if (typeof candidate.cursor !== "string") {
    issues.push(
      createGraphWriteResultValidationIssue(
        ["cursor"],
        "sync.txResult.cursor",
        'Field "cursor" must be a string.',
      ),
    );
  } else if (candidate.cursor.length === 0) {
    issues.push(
      createGraphWriteResultValidationIssue(
        ["cursor"],
        "sync.txResult.cursor.empty",
        'Field "cursor" must not be empty.',
      ),
    );
  }

  if (typeof candidate.replayed !== "boolean") {
    issues.push(
      createGraphWriteResultValidationIssue(
        ["replayed"],
        "sync.txResult.replayed",
        'Field "replayed" must be a boolean.',
      ),
    );
  }

  let writeScope: AuthoritativeWriteScope = "client-tx";
  if (candidate.writeScope !== undefined) {
    if (!isAuthoritativeWriteScope(candidate.writeScope)) {
      issues.push(
        createGraphWriteResultValidationIssue(
          ["writeScope"],
          "sync.txResult.writeScope",
          'Field "writeScope" must be "client-tx", "server-command", or "authority-only".',
        ),
      );
    } else {
      writeScope = candidate.writeScope;
    }
  }

  const transaction = cloneGraphWriteTransaction(
    isObjectRecord(candidate.transaction)
      ? (candidate.transaction as GraphWriteTransaction)
      : ({ id: "", ops: [] } as GraphWriteTransaction),
  );
  const preparedTransaction = prepareGraphWriteTransaction(transaction);
  let normalizedTransaction = transaction;
  if (!preparedTransaction.ok) {
    issues.push(...prefixGraphWriteResultIssues(preparedTransaction.result.issues));
  } else {
    normalizedTransaction = preparedTransaction.value;
  }

  if (typeof candidate.txId === "string" && candidate.txId !== transaction.id) {
    issues.push(
      createGraphWriteResultValidationIssue(
        ["txId"],
        "sync.txResult.txId.mismatch",
        'Field "txId" must match "transaction.id".',
      ),
    );
  }

  const cloned = cloneAuthoritativeGraphWriteResult({
    txId: typeof candidate.txId === "string" ? candidate.txId : "",
    cursor: typeof candidate.cursor === "string" ? candidate.cursor : "",
    replayed: typeof candidate.replayed === "boolean" ? candidate.replayed : false,
    writeScope,
    transaction,
  });

  if (issues.length > 0) {
    return {
      ok: false,
      result: invalidGraphWriteResult(cloned, issues),
    };
  }

  return {
    ok: true,
    value: {
      ...cloned,
      transaction: normalizedTransaction,
    },
  };
}

function validateStoreSnapshotShape(snapshot: unknown): readonly GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  if (!isObjectRecord(snapshot)) {
    issues.push(
      createPayloadValidationIssue(
        ["snapshot"],
        "sync.snapshot",
        'Field "snapshot" must be a store snapshot object.',
      ),
    );
    return issues;
  }

  const edgeIds = new Set<string>();

  if (!Array.isArray(snapshot.edges)) {
    issues.push(
      createPayloadValidationIssue(
        ["snapshot", "edges"],
        "sync.snapshot.edges",
        'Field "snapshot.edges" must be an array.',
      ),
    );
  } else {
    snapshot.edges.forEach((edge, index) => {
      const edgePath = `edges[${index}]`;
      if (!isObjectRecord(edge)) {
        issues.push(
          createPayloadValidationIssue(
            ["snapshot", edgePath],
            "sync.snapshot.edge",
            `Field "snapshot.${edgePath}" must be an edge object.`,
          ),
        );
        return;
      }

      for (const key of ["id", "s", "p", "o"] as const) {
        const value = edge[key];
        if (typeof value !== "string") {
          issues.push(
            createPayloadValidationIssue(
              ["snapshot", edgePath, key],
              `sync.snapshot.edge.${key}`,
              `Field "snapshot.${edgePath}.${key}" must be a string.`,
            ),
          );
        }
      }

      if (typeof edge.id !== "string") return;
      if (edgeIds.has(edge.id)) {
        issues.push(
          createPayloadValidationIssue(
            ["snapshot", edgePath, "id"],
            "sync.snapshot.edge.id.duplicate",
            `Field "snapshot.${edgePath}.id" must be unique within the snapshot.`,
          ),
        );
        return;
      }
      edgeIds.add(edge.id);
    });
  }

  if (!Array.isArray(snapshot.retracted)) {
    issues.push(
      createPayloadValidationIssue(
        ["snapshot", "retracted"],
        "sync.snapshot.retracted",
        'Field "snapshot.retracted" must be an array.',
      ),
    );
  } else {
    snapshot.retracted.forEach((edgeId, index) => {
      const retractedPath = `retracted[${index}]`;
      if (typeof edgeId !== "string") {
        issues.push(
          createPayloadValidationIssue(
            ["snapshot", retractedPath],
            "sync.snapshot.retracted.id",
            `Field "snapshot.${retractedPath}" must be a string edge id.`,
          ),
        );
        return;
      }

      if (!edgeIds.has(edgeId)) {
        issues.push(
          createPayloadValidationIssue(
            ["snapshot", retractedPath],
            "sync.snapshot.retracted.missing",
            `Field "snapshot.${retractedPath}" must reference an edge id present in "snapshot.edges".`,
          ),
        );
      }
    });
  }

  return issues;
}

function validateTotalSyncPayloadShape(payload: TotalSyncPayload): readonly GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  const candidate = payload as Partial<TotalSyncPayload> & Record<string, unknown>;

  if (candidate.mode !== "total") {
    issues.push(
      createPayloadValidationIssue(["mode"], "sync.mode", 'Field "mode" must be "total".'),
    );
  }

  if (!isObjectRecord(candidate.scope) || candidate.scope.kind !== "graph") {
    issues.push(
      createPayloadValidationIssue(
        ["scope", "kind"],
        "sync.scope",
        'Field "scope.kind" must be "graph".',
      ),
    );
  }

  if (typeof candidate.cursor !== "string") {
    issues.push(
      createPayloadValidationIssue(["cursor"], "sync.cursor", 'Field "cursor" must be a string.'),
    );
  }

  if (candidate.completeness !== "complete") {
    issues.push(
      createPayloadValidationIssue(
        ["completeness"],
        "sync.completeness",
        'Field "completeness" must be "complete" for total sync payloads.',
      ),
    );
  }

  if (candidate.freshness !== "current" && candidate.freshness !== "stale") {
    issues.push(
      createPayloadValidationIssue(
        ["freshness"],
        "sync.freshness",
        'Field "freshness" must be "current" or "stale".',
      ),
    );
  }

  issues.push(...validateStoreSnapshotShape(candidate.snapshot));
  return issues;
}

function isIncrementalSyncFallbackReason(value: unknown): value is IncrementalSyncFallbackReason {
  return value === "unknown-cursor" || value === "gap" || value === "reset";
}

export function createIncrementalSyncPayload(
  transactions: readonly AuthoritativeGraphWriteResult[],
  options: {
    after: string;
    cursor?: string;
    freshness?: SyncFreshness;
  },
): IncrementalSyncPayload {
  return {
    mode: "incremental",
    scope: graphSyncScope,
    after: options.after,
    transactions: transactions.map((transaction) =>
      cloneAuthoritativeGraphWriteResult(transaction),
    ),
    cursor: options.cursor ?? transactions[transactions.length - 1]?.cursor ?? options.after,
    completeness: "complete",
    freshness: options.freshness ?? "current",
  };
}

export function createIncrementalSyncFallback(
  fallback: IncrementalSyncFallbackReason,
  options: {
    after: string;
    cursor: string;
    freshness?: SyncFreshness;
  },
): IncrementalSyncFallback {
  return {
    mode: "incremental",
    scope: graphSyncScope,
    after: options.after,
    transactions: [],
    cursor: options.cursor,
    completeness: "complete",
    freshness: options.freshness ?? "current",
    fallback,
  };
}

function validateIncrementalSyncPayloadShape(
  payload: IncrementalSyncPayload,
  options: {
    allowFallback: boolean;
  } = {
    allowFallback: false,
  },
): {
  issues: GraphValidationIssue[];
  value: IncrementalSyncResult;
} {
  const issues: GraphValidationIssue[] = [];
  const candidate = payload as Partial<IncrementalSyncResult> & Record<string, unknown>;
  const transactions: AuthoritativeGraphWriteResult[] = [];
  const txIds = new Set<string>();
  const cursors = new Set<string>();

  if (candidate.mode !== "incremental") {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["mode"],
        "sync.incremental.mode",
        'Field "mode" must be "incremental".',
      ),
    );
  }

  if (!isObjectRecord(candidate.scope) || candidate.scope.kind !== "graph") {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["scope", "kind"],
        "sync.incremental.scope",
        'Field "scope.kind" must be "graph".',
      ),
    );
  }

  if (typeof candidate.after !== "string") {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["after"],
        "sync.incremental.after",
        'Field "after" must be a string.',
      ),
    );
  } else if (candidate.after.length === 0) {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["after"],
        "sync.incremental.after.empty",
        'Field "after" must not be empty.',
      ),
    );
  }

  if (typeof candidate.cursor !== "string") {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["cursor"],
        "sync.incremental.cursor",
        'Field "cursor" must be a string.',
      ),
    );
  } else if (candidate.cursor.length === 0) {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["cursor"],
        "sync.incremental.cursor.empty",
        'Field "cursor" must not be empty.',
      ),
    );
  }

  if (candidate.completeness !== "complete") {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["completeness"],
        "sync.incremental.completeness",
        'Field "completeness" must be "complete" for graph-scoped incremental sync.',
      ),
    );
  }

  if (candidate.freshness !== "current" && candidate.freshness !== "stale") {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["freshness"],
        "sync.incremental.freshness",
        'Field "freshness" must be "current" or "stale".',
      ),
    );
  }

  if (!Array.isArray(candidate.transactions)) {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["transactions"],
        "sync.incremental.transactions",
        'Field "transactions" must be an array.',
      ),
    );
  } else {
    candidate.transactions.forEach((transaction, index) => {
      if (isObjectRecord(transaction) && transaction.replayed === true) {
        issues.push(
          createIncrementalSyncValidationIssue(
            [`transactions[${index}]`, "replayed"],
            "sync.incremental.transaction.replayed",
            `Field "transactions[${index}].replayed" must be false for incremental pull delivery.`,
          ),
        );
      }

      const prepared = prepareAuthoritativeGraphWriteResult(
        cloneAuthoritativeGraphWriteResult(
          isObjectRecord(transaction)
            ? (transaction as AuthoritativeGraphWriteResult)
            : {
                txId: "",
                cursor: "",
                replayed: false,
                writeScope: "client-tx",
                transaction: {
                  id: "",
                  ops: [],
                },
              },
        ),
      );
      if (!prepared.ok) {
        issues.push(...prefixIncrementalSyncTransactionIssues(index, prepared.result.issues));
        return;
      }

      const value = cloneAuthoritativeGraphWriteResult(prepared.value);

      if (txIds.has(value.txId)) {
        issues.push(
          createIncrementalSyncValidationIssue(
            [`transactions[${index}]`, "txId"],
            "sync.incremental.transaction.txId.duplicate",
            `Field "transactions[${index}].txId" must be unique within the incremental result.`,
          ),
        );
      } else {
        txIds.add(value.txId);
      }

      if (cursors.has(value.cursor)) {
        issues.push(
          createIncrementalSyncValidationIssue(
            [`transactions[${index}]`, "cursor"],
            "sync.incremental.transaction.cursor.duplicate",
            `Field "transactions[${index}].cursor" must be unique within the incremental result.`,
          ),
        );
      } else {
        cursors.add(value.cursor);
      }

      if (
        typeof candidate.after === "string" &&
        candidate.after.length > 0 &&
        value.cursor === candidate.after
      ) {
        issues.push(
          createIncrementalSyncValidationIssue(
            [`transactions[${index}]`, "cursor"],
            "sync.incremental.transaction.cursor.after",
            `Field "transactions[${index}].cursor" must be strictly after "after".`,
          ),
        );
      }

      transactions.push(value);
    });
  }

  const after = typeof candidate.after === "string" ? candidate.after : "";
  const cursor = typeof candidate.cursor === "string" ? candidate.cursor : "";
  const freshness = candidate.freshness === "stale" ? "stale" : "current";
  const hasFallback = "fallback" in candidate;
  const fallbackReason = isIncrementalSyncFallbackReason(candidate.fallback)
    ? candidate.fallback
    : "unknown-cursor";

  if (!options.allowFallback && hasFallback) {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["fallback"],
        "sync.incremental.fallback.unexpected",
        'Field "fallback" is only valid on incremental pull results that require total-sync recovery.',
      ),
    );
  }

  if (options.allowFallback && hasFallback) {
    if (!isIncrementalSyncFallbackReason(candidate.fallback)) {
      issues.push(
        createIncrementalSyncValidationIssue(
          ["fallback"],
          "sync.incremental.fallback",
          'Field "fallback" must be "unknown-cursor", "gap", or "reset".',
        ),
      );
    }

    if (Array.isArray(candidate.transactions) && candidate.transactions.length > 0) {
      issues.push(
        createIncrementalSyncValidationIssue(
          ["transactions"],
          "sync.incremental.fallback.transactions",
          'Field "transactions" must be empty when "fallback" is present.',
        ),
      );
    }
  }

  if (!hasFallback) {
    const parsedAfter =
      typeof candidate.after === "string" ? parseAuthoritativeGraphCursor(candidate.after) : null;
    const parsedCursor =
      typeof candidate.cursor === "string" ? parseAuthoritativeGraphCursor(candidate.cursor) : null;

    if (transactions.length === 0) {
      if (parsedAfter && parsedCursor && !isCursorAtOrAfter(parsedCursor, parsedAfter)) {
        issues.push(
          createIncrementalSyncValidationIssue(
            ["cursor"],
            "sync.incremental.cursor.head",
            'Field "cursor" must not move before "after" when "transactions" is empty.',
          ),
        );
      }
    } else {
      const tail = transactions[transactions.length - 1];
      const parsedTail = tail ? parseAuthoritativeGraphCursor(tail.cursor) : null;
      if (parsedTail && parsedCursor && !isCursorAtOrAfter(parsedCursor, parsedTail)) {
        issues.push(
          createIncrementalSyncValidationIssue(
            ["cursor"],
            "sync.incremental.cursor.tail",
            'Field "cursor" must not move before the last delivered transaction cursor.',
          ),
        );
      }
    }
  }

  return {
    issues,
    value:
      options.allowFallback && hasFallback
        ? createIncrementalSyncFallback(fallbackReason, {
            after,
            cursor,
            freshness,
          })
        : createIncrementalSyncPayload(transactions, {
            after,
            cursor,
            freshness,
          }),
  };
}

export function validateIncrementalSyncPayload(
  payload: IncrementalSyncPayload,
): GraphValidationResult<IncrementalSyncPayload> {
  const prepared = validateIncrementalSyncPayloadShape(payload);
  if (prepared.issues.length > 0) {
    return exposeIncrementalSyncValidationResult(
      invalidIncrementalSyncResult(prepared.value, prepared.issues),
    ) as GraphValidationResult<IncrementalSyncPayload>;
  }

  return exposeIncrementalSyncValidationResult({
    ok: true,
    phase: "authoritative",
    event: "reconcile",
    value: prepared.value,
    changedPredicateKeys: [],
  }) as GraphValidationResult<IncrementalSyncPayload>;
}

export function validateIncrementalSyncResult(
  result: IncrementalSyncResult,
): GraphValidationResult<IncrementalSyncResult> {
  const prepared = validateIncrementalSyncPayloadShape(result as IncrementalSyncPayload, {
    allowFallback: true,
  });
  if (prepared.issues.length > 0) {
    return exposeIncrementalSyncValidationResult(
      invalidIncrementalSyncResult(prepared.value, prepared.issues),
    );
  }

  return exposeIncrementalSyncValidationResult({
    ok: true,
    phase: "authoritative",
    event: "reconcile",
    value: prepared.value,
    changedPredicateKeys: [],
  });
}

function validateIncrementalSyncCursorSequence(
  result: IncrementalSyncPayload,
): readonly GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  const after = parseAuthoritativeGraphCursor(result.after);

  if (!after) {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["after"],
        "sync.incremental.after.cursor",
        'Field "after" must be a cursor with a trailing numeric sequence before incremental apply.',
      ),
    );
    return issues;
  }

  let previous = after;
  for (const [index, transaction] of result.transactions.entries()) {
    const current = parseAuthoritativeGraphCursor(transaction.cursor);
    if (!current) {
      issues.push(
        createIncrementalSyncValidationIssue(
          [`transactions[${index}]`, "cursor"],
          "sync.incremental.transaction.cursor.sequence",
          `Field "transactions[${index}].cursor" must be a cursor with a trailing numeric sequence.`,
        ),
      );
      continue;
    }

    if (!isCursorAtOrAfter(current, previous) || current.sequence === previous.sequence) {
      issues.push(
        createIncrementalSyncValidationIssue(
          [`transactions[${index}]`, "cursor"],
          "sync.incremental.transaction.cursor.sequence",
          `Field "transactions[${index}].cursor" must move forward from the previous visible cursor.`,
        ),
      );
      continue;
    }

    previous = current;
  }

  const cursor = parseAuthoritativeGraphCursor(result.cursor);
  if (!cursor) {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["cursor"],
        "sync.incremental.cursor.sequence",
        'Field "cursor" must be a cursor with a trailing numeric sequence.',
      ),
    );
  } else if (!isCursorAtOrAfter(cursor, previous)) {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["cursor"],
        "sync.incremental.cursor.sequence",
        'Field "cursor" must not move before the last delivered cursor.',
      ),
    );
  }

  return issues;
}

export function prepareIncrementalSyncResultForApply(
  store: Store,
  result: IncrementalSyncResult,
  currentCursor: string | undefined,
  options: {
    validateWriteResult?: AuthoritativeGraphWriteResultValidator;
  } = {},
):
  | {
      ok: true;
      value: IncrementalSyncPayload;
      snapshot?: StoreSnapshot;
    }
  | {
      ok: false;
      result:
        | Extract<GraphValidationResult<IncrementalSyncResult>, { ok: false }>
        | Extract<GraphValidationResult<AuthoritativeGraphWriteResult>, { ok: false }>;
    } {
  const validation = validateIncrementalSyncResult(result);
  if (!validation.ok) {
    return {
      ok: false,
      result: validation,
    };
  }

  const materialized = validation.value;
  if ("fallback" in materialized) {
    return {
      ok: false,
      result: invalidIncrementalSyncResult(materialized, [
        createIncrementalSyncValidationIssue(
          ["fallback"],
          "sync.incremental.recovery",
          `Incremental sync requires total snapshot recovery because the authority reported "${materialized.fallback}".`,
        ),
      ]),
    };
  }

  if (
    typeof currentCursor !== "string" ||
    currentCursor.length === 0 ||
    materialized.after !== currentCursor
  ) {
    return {
      ok: false,
      result: invalidIncrementalSyncResult(materialized, [
        createIncrementalSyncValidationIssue(
          ["after"],
          "sync.incremental.after.current",
          'Field "after" must match the current sync cursor before incremental apply.',
        ),
      ]),
    };
  }

  const cursorIssues = validateIncrementalSyncCursorSequence(materialized);
  if (cursorIssues.length > 0) {
    return {
      ok: false,
      result: invalidIncrementalSyncResult(materialized, cursorIssues),
    };
  }

  if (materialized.transactions.length === 0) {
    return {
      ok: true,
      value: materialized,
    };
  }

  const validationStore = createStore(store.snapshot());

  for (const transaction of materialized.transactions) {
    const candidateSnapshot = materializeGraphWriteTransactionSnapshot(
      validationStore,
      transaction.transaction,
      {
        allowExistingAssertEdgeIds: true,
      },
    );
    if (!candidateSnapshot.ok) {
      return {
        ok: false,
        result: invalidGraphWriteResult(
          transaction,
          prefixGraphWriteResultIssues(candidateSnapshot.result.issues),
        ),
      };
    }

    try {
      options.validateWriteResult?.(transaction, validationStore);
    } catch (error) {
      if (error instanceof GraphValidationError) {
        return {
          ok: false,
          result: error.result as Extract<
            GraphValidationResult<AuthoritativeGraphWriteResult>,
            { ok: false }
          >,
        };
      }
      throw error;
    }

    validationStore.replace(candidateSnapshot.value);
  }

  return {
    ok: true,
    value: materialized,
    snapshot: validationStore.snapshot(),
  };
}

export function validateAuthoritativeTotalSyncPayload<
  const T extends Record<string, AnyTypeOutput>,
>(
  payload: TotalSyncPayload,
  namespace: T,
  options: {
    preserveSnapshot?: StoreSnapshot;
  } = {},
): GraphValidationResult<TotalSyncPayload> {
  const prepared = prepareTotalSyncPayload(payload, options);
  if (!prepared.ok) return prepared.result;

  const materialized = prepared.value;
  const validationStore = createStore(materialized.snapshot);
  return exposeTotalSyncValidationResult(
    withValidationValue(validateGraphStore(validationStore, namespace), materialized),
  );
}

export function validateAuthoritativeGraphWriteTransaction<
  const T extends Record<string, AnyTypeOutput>,
>(
  transaction: GraphWriteTransaction,
  store: Store,
  namespace: T,
  options: {
    writeScope?: AuthoritativeWriteScope;
  } = {},
): GraphValidationResult<GraphWriteTransaction> {
  const prepared = prepareGraphWriteTransaction(transaction);
  if (!prepared.ok) return prepared.result;

  const materialized = materializeGraphWriteTransactionSnapshot(store, prepared.value);
  if (!materialized.ok) return exposeGraphWriteValidationResult(materialized.result);
  const writePolicyIssues = validateAuthoritativeFieldWritePolicies(
    prepared.value,
    materialized.value,
    namespace,
    options.writeScope ?? "client-tx",
  );
  if (writePolicyIssues.length > 0) {
    return exposeGraphWriteValidationResult(
      invalidTransactionResult(prepared.value, writePolicyIssues),
    );
  }

  const validationStore = createStore(materialized.value);
  return exposeGraphWriteValidationResult(
    withValidationValue(validateGraphStore(validationStore, namespace), prepared.value),
  );
}

export function validateAuthoritativeGraphWriteResult<
  const T extends Record<string, AnyTypeOutput>,
>(
  result: AuthoritativeGraphWriteResult,
  store: Store,
  namespace: T,
): GraphValidationResult<AuthoritativeGraphWriteResult> {
  const prepared = prepareAuthoritativeGraphWriteResult(result);
  if (!prepared.ok) return prepared.result;

  const materialized = materializeGraphWriteTransactionSnapshot(store, prepared.value.transaction, {
    allowExistingAssertEdgeIds: true,
  });
  if (!materialized.ok) {
    return exposeGraphWriteResultValidationResult(
      invalidGraphWriteResult(
        prepared.value,
        prefixGraphWriteResultIssues(materialized.result.issues),
      ),
    );
  }

  const validationStore = createStore(materialized.value);
  return exposeGraphWriteResultValidationResult(
    withValidationValue(validateGraphStore(validationStore, namespace), prepared.value),
  );
}

export function createAuthoritativeTotalSyncValidator<
  const T extends Record<string, AnyTypeOutput>,
>(
  namespace: T,
  options: {
    preserveSnapshot?: StoreSnapshot;
  } = {},
): TotalSyncPayloadValidator {
  return (payload) => {
    const result = validateAuthoritativeTotalSyncPayload(payload, namespace, options);
    if (!result.ok) throw new GraphValidationError(result);
  };
}

export function createAuthoritativeGraphWriteResultValidator<
  const T extends Record<string, AnyTypeOutput>,
>(store: Store, namespace: T): AuthoritativeGraphWriteResultValidator {
  return (result, validationStore = store) => {
    const validation = validateAuthoritativeGraphWriteResult(result, validationStore, namespace);
    if (!validation.ok) throw new GraphValidationError(validation);
  };
}
