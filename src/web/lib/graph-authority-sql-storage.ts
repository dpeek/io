import {
  type PersistedAuthoritativeGraphStorageCommitInput as DurableAuthorityCommitInput,
  type PersistedAuthoritativeGraphStoragePersistInput as DurableAuthorityPersistInput,
} from "@io/core/graph";
import type { RetainedWorkflowProjectionState } from "@io/core/graph/modules/ops/workflow";
import {
  isAuthoritativeGraphRetainedHistoryPolicy,
  type AuthoritativeGraphRetainedHistoryPolicy,
} from "@io/graph-kernel";

import type {
  WebAppAuthoritySecretInventoryRecord,
  WebAppAuthoritySecretLoadOptions,
  WebAppAuthoritySecretRecord,
  WebAppAuthoritySecretRepairInput,
  WebAppAuthoritySecretWrite,
  WebAppAuthorityStorage,
} from "./authority.js";
import {
  bootstrapSecretValueTable,
  pruneOrphanedSecretValues,
  pruneSecretValueRows,
  readSecretInventoryFromSql,
  readSecretsFromSql,
  upsertSecretValue,
} from "./graph-authority-sql-secrets.js";
import {
  loadPersistedAuthorityState,
  readAllRows,
  readGraphMetaRow,
  readOneRow,
  requireInteger,
  requireString,
  type DurableObjectSqlStorageLike,
} from "./graph-authority-sql-startup.js";
import {
  bootstrapWorkflowProjectionTables,
  readWorkflowProjectionFromSql,
  replaceWorkflowProjectionRows,
} from "./graph-authority-sql-workflow-projection.js";

export type DurableObjectStorageLike = {
  sql: DurableObjectSqlStorageLike;
  transaction?<T>(callback: () => Promise<T> | T): Promise<T>;
  transactionSync?<T>(callback: () => T): T;
};

export type DurableObjectStateLike = {
  storage: DurableObjectStorageLike;
};

export type DurableObjectEnvLike = {
  GRAPH_AUTHORITY_RETAINED_HISTORY_POLICY?: AuthoritativeGraphRetainedHistoryPolicy | string;
};

const durableObjectAuthoritySchemaVersion = 1;
const defaultMaxRetainedTransactions = 128;
const defaultRetainedHistoryPolicy = {
  kind: "transaction-count",
  maxTransactions: defaultMaxRetainedTransactions,
} as const satisfies AuthoritativeGraphRetainedHistoryPolicy;

function formatCursor(cursorPrefix: string, sequence: number): string {
  return `${cursorPrefix}${sequence}`;
}

export function readRetainedHistoryPolicy(
  env: DurableObjectEnvLike,
): AuthoritativeGraphRetainedHistoryPolicy {
  const configured = env.GRAPH_AUTHORITY_RETAINED_HISTORY_POLICY;
  if (configured === undefined) {
    return defaultRetainedHistoryPolicy;
  }

  if (isAuthoritativeGraphRetainedHistoryPolicy(configured)) {
    return configured;
  }

  if (typeof configured !== "string" || configured.trim().length === 0) {
    throw new Error(
      "GRAPH_AUTHORITY_RETAINED_HISTORY_POLICY must be a retained-history policy object or a JSON string when provided.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(configured);
  } catch {
    throw new Error(
      "GRAPH_AUTHORITY_RETAINED_HISTORY_POLICY must be valid JSON when provided as a string.",
    );
  }

  if (!isAuthoritativeGraphRetainedHistoryPolicy(parsed)) {
    throw new Error(
      "GRAPH_AUTHORITY_RETAINED_HISTORY_POLICY must decode to a supported retained-history policy.",
    );
  }

  return parsed;
}

function headSequence(writeHistory: DurableAuthorityPersistInput["writeHistory"]): number {
  return writeHistory.baseSequence + writeHistory.results.length;
}

function headCursor(writeHistory: DurableAuthorityPersistInput["writeHistory"]): string {
  return (
    writeHistory.results.at(-1)?.cursor ??
    formatCursor(writeHistory.cursorPrefix, writeHistory.baseSequence)
  );
}

function writeGraphMetaRow(
  sql: DurableObjectSqlStorageLike,
  input: {
    cursorPrefix: string;
    headCursor: string;
    headSeq: number;
    historyRetainedFromSeq: number;
    retainedHistoryPolicy: AuthoritativeGraphRetainedHistoryPolicy;
    seededAt: string | null;
    updatedAt: string;
  },
): void {
  sql.exec(
    `INSERT INTO io_graph_meta (
      id,
      schema_version,
      cursor_prefix,
      head_seq,
      head_cursor,
      seeded_at,
      history_retained_from_seq,
      retained_history_policy_kind,
      retained_history_policy_max_transactions,
      updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      schema_version = excluded.schema_version,
      cursor_prefix = excluded.cursor_prefix,
      head_seq = excluded.head_seq,
      head_cursor = excluded.head_cursor,
      seeded_at = excluded.seeded_at,
      history_retained_from_seq = excluded.history_retained_from_seq,
      retained_history_policy_kind = excluded.retained_history_policy_kind,
      retained_history_policy_max_transactions = excluded.retained_history_policy_max_transactions,
      updated_at = excluded.updated_at`,
    durableObjectAuthoritySchemaVersion,
    input.cursorPrefix,
    input.headSeq,
    input.headCursor,
    input.seededAt,
    input.historyRetainedFromSeq,
    input.retainedHistoryPolicy.kind,
    input.retainedHistoryPolicy.kind === "transaction-count"
      ? input.retainedHistoryPolicy.maxTransactions
      : null,
    input.updatedAt,
  );
}

function insertTransactionHistoryRows(
  sql: DurableObjectSqlStorageLike,
  writeHistory: DurableAuthorityPersistInput["writeHistory"],
  committedAt: string,
): void {
  writeHistory.results.forEach((result, index) => {
    const seq = writeHistory.baseSequence + index + 1;
    sql.exec(
      `INSERT INTO io_graph_tx (seq, tx_id, cursor, committed_at, write_scope)
      VALUES (?, ?, ?, ?, ?)`,
      seq,
      result.txId,
      result.cursor,
      committedAt,
      result.writeScope,
    );

    result.transaction.ops.forEach((op, opIndex) => {
      if (op.op === "assert") {
        sql.exec(
          `INSERT INTO io_graph_tx_op (tx_seq, op_index, op_kind, edge_id, s, p, o)
          VALUES (?, ?, 'assert', ?, ?, ?, ?)`,
          seq,
          opIndex,
          op.edge.id,
          op.edge.s,
          op.edge.p,
          op.edge.o,
        );
        return;
      }

      sql.exec(
        `INSERT INTO io_graph_tx_op (tx_seq, op_index, op_kind, edge_id, s, p, o)
        VALUES (?, ?, 'retract', ?, NULL, NULL, NULL)`,
        seq,
        opIndex,
        op.edgeId,
      );
    });
  });
}

function buildEdgeSequenceIndex(writeHistory: DurableAuthorityPersistInput["writeHistory"]): {
  assertedByEdgeId: Map<string, number>;
  retractedByEdgeId: Map<string, number>;
} {
  const assertedByEdgeId = new Map<string, number>();
  const retractedByEdgeId = new Map<string, number>();

  writeHistory.results.forEach((result, index) => {
    const seq = writeHistory.baseSequence + index + 1;
    result.transaction.ops.forEach((op) => {
      if (op.op === "assert") {
        assertedByEdgeId.set(op.edge.id, seq);
        return;
      }
      retractedByEdgeId.set(op.edgeId, seq);
    });
  });

  return { assertedByEdgeId, retractedByEdgeId };
}

function insertSnapshotEdges(
  sql: DurableObjectSqlStorageLike,
  snapshot: DurableAuthorityPersistInput["snapshot"],
  writeHistory: DurableAuthorityPersistInput["writeHistory"],
): void {
  const fallbackSequence = writeHistory.baseSequence;
  const { assertedByEdgeId, retractedByEdgeId } = buildEdgeSequenceIndex(writeHistory);
  const retractedOrderByEdgeId = new Map(
    snapshot.retracted.map((edgeId, index) => [edgeId, index] as const),
  );

  snapshot.edges.forEach((edge) => {
    sql.exec(
      `INSERT INTO io_graph_edge (
        edge_id,
        s,
        p,
        o,
        asserted_tx_seq,
        retracted_tx_seq,
        retracted_op_index
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      edge.id,
      edge.s,
      edge.p,
      edge.o,
      assertedByEdgeId.get(edge.id) ?? fallbackSequence,
      retractedOrderByEdgeId.has(edge.id)
        ? (retractedByEdgeId.get(edge.id) ?? fallbackSequence)
        : null,
      retractedOrderByEdgeId.get(edge.id) ?? null,
    );
  });
}

function pruneRetainedTransactionRows(
  sql: DurableObjectSqlStorageLike,
  retainedFromSequence: number,
): void {
  sql.exec(
    `DELETE FROM io_graph_tx_op
    WHERE tx_seq <= ?`,
    retainedFromSequence,
  );
  sql.exec(
    `DELETE FROM io_graph_tx
    WHERE seq <= ?`,
    retainedFromSequence,
  );
}

function rewritePersistedState(
  sql: DurableObjectSqlStorageLike,
  input: DurableAuthorityPersistInput,
  workflowProjection?: RetainedWorkflowProjectionState,
): void {
  const now = new Date().toISOString();
  const existingMeta = readGraphMetaRow(sql, defaultRetainedHistoryPolicy);

  sql.exec("DELETE FROM io_graph_tx_op");
  sql.exec("DELETE FROM io_graph_tx");
  sql.exec("DELETE FROM io_graph_edge");
  insertTransactionHistoryRows(sql, input.writeHistory, now);
  insertSnapshotEdges(sql, input.snapshot, input.writeHistory);
  replaceWorkflowProjectionRows(sql, workflowProjection);
  pruneOrphanedSecretValues(sql, input.snapshot);
  writeGraphMetaRow(sql, {
    cursorPrefix: input.writeHistory.cursorPrefix,
    headCursor: headCursor(input.writeHistory),
    headSeq: headSequence(input.writeHistory),
    historyRetainedFromSeq: input.writeHistory.baseSequence,
    retainedHistoryPolicy: input.writeHistory.retainedHistoryPolicy,
    seededAt: existingMeta?.seededAt ?? now,
    updatedAt: now,
  });
}

function applyCommittedTransaction(
  sql: DurableObjectSqlStorageLike,
  input: DurableAuthorityCommitInput,
  secretWrite?: WebAppAuthoritySecretWrite,
  workflowProjection?: RetainedWorkflowProjectionState,
): void {
  if (input.result.replayed) return;

  const now = new Date().toISOString();
  const existingMeta = readGraphMetaRow(sql, defaultRetainedHistoryPolicy);
  const sequence = headSequence(input.writeHistory);

  sql.exec(
    `INSERT INTO io_graph_tx (seq, tx_id, cursor, committed_at, write_scope)
    VALUES (?, ?, ?, ?, ?)`,
    sequence,
    input.result.txId,
    input.result.cursor,
    now,
    input.result.writeScope,
  );

  input.transaction.ops.forEach((op, opIndex) => {
    if (op.op === "assert") {
      sql.exec(
        `INSERT INTO io_graph_tx_op (tx_seq, op_index, op_kind, edge_id, s, p, o)
        VALUES (?, ?, 'assert', ?, ?, ?, ?)`,
        sequence,
        opIndex,
        op.edge.id,
        op.edge.s,
        op.edge.p,
        op.edge.o,
      );
      sql.exec(
        `INSERT INTO io_graph_edge (
          edge_id,
          s,
          p,
          o,
          asserted_tx_seq,
          retracted_tx_seq,
          retracted_op_index
        )
        VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
        op.edge.id,
        op.edge.s,
        op.edge.p,
        op.edge.o,
        sequence,
      );
      return;
    }

    sql.exec(
      `INSERT INTO io_graph_tx_op (tx_seq, op_index, op_kind, edge_id, s, p, o)
      VALUES (?, ?, 'retract', ?, NULL, NULL, NULL)`,
      sequence,
      opIndex,
      op.edgeId,
    );
    sql.exec(
      `UPDATE io_graph_edge
      SET retracted_tx_seq = ?, retracted_op_index = ?
      WHERE edge_id = ?`,
      sequence,
      opIndex,
      op.edgeId,
    );
    const changed = readOneRow<{ changes: number }>(sql, "SELECT changes() AS changes");
    if (!changed || requireInteger(changed.changes, "changes") !== 1) {
      throw new Error(`Cannot retract unknown durable edge "${op.edgeId}".`);
    }
  });

  if (secretWrite) {
    upsertSecretValue(sql, secretWrite, now);
  }
  replaceWorkflowProjectionRows(sql, workflowProjection);
  pruneOrphanedSecretValues(sql, input.snapshot);
  if ((existingMeta?.historyRetainedFromSeq ?? 0) < input.writeHistory.baseSequence) {
    pruneRetainedTransactionRows(sql, input.writeHistory.baseSequence);
  }
  writeGraphMetaRow(sql, {
    cursorPrefix: input.writeHistory.cursorPrefix,
    headCursor: input.result.cursor,
    headSeq: sequence,
    historyRetainedFromSeq: input.writeHistory.baseSequence,
    retainedHistoryPolicy: input.writeHistory.retainedHistoryPolicy,
    seededAt: existingMeta?.seededAt ?? now,
    updatedAt: now,
  });
}

async function runStorageTransaction<T>(
  storage: DurableObjectStorageLike,
  callback: () => T,
): Promise<T> {
  if (typeof storage.transactionSync === "function") {
    return storage.transactionSync(callback);
  }
  if (typeof storage.transaction === "function") {
    return storage.transaction(callback);
  }
  throw new Error("Durable Object storage transactions are required for graph persistence.");
}

export function createSqliteDurableObjectAuthorityStorage(
  state: DurableObjectStateLike,
): WebAppAuthorityStorage {
  return {
    async load() {
      return loadPersistedAuthorityState(state.storage.sql, {
        defaultRetainedHistoryPolicy,
        expectedSchemaVersion: durableObjectAuthoritySchemaVersion,
      });
    },
    async loadWorkflowProjection(): Promise<RetainedWorkflowProjectionState | null> {
      const meta = readGraphMetaRow(state.storage.sql, defaultRetainedHistoryPolicy);
      if (!meta) {
        return null;
      }
      return readWorkflowProjectionFromSql(state.storage.sql, meta.headCursor);
    },
    async replaceWorkflowProjection(
      workflowProjection: RetainedWorkflowProjectionState | null,
    ): Promise<void> {
      await runStorageTransaction(state.storage, () => {
        replaceWorkflowProjectionRows(state.storage.sql, workflowProjection ?? undefined);
      });
    },
    async inspectSecrets(): Promise<Record<string, WebAppAuthoritySecretInventoryRecord>> {
      return readSecretInventoryFromSql(state.storage.sql);
    },
    async loadSecrets(
      options?: WebAppAuthoritySecretLoadOptions,
    ): Promise<Record<string, WebAppAuthoritySecretRecord>> {
      return readSecretsFromSql(state.storage.sql, options);
    },
    async repairSecrets(input: WebAppAuthoritySecretRepairInput): Promise<void> {
      await runStorageTransaction(state.storage, () => {
        pruneSecretValueRows(state.storage.sql, input.liveSecretIds);
      });
    },
    async commit(input, options): Promise<void> {
      await runStorageTransaction(state.storage, () => {
        applyCommittedTransaction(
          state.storage.sql,
          input,
          options?.secretWrite,
          options?.workflowProjection,
        );
      });
    },
    async persist(input, options): Promise<void> {
      await runStorageTransaction(state.storage, () => {
        rewritePersistedState(state.storage.sql, input, options?.workflowProjection);
      });
    },
  };
}

export function bootstrapDurableObjectAuthoritySchema(storage: DurableObjectStorageLike): void {
  storage.sql.exec(
    `CREATE TABLE IF NOT EXISTS io_graph_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL,
      cursor_prefix TEXT NOT NULL,
      head_seq INTEGER NOT NULL,
      head_cursor TEXT NOT NULL,
      seeded_at TEXT,
      history_retained_from_seq INTEGER NOT NULL,
      retained_history_policy_kind TEXT NOT NULL,
      retained_history_policy_max_transactions INTEGER,
      updated_at TEXT NOT NULL
    )`,
  );
  const graphMetaColumns = new Set(
    readAllRows<{ name: string }>(storage.sql.exec("PRAGMA table_info(io_graph_meta)")).map((row) =>
      requireString(row.name, "PRAGMA table_info(io_graph_meta).name"),
    ),
  );
  if (!graphMetaColumns.has("retained_history_policy_kind")) {
    storage.sql.exec(
      `ALTER TABLE io_graph_meta
      ADD COLUMN retained_history_policy_kind TEXT NOT NULL DEFAULT 'transaction-count'`,
    );
  }
  if (!graphMetaColumns.has("retained_history_policy_max_transactions")) {
    storage.sql.exec(
      `ALTER TABLE io_graph_meta
      ADD COLUMN retained_history_policy_max_transactions INTEGER DEFAULT 128`,
    );
  }
  storage.sql.exec(
    `CREATE TABLE IF NOT EXISTS io_graph_tx (
      seq INTEGER PRIMARY KEY,
      tx_id TEXT NOT NULL UNIQUE,
      cursor TEXT NOT NULL UNIQUE,
      committed_at TEXT NOT NULL,
      write_scope TEXT NOT NULL DEFAULT 'client-tx'
        CHECK (write_scope IN ('client-tx', 'server-command', 'authority-only'))
    )`,
  );
  const graphTxColumns = new Set(
    readAllRows<{ name: string }>(storage.sql.exec("PRAGMA table_info(io_graph_tx)")).map((row) =>
      requireString(row.name, "PRAGMA table_info(io_graph_tx).name"),
    ),
  );
  if (!graphTxColumns.has("write_scope")) {
    storage.sql.exec(
      `ALTER TABLE io_graph_tx
      ADD COLUMN write_scope TEXT NOT NULL DEFAULT 'client-tx'
        CHECK (write_scope IN ('client-tx', 'server-command', 'authority-only'))`,
    );
  }
  storage.sql.exec(
    `CREATE TABLE IF NOT EXISTS io_graph_tx_op (
      tx_seq INTEGER NOT NULL,
      op_index INTEGER NOT NULL,
      op_kind TEXT NOT NULL CHECK (op_kind IN ('assert', 'retract')),
      edge_id TEXT NOT NULL,
      s TEXT,
      p TEXT,
      o TEXT,
      PRIMARY KEY (tx_seq, op_index)
    )`,
  );
  storage.sql.exec(
    `CREATE TABLE IF NOT EXISTS io_graph_edge (
      edge_id TEXT PRIMARY KEY,
      s TEXT NOT NULL,
      p TEXT NOT NULL,
      o TEXT NOT NULL,
      asserted_tx_seq INTEGER NOT NULL,
      retracted_tx_seq INTEGER,
      retracted_op_index INTEGER
    )`,
  );
  const graphEdgeColumns = new Set(
    readAllRows<{ name: string }>(storage.sql.exec("PRAGMA table_info(io_graph_edge)")).map((row) =>
      requireString(row.name, "PRAGMA table_info(io_graph_edge).name"),
    ),
  );
  if (!graphEdgeColumns.has("retracted_op_index")) {
    storage.sql.exec("ALTER TABLE io_graph_edge ADD COLUMN retracted_op_index INTEGER");
  }
  bootstrapSecretValueTable(storage.sql);
  bootstrapWorkflowProjectionTables(storage.sql);
  storage.sql.exec(
    `CREATE INDEX IF NOT EXISTS io_graph_edge_subject_predicate_idx
    ON io_graph_edge (s, p)`,
  );
  storage.sql.exec(
    `CREATE INDEX IF NOT EXISTS io_graph_edge_predicate_object_idx
    ON io_graph_edge (p, o)`,
  );
  storage.sql.exec(
    `CREATE INDEX IF NOT EXISTS io_graph_edge_retracted_tx_seq_idx
    ON io_graph_edge (retracted_tx_seq)`,
  );
}
