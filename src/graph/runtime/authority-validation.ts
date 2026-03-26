import {
  GraphValidationError,
  validateGraphStore,
  type GraphValidationIssue,
  type GraphValidationResult,
} from "@io/graph-client";
import {
  cloneAuthoritativeGraphRetainedHistoryPolicy,
  cloneAuthoritativeGraphWriteResult,
  cloneGraphWriteTransaction,
  isAuthoritativeGraphRetainedHistoryPolicy,
  isGraphWriteScope,
  type AuthoritativeGraphWriteResult,
  type AuthoritativeGraphRetainedHistoryPolicy,
  type GraphWriteScope,
  type GraphWriteTransaction,
} from "@io/graph-kernel";
import {
  cloneSyncDiagnostics,
  cloneSyncScope,
  createModuleSyncScope,
  graphSyncScope,
  isCursorAtOrAfter,
  isIncrementalSyncFallbackReason,
  isSyncCompleteness,
  isSyncFreshness,
  parseAuthoritativeGraphCursor,
  sameSyncScope,
  type AuthoritativeGraphWriteResultValidator,
  type IncrementalSyncFallback,
  type IncrementalSyncFallbackReason,
  type IncrementalSyncPayload,
  type IncrementalSyncResult,
  type SyncCompleteness,
  type SyncDiagnostics,
  type SyncFreshness,
  type SyncScope,
  type TotalSyncPayload,
  type TotalSyncPayloadValidator,
} from "@io/graph-sync";
import {
  logicalFactKey,
  materializeGraphWriteTransactionSnapshot,
  prepareGraphWriteTransaction,
} from "@io/graph-sync";

import { validateAuthoritativeFieldWritePolicies } from "./authority-replication";
import {
  createTransactionValidationIssue,
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
} from "./authority-validation-helpers";
import { core } from "./core";
import type { AnyTypeOutput } from "./schema";
import { createStore, type GraphStore, type GraphStoreSnapshot } from "./store";

type SyncValidationIssueFactory = (
  path: string[],
  code: string,
  message: string,
) => GraphValidationIssue;

const graphIncrementalFallbackReasons = new Set<IncrementalSyncFallbackReason>([
  "unknown-cursor",
  "gap",
  "reset",
]);

function isGraphSyncScope(scope: SyncScope): scope is Extract<SyncScope, { kind: "graph" }> {
  return scope.kind === "graph";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function normalizeTransactionValidationResult(result: {
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

function resolveAuthorityDefinitions<const T extends Record<string, AnyTypeOutput>>(
  namespace: T,
): typeof core & T {
  return { ...core, ...namespace } as typeof core & T;
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
  issues: GraphValidationIssue[];
  value: SyncScope;
} {
  const issues: GraphValidationIssue[] = [];
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

  if (scope.kind !== "module") {
    return { issues, value };
  }

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
): readonly GraphValidationIssue[] {
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
): readonly GraphValidationIssue[] {
  return isSyncFreshness(freshness)
    ? []
    : [issueFactory(path, code, 'Field "freshness" must be "current" or "stale".')];
}

function validateSyncDiagnosticsShape(
  diagnostics: unknown,
  issueFactory: SyncValidationIssueFactory,
  codePrefix: string,
): {
  issues: GraphValidationIssue[];
  value?: SyncDiagnostics;
} {
  if (diagnostics === undefined) {
    return {
      issues: [],
    };
  }

  const issues: GraphValidationIssue[] = [];
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

  if (issues.length > 0) {
    return { issues };
  }

  const retainedHistoryPolicy =
    candidate.retainedHistoryPolicy as AuthoritativeGraphRetainedHistoryPolicy;
  const retainedBaseCursor = candidate.retainedBaseCursor as string;

  return {
    issues,
    value: {
      retainedHistoryPolicy: cloneAuthoritativeGraphRetainedHistoryPolicy(retainedHistoryPolicy),
      retainedBaseCursor,
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
  fallbackReason: IncrementalSyncFallbackReason,
): boolean {
  return isGraphSyncScope(scope) ? graphIncrementalFallbackReasons.has(fallbackReason) : true;
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

function prepareTotalSyncPayload(
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

  let writeScope: GraphWriteScope = "client-tx";
  if (candidate.writeScope !== undefined) {
    if (!isGraphWriteScope(candidate.writeScope)) {
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

// A successful incremental result may still be empty. That represents either a
// no-op pull at the head cursor or a cursor advance with no replicated writes.
function createIncrementalSyncPayload(
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

// `fallbackReason` is reserved for cases where the caller must recover with a total
// sync rather than apply an empty incremental payload.
function createIncrementalSyncFallback(
  fallbackReason: IncrementalSyncFallbackReason,
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
    fallbackReason,
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
  issues: GraphValidationIssue[];
  value: IncrementalSyncResult;
} {
  const issues: GraphValidationIssue[] = [];
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
  const completeness = isSyncCompleteness(candidate.completeness)
    ? candidate.completeness
    : "complete";
  const freshness = candidate.freshness === "stale" ? "stale" : "current";
  const diagnosticsValue = diagnostics.value ? cloneSyncDiagnostics(diagnostics.value) : undefined;
  const hasFallback = "fallbackReason" in candidate;
  const fallbackReason = isIncrementalSyncFallbackReason(candidate.fallbackReason)
    ? candidate.fallbackReason
    : "unknown-cursor";

  if (!options.allowFallback && hasFallback) {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["fallbackReason"],
        "sync.incremental.fallbackReason.unexpected",
        'Field "fallbackReason" is only valid on incremental pull results that require total-sync recovery.',
      ),
    );
  }

  issues.push(...diagnostics.issues);

  if (options.allowFallback && hasFallback) {
    if (
      !isIncrementalSyncFallbackReason(candidate.fallbackReason) ||
      !allowsIncrementalSyncFallbackReason(scope.value, candidate.fallbackReason)
    ) {
      issues.push(
        createIncrementalSyncValidationIssue(
          ["fallbackReason"],
          "sync.incremental.fallbackReason",
          `Field "fallbackReason" must be ${describeIncrementalFallbackReasons(scope.value)}.`,
        ),
      );
    }

    if (Array.isArray(candidate.transactions) && candidate.transactions.length > 0) {
      issues.push(
        createIncrementalSyncValidationIssue(
          ["transactions"],
          "sync.incremental.fallbackReason.transactions",
          'Field "transactions" must be empty when "fallbackReason" is present.',
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
            completeness,
            freshness,
            scope: scope.value,
            diagnostics: diagnosticsValue,
          })
        : createIncrementalSyncPayload(transactions, {
            after,
            cursor,
            completeness,
            freshness,
            scope: scope.value,
            diagnostics: diagnosticsValue,
          }),
  };
}

function validateIncrementalSyncResult(
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

export function prepareIncrementalSyncPayloadForApply(
  store: GraphStore,
  result: IncrementalSyncResult,
  currentCursor: string | undefined,
  options: {
    currentScope?: SyncScope;
    validateWriteResult?: AuthoritativeGraphWriteResultValidator;
  } = {},
):
  | {
      ok: true;
      value: IncrementalSyncPayload;
      snapshot?: GraphStoreSnapshot;
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
  if ("fallbackReason" in materialized) {
    return {
      ok: false,
      result: invalidIncrementalSyncResult(materialized, [
        createIncrementalSyncValidationIssue(
          ["fallbackReason"],
          "sync.incremental.recovery",
          `Incremental sync requires total snapshot recovery because the authority reported "${materialized.fallbackReason}".`,
        ),
      ]),
    };
  }

  if (options.currentScope && !sameSyncScope(materialized.scope, options.currentScope)) {
    return {
      ok: false,
      result: invalidIncrementalSyncResult(materialized, [
        createIncrementalSyncValidationIssue(
          ["scope"],
          "sync.incremental.scope.current",
          'Field "scope" must match the active sync scope before incremental apply.',
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
    preserveSnapshot?: GraphStoreSnapshot;
  } = {},
): GraphValidationResult<TotalSyncPayload> {
  const definitions = resolveAuthorityDefinitions(namespace);
  const prepared = prepareTotalSyncPayload(payload, options);
  if (!prepared.ok) return prepared.result;

  const materialized = prepared.value;
  const validationStore = createStore(materialized.snapshot);
  return exposeTotalSyncValidationResult(
    withValidationValue(validateGraphStore(validationStore, definitions), materialized),
  );
}

export function validateAuthoritativeGraphWriteTransaction<
  const T extends Record<string, AnyTypeOutput>,
>(
  transaction: GraphWriteTransaction,
  store: GraphStore,
  namespace: T,
  options: {
    writeScope?: GraphWriteScope;
  } = {},
): GraphValidationResult<GraphWriteTransaction> {
  const definitions = resolveAuthorityDefinitions(namespace);
  const prepared = prepareGraphWriteTransaction(transaction);
  if (!prepared.ok) {
    return exposeGraphWriteValidationResult(normalizeTransactionValidationResult(prepared.result));
  }

  const materialized = materializeGraphWriteTransactionSnapshot(store, prepared.value);
  if (!materialized.ok) {
    return exposeGraphWriteValidationResult(
      normalizeTransactionValidationResult(materialized.result),
    );
  }
  const writePolicyIssues = validateAuthoritativeFieldWritePolicies(
    prepared.value,
    materialized.value,
    definitions,
    options.writeScope ?? "client-tx",
  );
  if (writePolicyIssues.length > 0) {
    return exposeGraphWriteValidationResult(
      invalidTransactionResult(prepared.value, writePolicyIssues),
    );
  }

  const validationStore = createStore(materialized.value);
  return exposeGraphWriteValidationResult(
    withValidationValue(validateGraphStore(validationStore, definitions), prepared.value),
  );
}

export function validateAuthoritativeGraphWriteResult<
  const T extends Record<string, AnyTypeOutput>,
>(
  result: AuthoritativeGraphWriteResult,
  store: GraphStore,
  namespace: T,
): GraphValidationResult<AuthoritativeGraphWriteResult> {
  const definitions = resolveAuthorityDefinitions(namespace);
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
    withValidationValue(validateGraphStore(validationStore, definitions), prepared.value),
  );
}

export function createAuthoritativeTotalSyncValidator<
  const T extends Record<string, AnyTypeOutput>,
>(
  namespace: T,
  options: {
    preserveSnapshot?: GraphStoreSnapshot;
  } = {},
): TotalSyncPayloadValidator {
  return (payload) => {
    const result = validateAuthoritativeTotalSyncPayload(payload, namespace, options);
    if (!result.ok) throw new GraphValidationError(result);
  };
}

export function createAuthoritativeGraphWriteResultValidator<
  const T extends Record<string, AnyTypeOutput>,
>(store: GraphStore, namespace: T): AuthoritativeGraphWriteResultValidator {
  return (result, validationStore = store) => {
    const validation = validateAuthoritativeGraphWriteResult(result, validationStore, namespace);
    if (!validation.ok) throw new GraphValidationError(validation);
  };
}
