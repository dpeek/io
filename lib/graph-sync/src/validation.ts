import {
  createStore,
  cloneAuthoritativeGraphRetainedHistoryPolicy,
  cloneAuthoritativeGraphWriteResult,
  cloneGraphWriteTransaction,
  isAuthoritativeGraphRetainedHistoryPolicy,
  isAuthoritativeWriteScope,
  type AuthoritativeGraphRetainedHistoryPolicy,
  type AuthoritativeGraphWriteResult,
  type AuthoritativeWriteScope,
  type GraphStoreSnapshot,
  type GraphWriteTransaction,
} from "@io/graph-kernel";

import {
  cloneIncrementalSyncResult,
  cloneSyncDiagnostics,
  cloneSyncScope,
  cloneTotalSyncPayload,
  createModuleSyncScope,
  exposeGraphSyncValidationResult,
  graphSyncScope,
  isGraphSyncScope,
  isIncrementalSyncFallbackReason,
  isObjectRecord,
  isSyncCompleteness,
  isSyncFreshness,
  sameSyncScope,
  type AuthoritativeGraphWriteResultValidator,
  type GraphSyncValidationIssue,
  type GraphSyncValidationResult,
  type IncrementalSyncFallback,
  type IncrementalSyncFallbackReason,
  type IncrementalSyncPayload,
  type IncrementalSyncResult,
  type SyncCompleteness,
  type SyncDiagnostics,
  type SyncFreshness,
  type SyncPayload,
  type SyncScope,
  type TotalSyncPayload,
} from "./contracts";
import { isCursorAtOrAfter, parseAuthoritativeGraphCursor } from "./cursor";
import {
  logicalFactKey,
  materializeGraphWriteTransactionSnapshot,
  prepareGraphWriteTransaction,
} from "./transactions";

const totalSyncPayloadValidationKey = "$sync:payload";
const incrementalSyncValidationKey = "$sync:incremental";
const graphWriteTransactionValidationKey = "$sync:tx";
const graphWriteResultValidationKey = "$sync:txResult";

type SyncValidationIssueFactory = (
  path: string[],
  code: string,
  message: string,
) => GraphSyncValidationIssue;

const graphIncrementalFallbackReasons = new Set<IncrementalSyncFallbackReason>([
  "unknown-cursor",
  "gap",
  "reset",
]);

export function createGraphSyncValidationIssue(
  path: readonly string[],
  code: string,
  message: string,
  predicateKey = graphWriteTransactionValidationKey,
): GraphSyncValidationIssue {
  return {
    source: "sync",
    code,
    message,
    path: Object.freeze([...path]),
    predicateKey,
    nodeId: predicateKey,
  };
}

export function invalidTotalSyncPayloadResult(
  payload: TotalSyncPayload,
  issues: readonly GraphSyncValidationIssue[],
): Extract<GraphSyncValidationResult<TotalSyncPayload>, { ok: false }> {
  return {
    ok: false,
    phase: "authoritative",
    event: "reconcile",
    value: cloneTotalSyncPayload(payload),
    changedPredicateKeys: issues.length > 0 ? [totalSyncPayloadValidationKey] : [],
    issues,
  };
}

export function invalidIncrementalSyncResult(
  result: IncrementalSyncResult,
  issues: readonly GraphSyncValidationIssue[],
): Extract<GraphSyncValidationResult<IncrementalSyncResult>, { ok: false }> {
  return {
    ok: false,
    phase: "authoritative",
    event: "reconcile",
    value: cloneIncrementalSyncResult(result),
    changedPredicateKeys: issues.length > 0 ? [incrementalSyncValidationKey] : [],
    issues,
  };
}

export function invalidGraphWriteTransactionResult(
  transaction: GraphWriteTransaction,
  issues: readonly GraphSyncValidationIssue[],
): Extract<GraphSyncValidationResult<GraphWriteTransaction>, { ok: false }> {
  return {
    ok: false,
    phase: "authoritative",
    event: "reconcile",
    value: cloneGraphWriteTransaction(transaction),
    changedPredicateKeys: issues.length > 0 ? [graphWriteTransactionValidationKey] : [],
    issues,
  };
}

export function invalidAuthoritativeGraphWriteResult(
  result: AuthoritativeGraphWriteResult,
  issues: readonly GraphSyncValidationIssue[],
): Extract<GraphSyncValidationResult<AuthoritativeGraphWriteResult>, { ok: false }> {
  return {
    ok: false,
    phase: "authoritative",
    event: "reconcile",
    value: cloneAuthoritativeGraphWriteResult(result),
    changedPredicateKeys: issues.length > 0 ? [graphWriteResultValidationKey] : [],
    issues,
  };
}

function createPayloadValidationIssue(
  path: readonly string[],
  code: string,
  message: string,
): GraphSyncValidationIssue {
  return createGraphSyncValidationIssue(path, code, message, totalSyncPayloadValidationKey);
}

function createIncrementalSyncValidationIssue(
  path: readonly string[],
  code: string,
  message: string,
): GraphSyncValidationIssue {
  return createGraphSyncValidationIssue(path, code, message, incrementalSyncValidationKey);
}

function createGraphWriteResultValidationIssue(
  path: readonly string[],
  code: string,
  message: string,
): GraphSyncValidationIssue {
  return createGraphSyncValidationIssue(path, code, message, graphWriteResultValidationKey);
}

export function prefixGraphWriteResultIssues(
  issues: readonly GraphSyncValidationIssue[],
): GraphSyncValidationIssue[] {
  return issues.map((issue) =>
    createGraphWriteResultValidationIssue(
      ["transaction", ...issue.path],
      issue.code,
      issue.message,
    ),
  );
}

function prefixIncrementalSyncTransactionIssues(
  index: number,
  issues: readonly GraphSyncValidationIssue[],
): GraphSyncValidationIssue[] {
  return issues.map((issue) =>
    createIncrementalSyncValidationIssue(
      [`transactions[${index}]`, ...issue.path],
      issue.code,
      issue.message,
    ),
  );
}

function materializeSyncScope(scope: unknown): SyncScope {
  if (isObjectRecord(scope) && scope.kind === "module") {
    return createModuleSyncScope({
      moduleId: typeof scope.moduleId === "string" ? scope.moduleId : "",
      scopeId: typeof scope.scopeId === "string" ? scope.scopeId : "",
      definitionHash: typeof scope.definitionHash === "string" ? scope.definitionHash : "",
      policyFilterVersion:
        typeof scope.policyFilterVersion === "string" ? scope.policyFilterVersion : "",
    });
  }

  return graphSyncScope;
}

function validateSyncScopeShape(
  scope: unknown,
  issueFactory: SyncValidationIssueFactory,
  codePrefix: string,
): {
  issues: GraphSyncValidationIssue[];
  value: SyncScope;
} {
  const issues: GraphSyncValidationIssue[] = [];
  const value = materializeSyncScope(scope);

  if (!isObjectRecord(scope) || (scope.kind !== "graph" && scope.kind !== "module")) {
    issues.push(
      issueFactory(
        ["scope", "kind"],
        codePrefix,
        'Field "scope.kind" must be "graph" or "module".',
      ),
    );
    return { issues, value };
  }

  if (scope.kind !== "module") return { issues, value };

  for (const field of ["moduleId", "scopeId", "definitionHash", "policyFilterVersion"] as const) {
    const rawValue = scope[field];
    if (typeof rawValue !== "string") {
      issues.push(
        issueFactory(
          ["scope", field],
          `${codePrefix}.${field}`,
          `Field "scope.${field}" must be a string.`,
        ),
      );
      continue;
    }

    if (rawValue.length === 0) {
      issues.push(
        issueFactory(
          ["scope", field],
          `${codePrefix}.${field}.empty`,
          `Field "scope.${field}" must not be empty.`,
        ),
      );
    }
  }

  return { issues, value };
}

function validateSyncCompleteness(
  completeness: unknown,
  scope: SyncScope,
  issueFactory: SyncValidationIssueFactory,
  path: string[],
  code: string,
  graphMessage: string,
): readonly GraphSyncValidationIssue[] {
  if (isGraphSyncScope(scope)) {
    return completeness === "complete" ? [] : [issueFactory(path, code, graphMessage)];
  }

  return isSyncCompleteness(completeness)
    ? []
    : [issueFactory(path, code, 'Field "completeness" must be "complete" or "incomplete".')];
}

function validateSyncFreshness(
  freshness: unknown,
  issueFactory: SyncValidationIssueFactory,
  path: string[],
  code: string,
): readonly GraphSyncValidationIssue[] {
  return isSyncFreshness(freshness)
    ? []
    : [issueFactory(path, code, 'Field "freshness" must be "current" or "stale".')];
}

function validateSyncDiagnosticsShape(
  diagnostics: unknown,
  issueFactory: SyncValidationIssueFactory,
  codePrefix: string,
): {
  issues: GraphSyncValidationIssue[];
  value?: SyncDiagnostics;
} {
  if (diagnostics === undefined) return { issues: [] };

  const issues: GraphSyncValidationIssue[] = [];
  const candidate = isObjectRecord(diagnostics)
    ? (diagnostics as Partial<SyncDiagnostics> & Record<string, unknown>)
    : null;
  if (!candidate) {
    issues.push(
      issueFactory(
        ["diagnostics"],
        codePrefix,
        'Field "diagnostics" must be an object when provided.',
      ),
    );
    return { issues };
  }

  if (!isAuthoritativeGraphRetainedHistoryPolicy(candidate.retainedHistoryPolicy)) {
    issues.push(
      issueFactory(
        ["diagnostics", "retainedHistoryPolicy"],
        `${codePrefix}.retainedHistoryPolicy`,
        'Field "diagnostics.retainedHistoryPolicy" must be a supported retained-history policy.',
      ),
    );
  }

  if (typeof candidate.retainedBaseCursor !== "string") {
    issues.push(
      issueFactory(
        ["diagnostics", "retainedBaseCursor"],
        `${codePrefix}.retainedBaseCursor`,
        'Field "diagnostics.retainedBaseCursor" must be a string.',
      ),
    );
  } else if (candidate.retainedBaseCursor.length === 0) {
    issues.push(
      issueFactory(
        ["diagnostics", "retainedBaseCursor"],
        `${codePrefix}.retainedBaseCursor.empty`,
        'Field "diagnostics.retainedBaseCursor" must not be empty.',
      ),
    );
  }

  if (issues.length > 0) return { issues };

  return {
    issues,
    value: {
      retainedHistoryPolicy: cloneAuthoritativeGraphRetainedHistoryPolicy(
        candidate.retainedHistoryPolicy as AuthoritativeGraphRetainedHistoryPolicy,
      ),
      retainedBaseCursor: candidate.retainedBaseCursor as string,
    },
  };
}

function describeIncrementalFallbackReasons(scope: SyncScope): string {
  return isGraphSyncScope(scope)
    ? '"unknown-cursor", "gap", or "reset"'
    : '"unknown-cursor", "gap", "reset", "scope-changed", or "policy-changed"';
}

function allowsIncrementalSyncFallbackReason(
  scope: SyncScope,
  fallback: IncrementalSyncFallbackReason,
): boolean {
  return isGraphSyncScope(scope) ? graphIncrementalFallbackReasons.has(fallback) : true;
}

function materializeTotalSyncPayload(
  payload: TotalSyncPayload,
  preserveSnapshot?: GraphStoreSnapshot,
): TotalSyncPayload {
  if (
    !preserveSnapshot ||
    (preserveSnapshot.edges.length === 0 && preserveSnapshot.retracted.length === 0)
  ) {
    return {
      ...payload,
      diagnostics: payload.diagnostics ? cloneSyncDiagnostics(payload.diagnostics) : undefined,
    };
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
    diagnostics: payload.diagnostics ? cloneSyncDiagnostics(payload.diagnostics) : undefined,
  };
}

function validateStoreSnapshotShape(snapshot: unknown): readonly GraphSyncValidationIssue[] {
  const issues: GraphSyncValidationIssue[] = [];
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

function validateTotalSyncPayloadShape(
  payload: TotalSyncPayload,
): readonly GraphSyncValidationIssue[] {
  const issues: GraphSyncValidationIssue[] = [];
  const candidate = payload as Partial<TotalSyncPayload> & Record<string, unknown>;
  const scope = validateSyncScopeShape(candidate.scope, createPayloadValidationIssue, "sync.scope");
  const diagnostics = validateSyncDiagnosticsShape(
    candidate.diagnostics,
    createPayloadValidationIssue,
    "sync.diagnostics",
  );

  if (candidate.mode !== "total") {
    issues.push(
      createPayloadValidationIssue(["mode"], "sync.mode", 'Field "mode" must be "total".'),
    );
  }

  issues.push(...scope.issues);

  if (typeof candidate.cursor !== "string") {
    issues.push(
      createPayloadValidationIssue(["cursor"], "sync.cursor", 'Field "cursor" must be a string.'),
    );
  }

  issues.push(
    ...validateSyncCompleteness(
      candidate.completeness,
      scope.value,
      createPayloadValidationIssue,
      ["completeness"],
      "sync.completeness",
      'Field "completeness" must be "complete" for graph-scoped total sync payloads.',
    ),
  );

  issues.push(
    ...validateSyncFreshness(
      candidate.freshness,
      createPayloadValidationIssue,
      ["freshness"],
      "sync.freshness",
    ),
  );

  issues.push(...validateStoreSnapshotShape(candidate.snapshot));
  issues.push(...diagnostics.issues);
  return issues;
}

export function prepareTotalSyncPayload(
  payload: TotalSyncPayload,
  options: {
    preserveSnapshot?: GraphStoreSnapshot;
  } = {},
):
  | {
      ok: true;
      value: TotalSyncPayload;
    }
  | {
      ok: false;
      result: Extract<GraphSyncValidationResult<TotalSyncPayload>, { ok: false }>;
    } {
  const issues = validateTotalSyncPayloadShape(payload);
  if (issues.length > 0) {
    return {
      ok: false,
      result: invalidTotalSyncPayloadResult(payload, issues),
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
      result: Extract<GraphSyncValidationResult<AuthoritativeGraphWriteResult>, { ok: false }>;
    } {
  const candidate = result as Partial<AuthoritativeGraphWriteResult> & Record<string, unknown>;
  const issues: GraphSyncValidationIssue[] = [];

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
      result: invalidAuthoritativeGraphWriteResult(cloned, issues),
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

/**
 * Creates a successful incremental payload.
 *
 * This may legitimately contain zero transactions when incremental delivery
 * advanced the cursor without exposing any visible writes.
 */
export function createIncrementalSyncPayload(
  transactions: readonly AuthoritativeGraphWriteResult[],
  options: {
    after: string;
    cursor?: string;
    completeness?: SyncCompleteness;
    freshness?: SyncFreshness;
    scope?: SyncScope;
    diagnostics?: SyncDiagnostics;
  },
): IncrementalSyncPayload {
  return {
    mode: "incremental",
    scope: cloneSyncScope(options.scope ?? graphSyncScope),
    after: options.after,
    transactions: transactions.map((transaction) =>
      cloneAuthoritativeGraphWriteResult(transaction),
    ),
    cursor: options.cursor ?? transactions[transactions.length - 1]?.cursor ?? options.after,
    completeness: options.completeness ?? "complete",
    freshness: options.freshness ?? "current",
    ...(options.diagnostics ? { diagnostics: cloneSyncDiagnostics(options.diagnostics) } : {}),
  };
}

/**
 * Creates a recovery-only incremental fallback result.
 *
 * Callers must treat this as a signal to recover with a total refresh rather
 * than applying an empty incremental delta.
 */
export function createIncrementalSyncFallback(
  fallback: IncrementalSyncFallbackReason,
  options: {
    after: string;
    cursor: string;
    completeness?: SyncCompleteness;
    freshness?: SyncFreshness;
    scope?: SyncScope;
    diagnostics?: SyncDiagnostics;
  },
): IncrementalSyncFallback {
  return {
    mode: "incremental",
    scope: cloneSyncScope(options.scope ?? graphSyncScope),
    after: options.after,
    transactions: [],
    cursor: options.cursor,
    completeness: options.completeness ?? "complete",
    freshness: options.freshness ?? "current",
    fallback,
    ...(options.diagnostics ? { diagnostics: cloneSyncDiagnostics(options.diagnostics) } : {}),
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
  issues: GraphSyncValidationIssue[];
  value: IncrementalSyncResult;
} {
  const issues: GraphSyncValidationIssue[] = [];
  const candidate = payload as Partial<IncrementalSyncResult> & Record<string, unknown>;
  const scope = validateSyncScopeShape(
    candidate.scope,
    createIncrementalSyncValidationIssue,
    "sync.incremental.scope",
  );
  const diagnostics = validateSyncDiagnosticsShape(
    candidate.diagnostics,
    createIncrementalSyncValidationIssue,
    "sync.incremental.diagnostics",
  );
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

  issues.push(...scope.issues);

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

  issues.push(
    ...validateSyncCompleteness(
      candidate.completeness,
      scope.value,
      createIncrementalSyncValidationIssue,
      ["completeness"],
      "sync.incremental.completeness",
      'Field "completeness" must be "complete" for graph-scoped incremental sync.',
    ),
  );

  issues.push(
    ...validateSyncFreshness(
      candidate.freshness,
      createIncrementalSyncValidationIssue,
      ["freshness"],
      "sync.incremental.freshness",
    ),
  );

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
            `Field "transactions[${index}].replayed" must be false in incremental delivery.`,
          ),
        );
      }

      const prepared = prepareAuthoritativeGraphWriteResult(
        cloneAuthoritativeGraphWriteResult(transaction as AuthoritativeGraphWriteResult),
      );
      if (!prepared.ok) {
        issues.push(...prefixIncrementalSyncTransactionIssues(index, prepared.result.issues));
        return;
      }

      if (txIds.has(prepared.value.txId)) {
        issues.push(
          createIncrementalSyncValidationIssue(
            [`transactions[${index}]`, "txId"],
            "sync.incremental.transaction.txId.duplicate",
            `Field "transactions[${index}].txId" must be unique within one incremental result.`,
          ),
        );
      }
      if (cursors.has(prepared.value.cursor)) {
        issues.push(
          createIncrementalSyncValidationIssue(
            [`transactions[${index}]`, "cursor"],
            "sync.incremental.transaction.cursor.duplicate",
            `Field "transactions[${index}].cursor" must be unique within one incremental result.`,
          ),
        );
      }

      txIds.add(prepared.value.txId);
      cursors.add(prepared.value.cursor);
      transactions.push(prepared.value);
    });
  }

  let fallback: IncrementalSyncFallbackReason | undefined;
  if ("fallback" in candidate) {
    if (!options.allowFallback) {
      issues.push(
        createIncrementalSyncValidationIssue(
          ["fallback"],
          "sync.incremental.fallback.forbidden",
          'Field "fallback" is not allowed on successful incremental payloads.',
        ),
      );
    } else if (!isIncrementalSyncFallbackReason(candidate.fallback)) {
      issues.push(
        createIncrementalSyncValidationIssue(
          ["fallback"],
          "sync.incremental.fallback",
          `Field "fallback" must be ${describeIncrementalFallbackReasons(scope.value)}.`,
        ),
      );
    } else if (!allowsIncrementalSyncFallbackReason(scope.value, candidate.fallback)) {
      issues.push(
        createIncrementalSyncValidationIssue(
          ["fallback"],
          "sync.incremental.fallback.scope",
          `Field "fallback" must be ${describeIncrementalFallbackReasons(scope.value)}.`,
        ),
      );
    } else {
      fallback = candidate.fallback;
    }
  }

  if (fallback && transactions.length > 0) {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["transactions"],
        "sync.incremental.fallback.transactions",
        'Field "transactions" must be empty when "fallback" is present.',
      ),
    );
  }

  if (
    typeof candidate.after === "string" &&
    candidate.after.length > 0 &&
    typeof candidate.cursor === "string" &&
    candidate.cursor.length > 0
  ) {
    const parsedAfter = parseAuthoritativeGraphCursor(candidate.after);
    const parsedCursor = parseAuthoritativeGraphCursor(candidate.cursor);
    if (
      parsedAfter &&
      parsedCursor &&
      parsedAfter.prefix === parsedCursor.prefix &&
      !isCursorAtOrAfter(parsedCursor, parsedAfter)
    ) {
      issues.push(
        createIncrementalSyncValidationIssue(
          ["cursor"],
          "sync.incremental.cursor.order",
          'Field "cursor" must not move behind "after" when both cursors share the same source prefix.',
        ),
      );
    }
  }

  if (
    transactions.length > 0 &&
    typeof candidate.cursor === "string" &&
    candidate.cursor !== transactions[transactions.length - 1]?.cursor
  ) {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["cursor"],
        "sync.incremental.cursor.tail",
        'Field "cursor" must match the last delivered transaction cursor when transactions are present.',
      ),
    );
  }

  const value = fallback
    ? createIncrementalSyncFallback(fallback, {
        after: typeof candidate.after === "string" ? candidate.after : "",
        cursor: typeof candidate.cursor === "string" ? candidate.cursor : "",
        completeness: isSyncCompleteness(candidate.completeness)
          ? candidate.completeness
          : "complete",
        freshness: isSyncFreshness(candidate.freshness) ? candidate.freshness : "current",
        scope: scope.value,
        diagnostics: diagnostics.value,
      })
    : createIncrementalSyncPayload(transactions, {
        after: typeof candidate.after === "string" ? candidate.after : "",
        cursor: typeof candidate.cursor === "string" ? candidate.cursor : "",
        completeness: isSyncCompleteness(candidate.completeness)
          ? candidate.completeness
          : "complete",
        freshness: isSyncFreshness(candidate.freshness) ? candidate.freshness : "current",
        scope: scope.value,
        diagnostics: diagnostics.value,
      });

  issues.push(...diagnostics.issues);
  return { issues, value };
}

export function validateIncrementalSyncPayload(
  payload: IncrementalSyncPayload,
): GraphSyncValidationResult<IncrementalSyncPayload> {
  const validation = validateIncrementalSyncPayloadShape(payload);
  if (validation.issues.length > 0) {
    return exposeGraphSyncValidationResult(
      invalidIncrementalSyncResult(payload, validation.issues),
    ) as GraphSyncValidationResult<IncrementalSyncPayload>;
  }

  return {
    ok: true,
    phase: "authoritative",
    event: "reconcile",
    value: validation.value as IncrementalSyncPayload,
    changedPredicateKeys: [],
  };
}

export function validateIncrementalSyncResult(
  result: IncrementalSyncResult,
): GraphSyncValidationResult<IncrementalSyncResult> {
  const validation = validateIncrementalSyncPayloadShape(result as IncrementalSyncPayload, {
    allowFallback: true,
  });
  if (validation.issues.length > 0) {
    return exposeGraphSyncValidationResult(invalidIncrementalSyncResult(result, validation.issues));
  }

  return {
    ok: true,
    phase: "authoritative",
    event: "reconcile",
    value: validation.value,
    changedPredicateKeys: [],
  };
}

export function prepareIncrementalSyncResultForApply(
  snapshot: GraphStoreSnapshot,
  result: IncrementalSyncResult,
  currentCursor?: string,
  options: {
    currentScope?: SyncScope;
    validateWriteResult?: AuthoritativeGraphWriteResultValidator;
  } = {},
):
  | {
      ok: true;
      value: IncrementalSyncResult;
      snapshot?: GraphStoreSnapshot;
    }
  | {
      ok: false;
      result: Extract<GraphSyncValidationResult<SyncPayload>, { ok: false }>;
    } {
  const validation = validateIncrementalSyncResult(result);
  if (!validation.ok) {
    return {
      ok: false,
      result: validation as Extract<GraphSyncValidationResult<SyncPayload>, { ok: false }>,
    };
  }

  if (currentCursor && validation.value.after !== currentCursor) {
    return {
      ok: false,
      result: invalidIncrementalSyncResult(validation.value, [
        createIncrementalSyncValidationIssue(
          ["after"],
          "sync.incremental.after.cursor",
          'Field "after" must match the current session cursor.',
        ),
      ]) as Extract<GraphSyncValidationResult<SyncPayload>, { ok: false }>,
    };
  }

  if (options.currentScope && !sameSyncScope(options.currentScope, validation.value.scope)) {
    return {
      ok: false,
      result: invalidIncrementalSyncResult(validation.value, [
        createIncrementalSyncValidationIssue(
          ["scope"],
          "sync.incremental.scope.changed",
          "Incremental apply must keep the active sync scope identity.",
        ),
      ]) as Extract<GraphSyncValidationResult<SyncPayload>, { ok: false }>,
    };
  }

  if ("fallback" in validation.value) {
    return {
      ok: false,
      result: invalidIncrementalSyncResult(validation.value, [
        createIncrementalSyncValidationIssue(
          ["fallback"],
          "sync.incremental.recovery",
          `Incremental sync requires total snapshot recovery because the authority reported "${validation.value.fallback}".`,
        ),
      ]) as Extract<GraphSyncValidationResult<SyncPayload>, { ok: false }>,
    };
  }

  const validationStore = createStore(snapshot);
  for (const [index, txResult] of validation.value.transactions.entries()) {
    const materialized = materializeGraphWriteTransactionSnapshot(
      validationStore,
      txResult.transaction,
      {
        allowExistingAssertEdgeIds: true,
      },
    );
    if (!materialized.ok) {
      return {
        ok: false,
        result: invalidIncrementalSyncResult(
          validation.value,
          prefixIncrementalSyncTransactionIssues(index, materialized.result.issues),
        ) as Extract<GraphSyncValidationResult<SyncPayload>, { ok: false }>,
      };
    }

    options.validateWriteResult?.(txResult, validationStore);
    validationStore.replace(materialized.value);
  }

  return {
    ok: true,
    value: validation.value,
    snapshot: validationStore.snapshot(),
  };
}

export function validateTotalSyncPayload(
  payload: TotalSyncPayload,
): GraphSyncValidationResult<TotalSyncPayload> {
  const prepared = prepareTotalSyncPayload(payload);
  if (!prepared.ok) return exposeGraphSyncValidationResult(prepared.result);

  return {
    ok: true,
    phase: "authoritative",
    event: "reconcile",
    value: prepared.value,
    changedPredicateKeys: [],
  };
}
