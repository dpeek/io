import type {
  AuthoritativeGraphChangesAfterResult,
  AuthoritativeGraphRetainedHistoryPolicy,
  AuthoritativeGraphWriteHistory,
  AuthoritativeGraphWriteResult,
  AuthoritativeWriteScope,
  GraphStoreSnapshot,
  GraphWriteTransaction,
} from "@io/graph-kernel";
import type { IncrementalSyncResult, SyncFreshness } from "@io/graph-sync";

export type ReplicatedPredicateTarget = {
  readonly subjectId: string;
  readonly predicateId: string;
};

export type ReplicationReadAuthorizer = (target: ReplicatedPredicateTarget) => boolean;

export interface AuthoritativeGraphWriteSession {
  apply(
    transaction: GraphWriteTransaction,
    options?: {
      writeScope?: AuthoritativeWriteScope;
    },
  ): AuthoritativeGraphWriteResult;
  applyWithSnapshot(
    transaction: GraphWriteTransaction,
    options?: {
      writeScope?: AuthoritativeWriteScope;
      sourceSnapshot?: GraphStoreSnapshot;
    },
  ): {
    result: AuthoritativeGraphWriteResult;
    snapshot: GraphStoreSnapshot;
  };
  getCursor(): string | undefined;
  getBaseCursor(): string;
  getRetainedHistoryPolicy(): AuthoritativeGraphRetainedHistoryPolicy;
  getChangesAfter(cursor?: string): AuthoritativeGraphChangesAfterResult;
  getIncrementalSyncResult(
    after?: string,
    options?: {
      authorizeRead?: ReplicationReadAuthorizer;
      freshness?: SyncFreshness;
    },
  ): IncrementalSyncResult;
  getHistory(): AuthoritativeGraphWriteHistory;
}
