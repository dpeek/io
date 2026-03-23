import type { NamespaceClient } from "../client";
import { core } from "../core";
import type { AnyTypeOutput, GraphFieldWritePolicy } from "../schema";
import type { Store, StoreSnapshot } from "../store";

/**
 * Opaque cursor issued by an authoritative graph session.
 *
 * Callers may persist and echo the value back through `after`, but they must
 * not depend on the string layout. Only equality, authority-defined ordering,
 * and fallback behavior are stable across runtimes.
 */
export type AuthoritativeGraphCursor = string;

export type SyncCompleteness = "complete" | "incomplete";
export type SyncFreshness = "current" | "stale";
export type SyncStatus = "idle" | "syncing" | "pushing" | "ready" | "error";
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
      readonly writeScopes: readonly AuthoritativeWriteScope[];
      readonly at: Date;
    }
  | {
      readonly kind: "fallback";
      readonly after: AuthoritativeGraphCursor;
      readonly cursor: AuthoritativeGraphCursor;
      readonly freshness: SyncFreshness;
      readonly reason: IncrementalSyncFallbackReason;
      readonly at: Date;
    }
  | {
      readonly kind: "write";
      readonly txId: string;
      readonly cursor: AuthoritativeGraphCursor;
      readonly freshness: SyncFreshness;
      readonly replayed: boolean;
      readonly writeScope: AuthoritativeWriteScope;
      readonly at: Date;
    };

export type SyncScope = {
  readonly kind: "graph";
};

export const graphSyncScope: SyncScope = Object.freeze({ kind: "graph" });

export type TotalSyncPayload = {
  readonly mode: "total";
  readonly scope: SyncScope;
  readonly snapshot: StoreSnapshot;
  readonly cursor: AuthoritativeGraphCursor;
  readonly completeness: "complete";
  readonly freshness: SyncFreshness;
};

export type IncrementalSyncFallbackReason = "unknown-cursor" | "gap" | "reset";
export const incrementalSyncFallbackReasons = [
  "unknown-cursor",
  "gap",
  "reset",
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
 * Successful incremental delivery after an authority-issued cursor.
 *
 * `transactions` may be empty without becoming a fallback:
 * - `cursor === after`: nothing new was accepted after the requested cursor
 * - `cursor !== after`: the cursor advanced, but no replicated transactions
 *   were visible in this graph-scoped result
 */
export type IncrementalSyncPayload = {
  readonly mode: "incremental";
  readonly scope: SyncScope;
  readonly after: AuthoritativeGraphCursor;
  readonly transactions: readonly AuthoritativeGraphWriteResult[];
  readonly cursor: AuthoritativeGraphCursor;
  readonly completeness: "complete";
  readonly freshness: SyncFreshness;
};

/**
 * Recovery-only incremental result. An empty `transactions` array with
 * `fallback` is distinct from a successful empty incremental payload.
 */
export type IncrementalSyncFallback = {
  readonly mode: "incremental";
  readonly scope: SyncScope;
  readonly after: AuthoritativeGraphCursor;
  readonly transactions: readonly [];
  readonly cursor: AuthoritativeGraphCursor;
  readonly completeness: "complete";
  readonly freshness: SyncFreshness;
  readonly fallback: IncrementalSyncFallbackReason;
};

export type IncrementalSyncResult = IncrementalSyncPayload | IncrementalSyncFallback;
export type SyncPayload = TotalSyncPayload | IncrementalSyncResult;

export function isIncrementalSyncFallback(
  result: IncrementalSyncResult,
): result is IncrementalSyncFallback {
  return "fallback" in result;
}

export type GraphWriteAssertOperation = {
  readonly op: "assert";
  readonly edge: StoreSnapshot["edges"][number];
};

export type GraphWriteRetractOperation = {
  readonly op: "retract";
  readonly edgeId: string;
};

export type GraphWriteOperation = GraphWriteAssertOperation | GraphWriteRetractOperation;

/**
 * Caller-supplied authoritative write envelope.
 *
 * `id` is the idempotency key. Reusing it with the same canonical operations
 * replays the accepted result; reusing it for different operations is invalid.
 */
export type GraphWriteTransaction = {
  readonly id: string;
  readonly ops: readonly GraphWriteOperation[];
};

export type AuthoritativeWriteScope = GraphFieldWritePolicy;
export const authoritativeWriteScopes = [
  "client-tx",
  "server-command",
  "authority-only",
] as const satisfies readonly AuthoritativeWriteScope[];

export function isAuthoritativeWriteScope(value: unknown): value is AuthoritativeWriteScope {
  return (
    typeof value === "string" && (authoritativeWriteScopes as readonly string[]).includes(value)
  );
}

/**
 * Accepted authoritative write acknowledgement.
 *
 * `replayed` is only true on the direct response to a duplicate `txId` whose
 * canonical operations match a previously accepted transaction. Retained
 * history and incremental delivery keep the original accepted result with
 * `replayed: false`.
 */
export type AuthoritativeGraphWriteResult = {
  readonly txId: string;
  readonly cursor: AuthoritativeGraphCursor;
  readonly replayed: boolean;
  readonly writeScope: AuthoritativeWriteScope;
  readonly transaction: GraphWriteTransaction;
};

/**
 * Retained suffix of accepted write results for restart recovery and
 * incremental delivery.
 *
 * `cursorPrefix` and `baseSequence` belong to the persisted authority
 * implementation; transport callers should treat exported cursors as opaque.
 */
export type AuthoritativeGraphWriteHistory = {
  readonly cursorPrefix: string;
  readonly baseSequence: number;
  readonly results: readonly AuthoritativeGraphWriteResult[];
};

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

export type GraphWriteSink = (
  transaction: GraphWriteTransaction,
) => AuthoritativeGraphWriteResult | Promise<AuthoritativeGraphWriteResult>;

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

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

export function cloneTotalSyncPayload(payload: TotalSyncPayload): TotalSyncPayload {
  return {
    ...payload,
    scope: { ...payload.scope },
    snapshot: {
      edges: payload.snapshot.edges.map((edge) => ({ ...edge })),
      retracted: [...payload.snapshot.retracted],
    },
  };
}

export function cloneIncrementalSyncResult(result: IncrementalSyncResult): IncrementalSyncResult {
  return "fallback" in result
    ? {
        ...result,
        scope: { ...result.scope },
        transactions: [],
      }
    : {
        ...result,
        scope: { ...result.scope },
        transactions: result.transactions.map((transaction) =>
          cloneAuthoritativeGraphWriteResult(transaction),
        ),
      };
}

export class GraphSyncWriteError extends Error {
  override readonly name: string;
  readonly transaction: GraphWriteTransaction;
  override readonly cause: unknown;

  constructor(transaction: GraphWriteTransaction, cause: unknown) {
    super(`Failed to push pending graph write "${transaction.id}".`);
    this.name = "GraphSyncWriteError";
    this.transaction = cloneGraphWriteTransaction(transaction);
    this.cause = cause;
  }
}

export type SyncState = {
  readonly mode: "total";
  readonly scope: SyncScope;
  readonly status: SyncStatus;
  readonly completeness: SyncCompleteness;
  readonly freshness: SyncFreshness;
  readonly pendingCount: number;
  readonly recentActivities: readonly SyncActivity[];
  readonly cursor?: string;
  readonly lastSyncedAt?: Date;
  readonly error?: unknown;
};

export type SyncStateListener = (state: SyncState) => void;
export type SyncSource = (state: SyncState) => SyncPayload | Promise<SyncPayload>;
export type TotalSyncSource = SyncSource;
export type TotalSyncPayloadValidator = (payload: TotalSyncPayload) => void;
export type AuthoritativeGraphWriteResultValidator = (
  result: AuthoritativeGraphWriteResult,
  store?: Store,
) => void;

export interface TotalSyncController {
  apply(payload: SyncPayload): SyncPayload;
  applyWriteResult(result: AuthoritativeGraphWriteResult): AuthoritativeGraphWriteResult;
  sync(): Promise<SyncPayload>;
  getState(): SyncState;
  subscribe(listener: SyncStateListener): () => void;
}

export interface SyncedTypeSyncController extends TotalSyncController {
  flush(): Promise<readonly AuthoritativeGraphWriteResult[]>;
  getPendingTransactions(): readonly GraphWriteTransaction[];
}

export type SyncedTypeClient<T extends Record<string, AnyTypeOutput>> = {
  store: Store;
  graph: NamespaceClient<typeof core & T>;
  sync: SyncedTypeSyncController;
};

export interface TotalSyncSession {
  apply(payload: SyncPayload): SyncPayload;
  applyWriteResult(result: AuthoritativeGraphWriteResult): AuthoritativeGraphWriteResult;
  pull(source: SyncSource): Promise<SyncPayload>;
  getState(): SyncState;
  subscribe(listener: SyncStateListener): () => void;
}

export interface AuthoritativeGraphWriteSession {
  apply(
    transaction: GraphWriteTransaction,
    options?: {
      writeScope?: AuthoritativeWriteScope;
    },
  ): AuthoritativeGraphWriteResult;
  getCursor(): string | undefined;
  getBaseCursor(): string;
  getChangesAfter(cursor?: string): AuthoritativeGraphChangesAfterResult;
  getIncrementalSyncResult(
    after?: string,
    options?: {
      freshness?: SyncFreshness;
    },
  ): IncrementalSyncResult;
  getHistory(): AuthoritativeGraphWriteHistory;
}

const maxSyncActivities = 8;

export function cloneSyncActivity(activity: SyncActivity): SyncActivity {
  if (activity.kind === "incremental") {
    return {
      ...activity,
      txIds: [...activity.txIds],
      writeScopes: [...activity.writeScopes],
      at: new Date(activity.at.getTime()),
    };
  }

  return {
    ...activity,
    at: new Date(activity.at.getTime()),
  };
}

export function sameSyncActivity(left: SyncActivity, right: SyncActivity): boolean {
  if (left.kind !== right.kind) return false;
  if (left.cursor !== right.cursor) return false;
  if (left.freshness !== right.freshness) return false;
  if (left.at.getTime() !== right.at.getTime()) return false;

  if (left.kind === "total" && right.kind === "total") return true;
  if (left.kind === "write" && right.kind === "write") {
    return (
      left.txId === right.txId &&
      left.replayed === right.replayed &&
      left.writeScope === right.writeScope
    );
  }
  if (left.kind === "fallback" && right.kind === "fallback") {
    return left.after === right.after && left.reason === right.reason;
  }
  if (left.kind === "incremental" && right.kind === "incremental") {
    if (
      left.after !== right.after ||
      left.transactionCount !== right.transactionCount ||
      left.txIds.length !== right.txIds.length ||
      left.writeScopes.length !== right.writeScopes.length
    ) {
      return false;
    }

    for (let index = 0; index < left.txIds.length; index += 1) {
      if (left.txIds[index] !== right.txIds[index]) return false;
      if (left.writeScopes[index] !== right.writeScopes[index]) return false;
    }
    return true;
  }

  return false;
}

export function appendSyncActivity(
  activities: readonly SyncActivity[],
  activity: SyncActivity,
): SyncActivity[] {
  const next = [...activities, cloneSyncActivity(activity)];
  return next.slice(-maxSyncActivities);
}

export function cloneState(state: SyncState): SyncState {
  return {
    ...state,
    scope: graphSyncScope,
    pendingCount: state.pendingCount,
    recentActivities: state.recentActivities.map((activity) => cloneSyncActivity(activity)),
    lastSyncedAt: state.lastSyncedAt ? new Date(state.lastSyncedAt.getTime()) : undefined,
  };
}
