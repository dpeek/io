import type {
  PersistedAuthoritativeGraphStorageCommitInput as DurableAuthorityCommitInput,
  PersistedAuthoritativeGraphStorageLoadResult as DurableAuthorityLoadResult,
  PersistedAuthoritativeGraphStoragePersistInput as DurableAuthorityPersistInput,
} from "@io/core/graph";

import type {
  WebAppAuthority,
  WebAppAuthoritySecretRecord,
  WebAppAuthoritySecretWrite,
  WebAppAuthorityStorage,
} from "./authority.js";
import { createWebAppAuthority } from "./authority.js";
import {
  handleSecretFieldRequest,
  handleSyncRequest,
  handleTransactionRequest,
} from "./server-routes.js";

type SqlRow = Record<string, unknown>;

type SqlCursorLike<T extends SqlRow = SqlRow> = Iterable<T> & {
  one?(): T | null | undefined;
};

type DurableObjectSqlStorageLike = {
  exec<T extends SqlRow = SqlRow>(query: string, ...bindings: unknown[]): SqlCursorLike<T>;
};

type DurableObjectStorageLike = {
  sql: DurableObjectSqlStorageLike;
  transaction?<T>(callback: () => Promise<T> | T): Promise<T>;
  transactionSync?<T>(callback: () => T): T;
};

type DurableObjectStateLike = {
  storage: DurableObjectStorageLike;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
};

type DurableObjectEnvLike = {
  GRAPH_AUTHORITY_MAX_RETAINED_TRANSACTIONS?: number | string;
};

type GraphMetaRow = {
  cursor_prefix: string;
  head_cursor: string;
  head_seq: number;
  history_retained_from_seq: number;
  schema_version: number;
  seeded_at: string | null;
  updated_at: string;
};

type GraphTxRow = {
  committed_at: string;
  cursor: string;
  seq: number;
  tx_id: string;
};

type GraphTxOpRow = {
  edge_id: string;
  o: string | null;
  op_index: number;
  op_kind: "assert" | "retract";
  p: string | null;
  s: string | null;
  tx_seq: number;
};

type GraphEdgeRow = {
  asserted_tx_seq: number;
  edge_id: string;
  o: string;
  p: string;
  retracted_op_index: number | null;
  retracted_tx_seq: number | null;
  s: string;
};

type SecretValueRow = {
  external_key_id: string | null;
  fingerprint: string | null;
  provider: string | null;
  secret_id: string;
  stored_at: string;
  value: string;
  version: number;
};

const durableObjectAuthoritySchemaVersion = 1;
const defaultMaxRetainedTransactions = 128;

function formatCursor(cursorPrefix: string, sequence: number): string {
  return `${cursorPrefix}${sequence}`;
}

function readMaxRetainedTransactions(env: DurableObjectEnvLike): number {
  const configured = env.GRAPH_AUTHORITY_MAX_RETAINED_TRANSACTIONS;
  if (configured === undefined) return defaultMaxRetainedTransactions;
  const parsed =
    typeof configured === "number" ? configured : Number.parseInt(configured.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      "GRAPH_AUTHORITY_MAX_RETAINED_TRANSACTIONS must be a positive integer when provided.",
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

function readAllRows<T extends SqlRow>(cursor: SqlCursorLike<T>): T[] {
  return [...cursor];
}

function readOneRow<T extends SqlRow>(
  sql: DurableObjectSqlStorageLike,
  query: string,
  ...bindings: unknown[]
): T | null {
  const cursor = sql.exec<T>(query, ...bindings);
  if (typeof cursor.one === "function") {
    return cursor.one() ?? null;
  }
  return readAllRows(cursor)[0] ?? null;
}

function requireInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Expected "${label}" to be an integer.`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected "${label}" to be a string.`);
  }
  return value;
}

function requireNullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requireString(value, label);
}

function readGraphMetaRow(sql: DurableObjectSqlStorageLike): {
  cursorPrefix: string;
  headCursor: string;
  headSeq: number;
  historyRetainedFromSeq: number;
  schemaVersion: number;
  seededAt: string | null;
  updatedAt: string;
} | null {
  const row = readOneRow<GraphMetaRow>(
    sql,
    `SELECT
      schema_version,
      cursor_prefix,
      head_seq,
      head_cursor,
      seeded_at,
      history_retained_from_seq,
      updated_at
    FROM io_graph_meta
    WHERE id = 1`,
  );
  if (!row) return null;

  return {
    cursorPrefix: requireString(row.cursor_prefix, "io_graph_meta.cursor_prefix"),
    headCursor: requireString(row.head_cursor, "io_graph_meta.head_cursor"),
    headSeq: requireInteger(row.head_seq, "io_graph_meta.head_seq"),
    historyRetainedFromSeq: requireInteger(
      row.history_retained_from_seq,
      "io_graph_meta.history_retained_from_seq",
    ),
    schemaVersion: requireInteger(row.schema_version, "io_graph_meta.schema_version"),
    seededAt: requireNullableString(row.seeded_at, "io_graph_meta.seeded_at"),
    updatedAt: requireString(row.updated_at, "io_graph_meta.updated_at"),
  };
}

function buildSnapshotFromSql(sql: DurableObjectSqlStorageLike): {
  headSequence: number;
  snapshot: DurableAuthorityLoadResult["snapshot"];
} {
  const edges = readAllRows<GraphEdgeRow>(
    sql.exec(
      `SELECT edge_id, s, p, o, asserted_tx_seq, retracted_tx_seq
      FROM io_graph_edge
      ORDER BY asserted_tx_seq ASC, rowid ASC`,
    ),
  );
  const retracted = readAllRows<
    Pick<GraphEdgeRow, "edge_id"> & {
      retracted_op_index: number | null;
      retracted_tx_seq: number;
    }
  >(
    sql.exec(
      `SELECT edge_id, retracted_tx_seq, retracted_op_index
      FROM io_graph_edge
      WHERE retracted_tx_seq IS NOT NULL
      ORDER BY
        retracted_tx_seq ASC,
        CASE WHEN retracted_op_index IS NULL THEN 1 ELSE 0 END ASC,
        retracted_op_index ASC,
        rowid ASC`,
    ),
  ).map((row) => requireString(row.edge_id, "io_graph_edge.edge_id"));

  let headSequence = 0;
  for (const row of edges) {
    headSequence = Math.max(
      headSequence,
      requireInteger(row.asserted_tx_seq, "io_graph_edge.asserted_tx_seq"),
      row.retracted_tx_seq === null
        ? 0
        : requireInteger(row.retracted_tx_seq, "io_graph_edge.retracted_tx_seq"),
    );
  }

  return {
    headSequence,
    snapshot: {
      edges: edges.map((row) => ({
        id: requireString(row.edge_id, "io_graph_edge.edge_id"),
        s: requireString(row.s, "io_graph_edge.s"),
        p: requireString(row.p, "io_graph_edge.p"),
        o: requireString(row.o, "io_graph_edge.o"),
      })),
      retracted,
    },
  };
}

function buildWriteHistoryFromSql(
  sql: DurableObjectSqlStorageLike,
  meta: NonNullable<ReturnType<typeof readGraphMetaRow>>,
  snapshotHeadSequence: number,
): {
  needsPersistence: boolean;
  writeHistory?: DurableAuthorityLoadResult["writeHistory"];
} {
  const transactions = readAllRows<GraphTxRow>(
    sql.exec(
      `SELECT seq, tx_id, cursor, committed_at
      FROM io_graph_tx
      ORDER BY seq ASC`,
    ),
  );
  const operations = readAllRows<GraphTxOpRow>(
    sql.exec(
      `SELECT tx_seq, op_index, op_kind, edge_id, s, p, o
      FROM io_graph_tx_op
      ORDER BY tx_seq ASC, op_index ASC`,
    ),
  );
  const opsBySequence = new Map<number, GraphTxOpRow[]>();

  for (const row of operations) {
    const txSequence = requireInteger(row.tx_seq, "io_graph_tx_op.tx_seq");
    const txOps = opsBySequence.get(txSequence) ?? [];
    txOps.push(row);
    opsBySequence.set(txSequence, txOps);
  }

  const baseSequence =
    transactions.length > 0
      ? requireInteger(transactions[0]?.seq, "io_graph_tx.seq") - 1
      : snapshotHeadSequence;
  const expectedHeadCursor = formatCursor(meta.cursorPrefix, snapshotHeadSequence);
  const needsPersistence =
    meta.headSeq !== snapshotHeadSequence ||
    meta.headCursor !== expectedHeadCursor ||
    meta.historyRetainedFromSeq !== baseSequence;

  if (!Number.isInteger(baseSequence) || baseSequence < 0) {
    return { needsPersistence: true };
  }

  const results: Array<NonNullable<DurableAuthorityLoadResult["writeHistory"]>["results"][number]> =
    [];
  let expectedSequence = baseSequence + 1;
  for (const row of transactions) {
    const seq = requireInteger(row.seq, "io_graph_tx.seq");
    const cursor = requireString(row.cursor, "io_graph_tx.cursor");
    if (seq !== expectedSequence || cursor !== formatCursor(meta.cursorPrefix, seq)) {
      return { needsPersistence: true };
    }

    results.push({
      txId: requireString(row.tx_id, "io_graph_tx.tx_id"),
      cursor,
      replayed: false,
      transaction: {
        id: requireString(row.tx_id, "io_graph_tx.tx_id"),
        ops: (opsBySequence.get(seq) ?? []).map((op) => {
          const kind = requireString(op.op_kind, "io_graph_tx_op.op_kind");
          if (kind === "assert") {
            return {
              op: "assert" as const,
              edge: {
                id: requireString(op.edge_id, "io_graph_tx_op.edge_id"),
                s: requireString(op.s, "io_graph_tx_op.s"),
                p: requireString(op.p, "io_graph_tx_op.p"),
                o: requireString(op.o, "io_graph_tx_op.o"),
              },
            };
          }

          if (kind === "retract") {
            return {
              op: "retract" as const,
              edgeId: requireString(op.edge_id, "io_graph_tx_op.edge_id"),
            };
          }

          throw new Error(`Unsupported graph op kind "${kind}".`);
        }),
      },
    });
    expectedSequence += 1;
  }

  if (results.length > 0 && expectedSequence - 1 !== snapshotHeadSequence) {
    return { needsPersistence: true };
  }

  return {
    needsPersistence,
    writeHistory: {
      cursorPrefix: meta.cursorPrefix,
      baseSequence,
      results,
    },
  };
}

function readSecretsFromSql(
  sql: DurableObjectSqlStorageLike,
): Record<string, WebAppAuthoritySecretRecord> {
  return Object.fromEntries(
    readAllRows<SecretValueRow>(
      sql.exec(
        `SELECT secret_id, value, version, stored_at, provider, fingerprint, external_key_id
        FROM io_secret_value
        ORDER BY secret_id ASC`,
      ),
    ).map((row) => [
      requireString(row.secret_id, "io_secret_value.secret_id"),
      {
        value: requireString(row.value, "io_secret_value.value"),
        version: requireInteger(row.version, "io_secret_value.version"),
        storedAt: requireString(row.stored_at, "io_secret_value.stored_at"),
        provider: requireNullableString(row.provider, "io_secret_value.provider") ?? undefined,
        fingerprint:
          requireNullableString(row.fingerprint, "io_secret_value.fingerprint") ?? undefined,
        externalKeyId:
          requireNullableString(row.external_key_id, "io_secret_value.external_key_id") ??
          undefined,
      },
    ]),
  );
}

function writeGraphMetaRow(
  sql: DurableObjectSqlStorageLike,
  input: {
    cursorPrefix: string;
    headCursor: string;
    headSeq: number;
    historyRetainedFromSeq: number;
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
      updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      schema_version = excluded.schema_version,
      cursor_prefix = excluded.cursor_prefix,
      head_seq = excluded.head_seq,
      head_cursor = excluded.head_cursor,
      seeded_at = excluded.seeded_at,
      history_retained_from_seq = excluded.history_retained_from_seq,
      updated_at = excluded.updated_at`,
    durableObjectAuthoritySchemaVersion,
    input.cursorPrefix,
    input.headSeq,
    input.headCursor,
    input.seededAt,
    input.historyRetainedFromSeq,
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
      `INSERT INTO io_graph_tx (seq, tx_id, cursor, committed_at)
      VALUES (?, ?, ?, ?)`,
      seq,
      result.txId,
      result.cursor,
      committedAt,
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

function upsertSecretValue(
  sql: DurableObjectSqlStorageLike,
  secretWrite: WebAppAuthoritySecretWrite,
  storedAt: string,
): void {
  sql.exec(
    `INSERT INTO io_secret_value (
      secret_id,
      value,
      version,
      stored_at,
      provider,
      fingerprint,
      external_key_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(secret_id) DO UPDATE SET
      value = excluded.value,
      version = excluded.version,
      stored_at = excluded.stored_at,
      provider = excluded.provider,
      fingerprint = excluded.fingerprint,
      external_key_id = excluded.external_key_id`,
    secretWrite.secretId,
    secretWrite.value,
    secretWrite.version,
    secretWrite.storedAt ?? storedAt,
    secretWrite.provider ?? null,
    secretWrite.fingerprint ?? null,
    secretWrite.externalKeyId ?? null,
  );
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
): void {
  const now = new Date().toISOString();
  const existingMeta = readGraphMetaRow(sql);

  sql.exec("DELETE FROM io_graph_tx_op");
  sql.exec("DELETE FROM io_graph_tx");
  sql.exec("DELETE FROM io_graph_edge");
  insertTransactionHistoryRows(sql, input.writeHistory, now);
  insertSnapshotEdges(sql, input.snapshot, input.writeHistory);
  writeGraphMetaRow(sql, {
    cursorPrefix: input.writeHistory.cursorPrefix,
    headCursor: headCursor(input.writeHistory),
    headSeq: headSequence(input.writeHistory),
    historyRetainedFromSeq: input.writeHistory.baseSequence,
    seededAt: existingMeta?.seededAt ?? now,
    updatedAt: now,
  });
}

function applyCommittedTransaction(
  sql: DurableObjectSqlStorageLike,
  input: DurableAuthorityCommitInput,
  secretWrite?: WebAppAuthoritySecretWrite,
): void {
  if (input.result.replayed) return;

  const now = new Date().toISOString();
  const existingMeta = readGraphMetaRow(sql);
  const sequence = headSequence(input.writeHistory);

  sql.exec(
    `INSERT INTO io_graph_tx (seq, tx_id, cursor, committed_at)
    VALUES (?, ?, ?, ?)`,
    sequence,
    input.result.txId,
    input.result.cursor,
    now,
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
  if ((existingMeta?.historyRetainedFromSeq ?? 0) < input.writeHistory.baseSequence) {
    pruneRetainedTransactionRows(sql, input.writeHistory.baseSequence);
  }
  writeGraphMetaRow(sql, {
    cursorPrefix: input.writeHistory.cursorPrefix,
    headCursor: input.result.cursor,
    headSeq: sequence,
    historyRetainedFromSeq: input.writeHistory.baseSequence,
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

function createSqliteDurableObjectAuthorityStorage(
  state: DurableObjectStateLike,
): WebAppAuthorityStorage {
  return {
    async load(): Promise<DurableAuthorityLoadResult | null> {
      const meta = readGraphMetaRow(state.storage.sql);
      if (!meta) return null;
      if (meta.schemaVersion !== durableObjectAuthoritySchemaVersion) {
        throw new Error(
          `Unsupported durable graph schema version ${meta.schemaVersion}. Expected ${durableObjectAuthoritySchemaVersion}.`,
        );
      }
      const hydratedSnapshot = buildSnapshotFromSql(state.storage.sql);
      const hydratedHistory = buildWriteHistoryFromSql(
        state.storage.sql,
        meta,
        hydratedSnapshot.headSequence,
      );

      return {
        snapshot: hydratedSnapshot.snapshot,
        writeHistory: hydratedHistory.writeHistory,
        needsPersistence: hydratedHistory.needsPersistence,
      };
    },
    async loadSecrets(): Promise<Record<string, WebAppAuthoritySecretRecord>> {
      return readSecretsFromSql(state.storage.sql);
    },
    async commit(input, options): Promise<void> {
      await runStorageTransaction(state.storage, () => {
        applyCommittedTransaction(state.storage.sql, input, options?.secretWrite);
      });
    },
    async persist(input): Promise<void> {
      await runStorageTransaction(state.storage, () => {
        rewritePersistedState(state.storage.sql, input);
      });
    },
  };
}

function bootstrapDurableObjectAuthoritySchema(storage: DurableObjectStorageLike): void {
  storage.sql.exec(
    `CREATE TABLE IF NOT EXISTS io_graph_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL,
      cursor_prefix TEXT NOT NULL,
      head_seq INTEGER NOT NULL,
      head_cursor TEXT NOT NULL,
      seeded_at TEXT,
      history_retained_from_seq INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );
  storage.sql.exec(
    `CREATE TABLE IF NOT EXISTS io_graph_tx (
      seq INTEGER PRIMARY KEY,
      tx_id TEXT NOT NULL UNIQUE,
      cursor TEXT NOT NULL UNIQUE,
      committed_at TEXT NOT NULL
    )`,
  );
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
  storage.sql.exec(
    `CREATE TABLE IF NOT EXISTS io_secret_value (
      secret_id TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      version INTEGER NOT NULL,
      stored_at TEXT NOT NULL,
      provider TEXT,
      fingerprint TEXT,
      external_key_id TEXT
    )`,
  );
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

export class WebGraphAuthorityDurableObject {
  private readonly state: DurableObjectStateLike;
  private readonly maxRetainedTransactions: number;
  private authorityPromise: Promise<WebAppAuthority> | null = null;

  constructor(state: DurableObjectStateLike, env: DurableObjectEnvLike = {}) {
    this.state = state;
    this.maxRetainedTransactions = readMaxRetainedTransactions(env);
    bootstrapDurableObjectAuthoritySchema(this.state.storage);
  }

  private getAuthority(): Promise<WebAppAuthority> {
    if (this.authorityPromise) return this.authorityPromise;

    const pending = this.state
      .blockConcurrencyWhile(() =>
        createWebAppAuthority(createSqliteDurableObjectAuthorityStorage(this.state), {
          maxRetainedTransactions: this.maxRetainedTransactions,
        }),
      )
      .catch((error) => {
        this.authorityPromise = null;
        throw error;
      });

    this.authorityPromise = pending;
    return pending;
  }

  async fetch(request: Request): Promise<Response> {
    const authority = await this.getAuthority();
    const url = new URL(request.url);

    if (url.pathname === "/api/sync") {
      return handleSyncRequest(request, authority);
    }

    if (url.pathname === "/api/tx") {
      return handleTransactionRequest(request, authority);
    }

    if (url.pathname === "/api/secret-fields") {
      return handleSecretFieldRequest(request, authority);
    }

    return new Response("Not Found", { status: 404 });
  }
}
