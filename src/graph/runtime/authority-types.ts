import type {
  AuthoritativeGraphChangesAfterResult,
  AuthoritativeGraphRetainedHistoryPolicy,
  AuthoritativeGraphWriteHistory,
  AuthoritativeGraphWriteResult,
  GraphStoreSnapshot,
  GraphWriteScope,
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
      writeScope?: GraphWriteScope;
    },
  ): AuthoritativeGraphWriteResult;
  applyWithSnapshot(
    transaction: GraphWriteTransaction,
    options?: {
      writeScope?: GraphWriteScope;
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
