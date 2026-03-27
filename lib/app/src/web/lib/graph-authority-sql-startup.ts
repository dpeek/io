import {
  type PersistedAuthoritativeGraphStartupDiagnostics,
  type PersistedAuthoritativeGraphStartupRepairReason,
  type PersistedAuthoritativeGraphStartupResetReason,
  type PersistedAuthoritativeGraphStorageLoadResult,
} from "@io/graph-authority";
import {
  type AuthoritativeGraphRetainedHistoryPolicy,
  type GraphWriteScope,
} from "@io/graph-kernel";

type SqlRow = Record<string, unknown>;

export type SqlCursorLike<T extends SqlRow = SqlRow> = Iterable<T> & {
  one?(): T | null | undefined;
};

export type DurableObjectSqlStorageLike = {
  exec<T extends SqlRow = SqlRow>(query: string, ...bindings: unknown[]): SqlCursorLike<T>;
};

type GraphMetaRow = {
  cursor_prefix: string;
  head_cursor: string;
  head_seq: number;
  history_retained_from_seq: number;
  retained_history_policy_kind: string;
  retained_history_policy_max_transactions: number | null;
  schema_version: number;
  seeded_at: string | null;
  updated_at: string;
};

type GraphTxRow = {
  committed_at: string;
  cursor: string;
  seq: number;
  tx_id: string;
  write_scope: GraphWriteScope;
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

export function readAllRows<T extends SqlRow>(cursor: SqlCursorLike<T>): T[] {
  return [...cursor];
}

export function readOneRow<T extends SqlRow>(
  sql: DurableObjectSqlStorageLike,
  query: string,
  ...bindings: unknown[]
): T | null {
  const cursor = sql.exec<T>(query, ...bindings);
  for (const row of cursor) {
    return row;
  }
  return null;
}

export function requireInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Expected "${label}" to be an integer.`);
  }
  return value;
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected "${label}" to be a string.`);
  }
  return value;
}

export function requireWriteScope(value: unknown, label: string): GraphWriteScope {
  if (value === "client-tx" || value === "server-command" || value === "authority-only") {
    return value;
  }
  throw new Error(`Expected "${label}" to be a supported authoritative write scope.`);
}

export function requireNullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requireString(value, label);
}

function formatCursor(cursorPrefix: string, sequence: number): string {
  return `${cursorPrefix}${sequence}`;
}

function createStartupDiagnostics(
  recovery: PersistedAuthoritativeGraphStorageLoadResult["recovery"],
  options: {
    repairReasons?: readonly PersistedAuthoritativeGraphStartupRepairReason[];
    resetReasons?: readonly PersistedAuthoritativeGraphStartupResetReason[];
  } = {},
): PersistedAuthoritativeGraphStartupDiagnostics {
  return {
    recovery,
    repairReasons: [...(options.repairReasons ?? [])],
    resetReasons: [...(options.resetReasons ?? [])],
  };
}

function readRetainedHistoryPolicyRow(
  row: Pick<
    GraphMetaRow,
    "retained_history_policy_kind" | "retained_history_policy_max_transactions"
  >,
  defaultRetainedHistoryPolicy: AuthoritativeGraphRetainedHistoryPolicy,
): {
  retainedHistoryPolicy: AuthoritativeGraphRetainedHistoryPolicy;
  recovery: "none" | "repair";
  repairReasons: readonly PersistedAuthoritativeGraphStartupRepairReason[];
} {
  if (row.retained_history_policy_kind === "all") {
    return {
      retainedHistoryPolicy: {
        kind: "all",
      },
      recovery: "none",
      repairReasons: [],
    };
  }

  if (
    row.retained_history_policy_kind === "transaction-count" &&
    typeof row.retained_history_policy_max_transactions === "number" &&
    Number.isInteger(row.retained_history_policy_max_transactions) &&
    row.retained_history_policy_max_transactions >= 1
  ) {
    return {
      retainedHistoryPolicy: {
        kind: "transaction-count",
        maxTransactions: row.retained_history_policy_max_transactions,
      },
      recovery: "none",
      repairReasons: [],
    };
  }

  return {
    retainedHistoryPolicy: defaultRetainedHistoryPolicy,
    recovery: "repair",
    repairReasons: ["retained-history-policy-normalized"],
  };
}

export function readGraphMetaRow(
  sql: DurableObjectSqlStorageLike,
  defaultRetainedHistoryPolicy: AuthoritativeGraphRetainedHistoryPolicy,
): {
  cursorPrefix: string;
  headCursor: string;
  headSeq: number;
  historyRetainedFromSeq: number;
  retainedHistoryPolicy: AuthoritativeGraphRetainedHistoryPolicy;
  policyRepairReasons: readonly PersistedAuthoritativeGraphStartupRepairReason[];
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
      retained_history_policy_kind,
      retained_history_policy_max_transactions,
      updated_at
    FROM io_graph_meta
    WHERE id = 1`,
  );
  if (!row) return null;
  const retainedHistoryPolicy = readRetainedHistoryPolicyRow(row, defaultRetainedHistoryPolicy);

  return {
    cursorPrefix: requireString(row.cursor_prefix, "io_graph_meta.cursor_prefix"),
    headCursor: requireString(row.head_cursor, "io_graph_meta.head_cursor"),
    headSeq: requireInteger(row.head_seq, "io_graph_meta.head_seq"),
    historyRetainedFromSeq: requireInteger(
      row.history_retained_from_seq,
      "io_graph_meta.history_retained_from_seq",
    ),
    retainedHistoryPolicy: retainedHistoryPolicy.retainedHistoryPolicy,
    policyRepairReasons: retainedHistoryPolicy.repairReasons,
    schemaVersion: requireInteger(row.schema_version, "io_graph_meta.schema_version"),
    seededAt: requireNullableString(row.seeded_at, "io_graph_meta.seeded_at"),
    updatedAt: requireString(row.updated_at, "io_graph_meta.updated_at"),
  };
}

function buildSnapshotFromSql(sql: DurableObjectSqlStorageLike): {
  headSequence: number;
  snapshot: PersistedAuthoritativeGraphStorageLoadResult["snapshot"];
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
  recovery: "repair" | "reset-baseline" | "none";
  startupDiagnostics: PersistedAuthoritativeGraphStartupDiagnostics;
  writeHistory?: PersistedAuthoritativeGraphStorageLoadResult["writeHistory"];
} {
  const transactions = readAllRows<GraphTxRow>(
    sql.exec(
      `SELECT seq, tx_id, cursor, committed_at, write_scope
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
  const results: Array<
    NonNullable<PersistedAuthoritativeGraphStorageLoadResult["writeHistory"]>["results"][number]
  > = [];
  let expectedSequence = baseSequence + 1;
  const resetReasons: PersistedAuthoritativeGraphStartupResetReason[] = [];

  if (!Number.isInteger(baseSequence) || baseSequence < 0) {
    resetReasons.push("retained-history-base-sequence-invalid");
  }

  for (const row of transactions) {
    const seq = requireInteger(row.seq, "io_graph_tx.seq");
    const cursor = requireString(row.cursor, "io_graph_tx.cursor");
    if (seq !== expectedSequence || cursor !== formatCursor(meta.cursorPrefix, seq)) {
      resetReasons.push("retained-history-sequence-mismatch");
      break;
    }

    results.push({
      txId: requireString(row.tx_id, "io_graph_tx.tx_id"),
      cursor,
      replayed: false,
      writeScope: requireWriteScope(row.write_scope, "io_graph_tx.write_scope"),
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

  if (
    resetReasons.length === 0 &&
    results.length > 0 &&
    expectedSequence - 1 !== snapshotHeadSequence
  ) {
    resetReasons.push("retained-history-head-mismatch");
  }

  if (resetReasons.length > 0) {
    return {
      recovery: "reset-baseline",
      startupDiagnostics: createStartupDiagnostics("reset-baseline", { resetReasons }),
    };
  }

  const expectedHeadCursor = formatCursor(meta.cursorPrefix, snapshotHeadSequence);
  const repairReasons: PersistedAuthoritativeGraphStartupRepairReason[] = [
    ...meta.policyRepairReasons,
  ];
  if (meta.headSeq !== snapshotHeadSequence) {
    repairReasons.push("head-sequence-mismatch");
  }
  if (meta.headCursor !== expectedHeadCursor) {
    repairReasons.push("head-cursor-mismatch");
  }
  if (meta.historyRetainedFromSeq !== baseSequence) {
    repairReasons.push("retained-history-boundary-mismatch");
  }

  return {
    recovery: repairReasons.length > 0 ? "repair" : "none",
    startupDiagnostics: createStartupDiagnostics(repairReasons.length > 0 ? "repair" : "none", {
      repairReasons,
    }),
    writeHistory: {
      cursorPrefix: meta.cursorPrefix,
      retainedHistoryPolicy: meta.retainedHistoryPolicy,
      baseSequence,
      results,
    },
  };
}

export function loadPersistedAuthorityState(
  sql: DurableObjectSqlStorageLike,
  options: {
    defaultRetainedHistoryPolicy: AuthoritativeGraphRetainedHistoryPolicy;
    expectedSchemaVersion: number;
  },
): PersistedAuthoritativeGraphStorageLoadResult | null {
  const meta = readGraphMetaRow(sql, options.defaultRetainedHistoryPolicy);
  if (!meta) return null;
  if (meta.schemaVersion !== options.expectedSchemaVersion) {
    throw new Error(
      `Unsupported durable graph schema version ${meta.schemaVersion}. Expected ${options.expectedSchemaVersion}.`,
    );
  }
  const hydratedSnapshot = buildSnapshotFromSql(sql);
  const hydratedHistory = buildWriteHistoryFromSql(sql, meta, hydratedSnapshot.headSequence);

  return {
    snapshot: hydratedSnapshot.snapshot,
    writeHistory: hydratedHistory.writeHistory,
    recovery: hydratedHistory.recovery,
    startupDiagnostics: hydratedHistory.startupDiagnostics,
  };
}
