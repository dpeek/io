import {
  isAuthoritativeGraphRetainedHistoryPolicy,
  type AuthoritativeGraphRetainedHistoryPolicy,
  type AuthoritativeWriteScope,
  type PersistedAuthoritativeGraphStorageCommitInput as DurableAuthorityCommitInput,
  type PersistedAuthoritativeGraphStorageLoadResult as DurableAuthorityLoadResult,
  type PersistedAuthoritativeGraphStoragePersistInput as DurableAuthorityPersistInput,
  type PersistedAuthoritativeGraphStartupDiagnostics,
  type PersistedAuthoritativeGraphStartupRepairReason,
  type PersistedAuthoritativeGraphStartupResetReason,
} from "@io/core/graph";

import {
  isBearerShareTokenHash,
  type BearerShareLookupInput,
  type SessionPrincipalLookupInput,
} from "./auth-bridge.js";
import type {
  WebAppAuthoritySecretInventoryRecord,
  WebAppAuthoritySecretLoadOptions,
  WebAppAuthority,
  WebAppAuthorityOptions,
  WebAppAuthoritySecretRecord,
  WebAppAuthoritySecretRepairInput,
  WebAppAuthoritySecretWrite,
  WebAppAuthorityStorage,
} from "./authority.js";
import {
  collectLiveSecretIds,
  createWebAppAuthority,
  WebAppAuthorityBearerShareLookupError,
  WebAppAuthoritySessionPrincipalLookupError,
} from "./authority.js";
import {
  handleWorkflowLiveRequest,
  handleWorkflowReadRequest,
  handleWebCommandRequest,
  RequestAuthorizationContextError,
  handleSyncRequest,
  handleTransactionRequest,
  readRequestAuthorizationContext,
} from "./server-routes.js";
import { createWorkflowReviewLiveScopeRouter } from "./workflow-live-scope-router.js";
import { webWorkflowLivePath } from "./workflow-live-transport.js";
import { webWorkflowReadPath } from "./workflow-transport.js";

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
  GRAPH_AUTHORITY_RETAINED_HISTORY_POLICY?: AuthoritativeGraphRetainedHistoryPolicy | string;
};

// These row shapes are internal to the current SQLite-backed Durable Object
// adapter. They intentionally do not widen the stable graph/runtime persisted
// authority contract.
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
  write_scope: AuthoritativeWriteScope;
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
export const webGraphAuthorityBearerShareLookupPath = "/_internal/bearer-share";
const defaultRetainedHistoryPolicy = {
  kind: "transaction-count",
  maxTransactions: defaultMaxRetainedTransactions,
} as const satisfies AuthoritativeGraphRetainedHistoryPolicy;
export const webGraphAuthoritySessionPrincipalLookupPath = "/_internal/session-principal";

type WebGraphAuthorityFactory = (
  storage: WebAppAuthorityStorage,
  options: WebAppAuthorityOptions,
) => Promise<WebAppAuthority>;

function formatCursor(cursorPrefix: string, sequence: number): string {
  return `${cursorPrefix}${sequence}`;
}

function createStartupDiagnostics(
  recovery: DurableAuthorityLoadResult["recovery"],
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

function readRetainedHistoryPolicy(
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

function readAllRows<T extends SqlRow>(cursor: SqlCursorLike<T>): T[] {
  return [...cursor];
}

function readOneRow<T extends SqlRow>(
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

function requireWriteScope(value: unknown, label: string): AuthoritativeWriteScope {
  if (value === "client-tx" || value === "server-command" || value === "authority-only") {
    return value;
  }
  throw new Error(`Expected "${label}" to be a supported authoritative write scope.`);
}

function requireNullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requireString(value, label);
}

function readRetainedHistoryPolicyRow(
  row: Pick<
    GraphMetaRow,
    "retained_history_policy_kind" | "retained_history_policy_max_transactions"
  >,
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

class SessionPrincipalLookupRequestError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "SessionPrincipalLookupRequestError";
  }
}

class BearerShareLookupRequestError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "BearerShareLookupRequestError";
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function requireNonEmptyRequestString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SessionPrincipalLookupRequestError(
      `Session principal lookup request must include a non-empty "${label}" string.`,
    );
  }

  return value;
}

function requireNonEmptyBearerShareRequestString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BearerShareLookupRequestError(
      `Bearer share lookup request must include a non-empty "${label}" string.`,
    );
  }

  return value;
}

async function readSessionPrincipalLookupInput(
  request: Request,
): Promise<SessionPrincipalLookupInput> {
  let decoded: unknown;
  try {
    decoded = await request.json();
  } catch {
    throw new SessionPrincipalLookupRequestError(
      "Session principal lookup request must be valid JSON.",
    );
  }

  if (!isObjectRecord(decoded)) {
    throw new SessionPrincipalLookupRequestError(
      "Session principal lookup request must be a JSON object.",
    );
  }

  const subject = decoded.subject;
  if (!isObjectRecord(subject)) {
    throw new SessionPrincipalLookupRequestError(
      'Session principal lookup request must include an object "subject".',
    );
  }

  return {
    graphId: requireNonEmptyRequestString(decoded.graphId, "graphId"),
    subject: {
      issuer: requireNonEmptyRequestString(subject.issuer, "subject.issuer"),
      provider: requireNonEmptyRequestString(subject.provider, "subject.provider"),
      providerAccountId: requireNonEmptyRequestString(
        subject.providerAccountId,
        "subject.providerAccountId",
      ),
      authUserId: requireNonEmptyRequestString(subject.authUserId, "subject.authUserId"),
    },
  };
}

async function readBearerShareLookupInput(request: Request): Promise<BearerShareLookupInput> {
  let decoded: unknown;
  try {
    decoded = await request.json();
  } catch {
    throw new BearerShareLookupRequestError("Bearer share lookup request must be valid JSON.");
  }

  if (!isObjectRecord(decoded)) {
    throw new BearerShareLookupRequestError("Bearer share lookup request must be a JSON object.");
  }

  const tokenHash = requireNonEmptyBearerShareRequestString(decoded.tokenHash, "tokenHash");
  if (!isBearerShareTokenHash(tokenHash)) {
    throw new BearerShareLookupRequestError(
      "Bearer share lookup request must include a sha256:<64 lowercase hex chars> tokenHash.",
    );
  }

  return {
    graphId: requireNonEmptyBearerShareRequestString(decoded.graphId, "graphId"),
    tokenHash,
  };
}

function readGraphMetaRow(sql: DurableObjectSqlStorageLike): {
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
  const retainedHistoryPolicy = readRetainedHistoryPolicyRow(row);

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
  recovery: "repair" | "reset-baseline" | "none";
  startupDiagnostics: PersistedAuthoritativeGraphStartupDiagnostics;
  writeHistory?: DurableAuthorityLoadResult["writeHistory"];
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
  const results: Array<NonNullable<DurableAuthorityLoadResult["writeHistory"]>["results"][number]> =
    [];
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

function readSecretsFromSql(
  sql: DurableObjectSqlStorageLike,
  options?: WebAppAuthoritySecretLoadOptions,
): Record<string, WebAppAuthoritySecretRecord> {
  const secretIds = options?.secretIds;
  if (secretIds?.length === 0) {
    return {};
  }

  const query =
    secretIds && secretIds.length > 0
      ? `SELECT secret_id, value, version, stored_at, provider, fingerprint, external_key_id
        FROM io_secret_value
        WHERE secret_id IN (${secretIds.map(() => "?").join(", ")})
        ORDER BY secret_id ASC`
      : `SELECT secret_id, value, version, stored_at, provider, fingerprint, external_key_id
        FROM io_secret_value
        ORDER BY secret_id ASC`;

  return Object.fromEntries(
    readAllRows<SecretValueRow>(sql.exec(query, ...(secretIds ?? []))).map((row) => [
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

function readSecretInventoryFromSql(
  sql: DurableObjectSqlStorageLike,
): Record<string, WebAppAuthoritySecretInventoryRecord> {
  return Object.fromEntries(
    readAllRows<Pick<SecretValueRow, "secret_id" | "version">>(
      sql.exec(
        `SELECT secret_id, version
        FROM io_secret_value
        ORDER BY secret_id ASC`,
      ),
    ).map((row) => [
      requireString(row.secret_id, "io_secret_value.secret_id"),
      {
        version: requireInteger(row.version, "io_secret_value.version"),
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

function pruneSecretValueRows(
  sql: DurableObjectSqlStorageLike,
  liveSecretIds: readonly string[],
): void {
  if (liveSecretIds.length === 0) {
    sql.exec("DELETE FROM io_secret_value");
    return;
  }

  const placeholders = liveSecretIds.map(() => "?").join(", ");
  sql.exec(
    `DELETE FROM io_secret_value
    WHERE secret_id NOT IN (${placeholders})`,
    ...liveSecretIds,
  );
}

function pruneOrphanedSecretValues(
  sql: DurableObjectSqlStorageLike,
  snapshot: DurableAuthorityPersistInput["snapshot"],
): void {
  pruneSecretValueRows(sql, collectLiveSecretIds(snapshot));
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
): void {
  if (input.result.replayed) return;

  const now = new Date().toISOString();
  const existingMeta = readGraphMetaRow(sql);
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

function createSqliteDurableObjectAuthorityStorage(
  state: DurableObjectStateLike,
): WebAppAuthorityStorage {
  // SQLite rows plus Durable Object transaction wiring are provisional adapter
  // details that reconstruct the shared persisted-authority state at load time.
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
        recovery: hydratedHistory.recovery,
        startupDiagnostics: hydratedHistory.startupDiagnostics,
      };
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
    // Legacy SQL rows never recorded authoritative origin. Backfilling the new
    // column as client-tx keeps restart compatibility explicit without
    // implying that pre-migration history can recover lost scope fidelity.
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
  private readonly retainedHistoryPolicy: AuthoritativeGraphRetainedHistoryPolicy;
  private readonly createAuthority: WebGraphAuthorityFactory;
  private readonly workflowReviewLiveScopeRouter = createWorkflowReviewLiveScopeRouter();
  private authorityPromise: Promise<WebAppAuthority> | null = null;

  constructor(
    state: DurableObjectStateLike,
    env: DurableObjectEnvLike = {},
    options: {
      createAuthority?: WebGraphAuthorityFactory;
    } = {},
  ) {
    this.state = state;
    this.retainedHistoryPolicy = readRetainedHistoryPolicy(env);
    this.createAuthority = options.createAuthority ?? createWebAppAuthority;
    bootstrapDurableObjectAuthoritySchema(this.state.storage);
  }

  private getAuthority(): Promise<WebAppAuthority> {
    if (this.authorityPromise) return this.authorityPromise;

    const pending = this.state
      .blockConcurrencyWhile(() =>
        this.createAuthority(createSqliteDurableObjectAuthorityStorage(this.state), {
          retainedHistoryPolicy: this.retainedHistoryPolicy,
          onWorkflowReviewInvalidation: (invalidation) => {
            this.workflowReviewLiveScopeRouter.publish(invalidation);
          },
        }),
      )
      .catch((error) => {
        this.authorityPromise = null;
        throw error;
      });

    this.authorityPromise = pending;
    return pending;
  }

  private async handleSessionPrincipalLookupRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { allow: "POST" },
      });
    }

    let input: SessionPrincipalLookupInput;
    try {
      input = await readSessionPrincipalLookupInput(request);
    } catch (error) {
      if (error instanceof SessionPrincipalLookupRequestError) {
        return Response.json(
          { error: error.message },
          {
            status: error.status,
            headers: {
              "cache-control": "no-store",
            },
          },
        );
      }
      throw error;
    }

    try {
      const authority = await this.getAuthority();
      return Response.json(await authority.lookupSessionPrincipal(input), {
        headers: {
          "cache-control": "no-store",
        },
      });
    } catch (error) {
      if (error instanceof WebAppAuthoritySessionPrincipalLookupError) {
        return Response.json(
          {
            error: error.message,
            code: error.code,
          },
          {
            status: error.status,
            headers: {
              "cache-control": "no-store",
            },
          },
        );
      }
      throw error;
    }
  }

  private async handleBearerShareLookupRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { allow: "POST" },
      });
    }

    let input: BearerShareLookupInput;
    try {
      input = await readBearerShareLookupInput(request);
    } catch (error) {
      if (error instanceof BearerShareLookupRequestError) {
        return Response.json(
          { error: error.message },
          {
            status: error.status,
            headers: {
              "cache-control": "no-store",
            },
          },
        );
      }
      throw error;
    }

    try {
      const authority = await this.getAuthority();
      return Response.json(await authority.lookupBearerShare(input), {
        headers: {
          "cache-control": "no-store",
        },
      });
    } catch (error) {
      if (error instanceof WebAppAuthorityBearerShareLookupError) {
        return Response.json(
          {
            error: error.message,
            code: error.code,
          },
          {
            status: error.status,
            headers: {
              "cache-control": "no-store",
            },
          },
        );
      }
      throw error;
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === webGraphAuthorityBearerShareLookupPath) {
      return this.state.blockConcurrencyWhile(() => this.handleBearerShareLookupRequest(request));
    }

    if (url.pathname === webGraphAuthoritySessionPrincipalLookupPath) {
      return this.state.blockConcurrencyWhile(() =>
        this.handleSessionPrincipalLookupRequest(request),
      );
    }

    if (
      url.pathname !== "/api/sync" &&
      url.pathname !== "/api/tx" &&
      url.pathname !== "/api/commands" &&
      url.pathname !== webWorkflowLivePath &&
      url.pathname !== webWorkflowReadPath
    ) {
      return new Response("Not Found", { status: 404 });
    }

    let authorization;
    try {
      authorization = readRequestAuthorizationContext(request);
    } catch (error) {
      if (error instanceof RequestAuthorizationContextError) {
        return Response.json(
          { error: error.message },
          {
            status: error.status,
            headers: {
              "cache-control": "no-store",
            },
          },
        );
      }
      throw error;
    }

    const authority = await this.getAuthority();

    if (url.pathname === "/api/sync") {
      return handleSyncRequest(request, authority, authorization);
    }

    if (url.pathname === "/api/tx") {
      return handleTransactionRequest(request, authority, authorization);
    }

    if (url.pathname === "/api/commands") {
      return handleWebCommandRequest(request, authority, authorization);
    }

    if (url.pathname === webWorkflowLivePath) {
      return handleWorkflowLiveRequest(
        request,
        authority,
        this.workflowReviewLiveScopeRouter,
        authorization,
      );
    }

    if (url.pathname === webWorkflowReadPath) {
      return handleWorkflowReadRequest(request, authority, authorization);
    }

    return new Response("Not Found", { status: 404 });
  }
}
