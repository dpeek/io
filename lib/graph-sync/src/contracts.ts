import {
  cloneAuthoritativeGraphRetainedHistoryPolicy,
  cloneAuthoritativeGraphWriteResult,
  isAuthoritativeGraphRetainedHistoryPolicy,
  sameAuthoritativeGraphRetainedHistoryPolicy,
  type AuthoritativeGraphCursor,
  type AuthoritativeGraphRetainedHistoryPolicy,
  type AuthoritativeGraphWriteResult,
  type GraphWriteScope,
  type GraphStore,
  type GraphStoreSnapshot,
} from "@io/graph-kernel";

/** Sync completeness reported by a transport payload. */
export type SyncCompleteness = "complete" | "incomplete";

/** Freshness of the delivered sync view. */
export type SyncFreshness = "current" | "stale";

/**
 * Current total-sync session status.
 *
 * This package models total-sync sessions only. The legacy runtime shim widens
 * synced-client state with `"pushing"` while pending writes are flushing.
 */
export type SyncStatus = "idle" | "syncing" | "ready" | "error";

/** Whole-graph sync scope. */
export type GraphSyncScope = {
  readonly kind: "graph";
};

/**
 * Materialized module sync scope delivered by an authority.
 *
 * `definitionHash` and `policyFilterVersion` are part of the active scope
 * identity. Changing either requires a total refresh rather than an
 * incremental scope swap.
 */
export type ModuleSyncScope = {
  readonly kind: "module";
  readonly moduleId: string;
  readonly scopeId: string;
  readonly definitionHash: string;
  readonly policyFilterVersion: string;
};

/** Sync scope materialized in a payload. */
export type SyncScope = GraphSyncScope | ModuleSyncScope;

/** Caller request for a module-scoped sync proof. */
export type ModuleSyncScopeRequest = {
  readonly kind: "module";
  readonly moduleId: string;
  readonly scopeId: string;
};

/** Caller-requested sync scope. */
export type SyncScopeRequest = GraphSyncScope | ModuleSyncScopeRequest;

/** Shared whole-graph sync scope singleton. */
export const graphSyncScope = Object.freeze({ kind: "graph" }) satisfies GraphSyncScope;

/**
 * Creates a materialized module sync scope.
 *
 * This is the delivered scope shape, not the request shape.
 */
export function createModuleSyncScope(scope: {
  moduleId: string;
  scopeId: string;
  definitionHash: string;
  policyFilterVersion: string;
}): ModuleSyncScope {
  return {
    kind: "module",
    moduleId: scope.moduleId,
    scopeId: scope.scopeId,
    definitionHash: scope.definitionHash,
    policyFilterVersion: scope.policyFilterVersion,
  };
}

export function createModuleSyncScopeRequest(scope: {
  moduleId: string;
  scopeId: string;
}): ModuleSyncScopeRequest {
  return {
    kind: "module",
    moduleId: scope.moduleId,
    scopeId: scope.scopeId,
  };
}

export function isGraphSyncScope(scope: SyncScope): scope is GraphSyncScope {
  return scope.kind === "graph";
}

export function isModuleSyncScope(scope: SyncScope): scope is ModuleSyncScope {
  return scope.kind === "module";
}

export function isModuleSyncScopeRequest(scope: SyncScopeRequest): scope is ModuleSyncScopeRequest {
  return scope.kind === "module";
}

export function cloneSyncScope(scope: SyncScope): SyncScope {
  return scope.kind === "graph" ? graphSyncScope : { ...scope };
}

export function cloneSyncScopeRequest(scope: SyncScopeRequest): SyncScopeRequest {
  return scope.kind === "graph" ? graphSyncScope : { ...scope };
}

export function sameSyncScope(left: SyncScope, right: SyncScope): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "graph") return true;
  if (right.kind !== "module") return false;
  return (
    left.moduleId === right.moduleId &&
    left.scopeId === right.scopeId &&
    left.definitionHash === right.definitionHash &&
    left.policyFilterVersion === right.policyFilterVersion
  );
}

export function sameSyncScopeRequest(left: SyncScopeRequest, right: SyncScopeRequest): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "graph") return true;
  if (right.kind !== "module") return false;
  return left.moduleId === right.moduleId && left.scopeId === right.scopeId;
}

export function isSyncCompleteness(value: unknown): value is SyncCompleteness {
  return value === "complete" || value === "incomplete";
}

export function isSyncFreshness(value: unknown): value is SyncFreshness {
  return value === "current" || value === "stale";
}

/**
 * Retained-history context attached to a sync payload.
 *
 * Diagnostics help explain why an incremental request might need fallback, but
 * they do not change payload apply rules on their own.
 */
export type SyncDiagnostics = {
  readonly retainedHistoryPolicy: AuthoritativeGraphRetainedHistoryPolicy;
  readonly retainedBaseCursor: AuthoritativeGraphCursor;
};

/**
 * Full snapshot delivery.
 *
 * Graph-scoped payloads must report `completeness: "complete"`. Scoped payloads
 * may report `"incomplete"` when the scope intentionally omits unrelated data.
 */
export type TotalSyncPayload = {
  readonly mode: "total";
  readonly scope: SyncScope;
  readonly snapshot: GraphStoreSnapshot;
  readonly cursor: AuthoritativeGraphCursor;
  readonly completeness: SyncCompleteness;
  readonly freshness: SyncFreshness;
  readonly diagnostics?: SyncDiagnostics;
};

/**
 * Recovery-only incremental fallback reasons.
 *
 * `scope-changed` and `policy-changed` are reserved for scoped sync proofs.
 */
export type IncrementalSyncFallbackReason =
  | "unknown-cursor"
  | "gap"
  | "reset"
  | "scope-changed"
  | "policy-changed";

export const incrementalSyncFallbackReasons = [
  "unknown-cursor",
  "gap",
  "reset",
  "scope-changed",
  "policy-changed",
] as const satisfies readonly IncrementalSyncFallbackReason[];

export function isIncrementalSyncFallbackReason(
  value: unknown,
): value is IncrementalSyncFallbackReason {
  return (
    typeof value === "string" &&
    (incrementalSyncFallbackReasons as readonly string[]).includes(value)
  );
}

/**
 * Successful incremental delivery after a previously issued cursor.
 *
 * `transactions` may be empty without becoming a fallback:
 * - `cursor === after`: nothing new was accepted after the requested cursor
 * - `cursor !== after`: the cursor advanced, but no replicated transactions
 *   were visible in the requested scope
 */
export type IncrementalSyncPayload = {
  readonly mode: "incremental";
  readonly scope: SyncScope;
  readonly after: AuthoritativeGraphCursor;
  readonly transactions: readonly AuthoritativeGraphWriteResult[];
  readonly cursor: AuthoritativeGraphCursor;
  readonly completeness: SyncCompleteness;
  readonly freshness: SyncFreshness;
  readonly diagnostics?: SyncDiagnostics;
};

/**
 * Recovery-only incremental result.
 *
 * This is distinct from a successful empty incremental payload.
 */
export type IncrementalSyncFallback = {
  readonly mode: "incremental";
  readonly scope: SyncScope;
  readonly after: AuthoritativeGraphCursor;
  readonly transactions: readonly [];
  readonly cursor: AuthoritativeGraphCursor;
  readonly completeness: SyncCompleteness;
  readonly freshness: SyncFreshness;
  readonly fallbackReason: IncrementalSyncFallbackReason;
  readonly diagnostics?: SyncDiagnostics;
};

export type IncrementalSyncResult = IncrementalSyncPayload | IncrementalSyncFallback;
export type SyncPayload = TotalSyncPayload | IncrementalSyncResult;

export function isIncrementalSyncFallback(
  result: IncrementalSyncResult,
): result is IncrementalSyncFallback {
  return "fallbackReason" in result;
}

export function cloneSyncDiagnostics(diagnostics: SyncDiagnostics): SyncDiagnostics {
  return {
    retainedHistoryPolicy: cloneAuthoritativeGraphRetainedHistoryPolicy(
      diagnostics.retainedHistoryPolicy,
    ),
    retainedBaseCursor: diagnostics.retainedBaseCursor,
  };
}

export function sameSyncDiagnostics(
  left: SyncDiagnostics | undefined,
  right: SyncDiagnostics | undefined,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.retainedBaseCursor === right.retainedBaseCursor &&
    sameAuthoritativeGraphRetainedHistoryPolicy(
      left.retainedHistoryPolicy,
      right.retainedHistoryPolicy,
    )
  );
}

export function isSyncDiagnostics(value: unknown): value is SyncDiagnostics {
  if (!isObjectRecord(value)) return false;
  return (
    typeof value.retainedBaseCursor === "string" &&
    value.retainedBaseCursor.length > 0 &&
    isAuthoritativeGraphRetainedHistoryPolicy(value.retainedHistoryPolicy)
  );
}

export type SyncActivity =
  | {
      readonly kind: "total";
      readonly cursor: AuthoritativeGraphCursor;
      readonly freshness: SyncFreshness;
      readonly at: Date;
    }
  | {
      readonly kind: "incremental";
      readonly after: AuthoritativeGraphCursor;
      readonly cursor: AuthoritativeGraphCursor;
      readonly freshness: SyncFreshness;
      readonly transactionCount: number;
      readonly txIds: readonly string[];
      readonly writeScopes: readonly GraphWriteScope[];
      readonly at: Date;
    }
  | {
      readonly kind: "fallback";
      readonly after: AuthoritativeGraphCursor;
      readonly cursor: AuthoritativeGraphCursor;
      readonly freshness: SyncFreshness;
      readonly fallbackReason: IncrementalSyncFallbackReason;
      readonly at: Date;
    }
  | {
      readonly kind: "write";
      readonly txId: string;
      readonly cursor: AuthoritativeGraphCursor;
      readonly freshness: SyncFreshness;
      readonly replayed: boolean;
      readonly writeScope: GraphWriteScope;
      readonly at: Date;
    };

export type SyncScopeState = {
  readonly scope: SyncScope;
  readonly completeness: SyncCompleteness;
  readonly freshness: SyncFreshness;
  readonly cursor?: AuthoritativeGraphCursor;
  readonly fallbackReason?: IncrementalSyncFallbackReason;
  readonly diagnostics?: SyncDiagnostics;
};

export type SyncState = SyncScopeState & {
  readonly mode: "total";
  readonly requestedScope: SyncScopeRequest;
  readonly status: SyncStatus;
  readonly pendingCount: number;
  readonly recentActivities: readonly SyncActivity[];
  readonly lastSyncedAt?: Date;
  readonly error?: unknown;
};

export type SyncStateListener = (state: SyncState) => void;
export type SyncSource = (state: SyncState) => SyncPayload | Promise<SyncPayload>;
export type TotalSyncPayloadValidator = (payload: TotalSyncPayload) => void;
export type AuthoritativeGraphWriteResultValidator = (
  result: AuthoritativeGraphWriteResult,
  store?: GraphStore,
) => void;

export interface TotalSyncSession {
  apply(payload: SyncPayload): SyncPayload;
  applyWriteResult(result: AuthoritativeGraphWriteResult): AuthoritativeGraphWriteResult;
  pull(source: SyncSource): Promise<SyncPayload>;
  getState(): SyncState;
  subscribe(listener: SyncStateListener): () => void;
}

export interface TotalSyncController {
  apply(payload: SyncPayload): SyncPayload;
  applyWriteResult(result: AuthoritativeGraphWriteResult): AuthoritativeGraphWriteResult;
  sync(): Promise<SyncPayload>;
  getState(): SyncState;
  subscribe(listener: SyncStateListener): () => void;
}

export type GraphSyncValidationSource = "sync";

export type GraphSyncValidationIssue = {
  code: string;
  message: string;
  source: GraphSyncValidationSource;
  path: readonly string[];
  nodeId: string;
  predicateKey: string;
};

export type GraphSyncValidationResult<T = unknown> =
  | {
      ok: true;
      phase: "authoritative";
      event: "reconcile";
      value: T;
      changedPredicateKeys: readonly string[];
    }
  | {
      ok: false;
      phase: "authoritative";
      event: "reconcile";
      value: T;
      changedPredicateKeys: readonly string[];
      issues: readonly GraphSyncValidationIssue[];
    };

/**
 * Sync-core validation error.
 *
 * The package uses a sync-specific error instead of the broader graph runtime
 * validation error so the extracted boundary stays independent from typed
 * client validation layers.
 */
export class GraphSyncValidationError<T = unknown> extends Error {
  readonly result: Extract<GraphSyncValidationResult<T>, { ok: false }>;

  constructor(result: Extract<GraphSyncValidationResult<T>, { ok: false }>) {
    const firstIssue = result.issues[0];
    const fieldPath = firstIssue?.path.join(".") ?? "";
    super(
      firstIssue
        ? `Sync validation failed for "${fieldPath || firstIssue.predicateKey}": ${firstIssue.message}`
        : "Sync validation failed.",
    );
    this.name = "GraphSyncValidationError";
    this.result = exposeGraphSyncValidationResult(result) as Extract<
      GraphSyncValidationResult<T>,
      { ok: false }
    >;
  }
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export function cloneTotalSyncPayload(payload: TotalSyncPayload): TotalSyncPayload {
  const snapshot = isObjectRecord(payload.snapshot)
    ? (payload.snapshot as Record<string, unknown>)
    : {};
  const edges = Array.isArray(snapshot.edges)
    ? snapshot.edges.flatMap((edge: unknown) => {
        if (!isObjectRecord(edge)) return [];
        if (
          typeof edge.id !== "string" ||
          typeof edge.s !== "string" ||
          typeof edge.p !== "string" ||
          typeof edge.o !== "string"
        ) {
          return [];
        }

        return [
          {
            id: edge.id,
            s: edge.s,
            p: edge.p,
            o: edge.o,
          },
        ];
      })
    : [];
  const retracted = Array.isArray(snapshot.retracted)
    ? snapshot.retracted.filter((edgeId: unknown): edgeId is string => typeof edgeId === "string")
    : [];

  return {
    ...payload,
    scope: cloneSyncScope(payload.scope),
    snapshot: {
      edges,
      retracted,
    },
    diagnostics: payload.diagnostics ? cloneSyncDiagnostics(payload.diagnostics) : undefined,
  };
}

export function cloneIncrementalSyncResult(result: IncrementalSyncResult): IncrementalSyncResult {
  return "fallbackReason" in result
    ? {
        ...result,
        scope: cloneSyncScope(result.scope),
        transactions: [],
        diagnostics: result.diagnostics ? cloneSyncDiagnostics(result.diagnostics) : undefined,
      }
    : {
        ...result,
        scope: cloneSyncScope(result.scope),
        transactions: result.transactions.map((transaction) =>
          cloneAuthoritativeGraphWriteResult(transaction),
        ),
        diagnostics: result.diagnostics ? cloneSyncDiagnostics(result.diagnostics) : undefined,
      };
}

export function cloneSyncActivity(activity: SyncActivity): SyncActivity {
  return {
    ...activity,
    ...(activity.kind === "incremental"
      ? {
          txIds: [...activity.txIds],
          writeScopes: [...activity.writeScopes],
        }
      : {}),
    at: new Date(activity.at.getTime()),
  };
}

export function sameSyncActivity(left: SyncActivity, right: SyncActivity): boolean {
  if (left.kind !== right.kind) return false;
  if (left.at.getTime() !== right.at.getTime()) return false;
  if (left.cursor !== right.cursor || left.freshness !== right.freshness) return false;

  switch (left.kind) {
    case "total":
      return right.kind === "total";
    case "fallback":
      return (
        right.kind === "fallback" &&
        left.after === right.after &&
        left.fallbackReason === right.fallbackReason
      );
    case "write":
      return (
        right.kind === "write" &&
        left.txId === right.txId &&
        left.replayed === right.replayed &&
        left.writeScope === right.writeScope
      );
    case "incremental":
      return (
        right.kind === "incremental" &&
        left.after === right.after &&
        left.transactionCount === right.transactionCount &&
        left.txIds.length === right.txIds.length &&
        left.writeScopes.length === right.writeScopes.length &&
        left.txIds.every((txId, index) => txId === right.txIds[index]) &&
        left.writeScopes.every((scope, index) => scope === right.writeScopes[index])
      );
  }
}

export function appendSyncActivity(
  recentActivities: readonly SyncActivity[],
  activity: SyncActivity,
  limit = 10,
): readonly SyncActivity[] {
  return [...recentActivities, cloneSyncActivity(activity)].slice(-limit);
}

export function cloneSyncState(state: SyncState): SyncState {
  return {
    ...state,
    requestedScope: cloneSyncScopeRequest(state.requestedScope),
    scope: cloneSyncScope(state.scope),
    recentActivities: state.recentActivities.map((activity) => cloneSyncActivity(activity)),
    lastSyncedAt: state.lastSyncedAt ? new Date(state.lastSyncedAt.getTime()) : undefined,
    diagnostics: state.diagnostics ? cloneSyncDiagnostics(state.diagnostics) : undefined,
  };
}

export function cloneGraphSyncValidationIssue(
  issue: GraphSyncValidationIssue,
): GraphSyncValidationIssue {
  return {
    ...issue,
    path: Object.freeze([...issue.path]),
  };
}

export function exposeGraphSyncValidationResult<T>(
  result: GraphSyncValidationResult<T>,
): GraphSyncValidationResult<T> {
  if (result.ok) {
    return {
      ...result,
      changedPredicateKeys: [...result.changedPredicateKeys],
    };
  }

  return {
    ...result,
    changedPredicateKeys: [...result.changedPredicateKeys],
    issues: result.issues.map((issue) => cloneGraphSyncValidationIssue(issue)),
  };
}
