import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

import {
  createPersistedAuthoritativeGraph,
  persistedAuthoritativeGraphStateVersion,
  validateAuthoritativeTotalSyncPayload,
  type PersistedAuthoritativeGraph,
  type PersistedAuthoritativeGraphCursorPrefixFactory,
  type PersistedAuthoritativeGraphRetainedRecord,
  type PersistedAuthoritativeGraphSeed,
  type PersistedAuthoritativeGraphStartupDiagnostics,
  type PersistedAuthoritativeGraphStorage,
  type PersistedAuthoritativeGraphStorageCommitInput,
  type PersistedAuthoritativeGraphStorageLoadResult,
  type PersistedAuthoritativeGraphStoragePersistInput,
  type PersistedAuthoritativeGraphState,
} from "@dpeek/graphle-authority";
import {
  isAuthoritativeGraphRetainedHistoryPolicy,
  type AnyTypeOutput,
  type AuthoritativeGraphRetainedHistoryPolicy,
  type AuthoritativeGraphWriteHistory,
  type AuthoritativeGraphWriteResult,
  type GraphStore,
  type GraphStoreSnapshot,
  unboundedAuthoritativeGraphRetainedHistoryPolicy,
} from "@dpeek/graphle-kernel";
import { graphSyncScope, type TotalSyncPayload } from "@dpeek/graphle-sync";
import { Database } from "bun:sqlite";

export const graphleSqliteSchemaVersion = 2;
export const graphleSqliteMetaTable = "graphle_meta";
export const graphleSqliteSchemaVersionKey = "schema_version";
export const graphleSqliteAuthorityStateTable = "graphle_authority_state";
export const graphleSqliteAuthorityCommitTable = "graphle_authority_commit";

export interface GraphleSqliteHealth {
  readonly path: string;
  readonly opened: boolean;
  readonly metaTableReady: boolean;
  readonly schemaVersion: number;
}

export interface GraphleSqliteHandle {
  readonly path: string;
  readonly database: Database;
  health(): GraphleSqliteHealth;
  close(): void;
}

export interface OpenGraphleSqliteOptions {
  readonly path: string;
}

export interface GraphleSqlitePersistedAuthorityStorageOptions<
  TDefinitions extends Record<string, AnyTypeOutput> = Record<string, AnyTypeOutput>,
> {
  readonly handle: GraphleSqliteHandle;
  readonly authorityId?: string;
  readonly definitions?: TDefinitions;
}

export interface GraphleSqlitePersistedAuthorityOptions<
  TNamespace extends Record<string, AnyTypeOutput>,
  TDefinitions extends Record<string, AnyTypeOutput> = TNamespace,
> extends GraphleSqlitePersistedAuthorityStorageOptions<TDefinitions> {
  readonly definitions?: TDefinitions;
  readonly seed?: PersistedAuthoritativeGraphSeed<TNamespace, TDefinitions>;
  readonly createCursorPrefix?: PersistedAuthoritativeGraphCursorPrefixFactory;
  readonly retainedHistoryPolicy?: AuthoritativeGraphRetainedHistoryPolicy;
}

type SchemaVersionRow = {
  readonly value: string;
};

type AuthorityStateRow = {
  readonly state_json: string;
};

type AuthorityCommitRow = {
  readonly cursor: string;
  readonly result_json: string;
};

function assertAbsolutePath(path: string): void {
  if (!isAbsolute(path)) {
    throw new Error(`Graphle SQLite path must be absolute: ${path}`);
  }
}

function initializeGraphleSqlite(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS graphle_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS graphle_authority_state (
      authority_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS graphle_authority_commit (
      authority_id TEXT NOT NULL,
      tx_id TEXT NOT NULL,
      cursor TEXT NOT NULL,
      transaction_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (authority_id, tx_id)
    );
  `);
  database
    .query(
      `
        INSERT INTO graphle_meta (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = CURRENT_TIMESTAMP
      `,
    )
    .run(graphleSqliteSchemaVersionKey, String(graphleSqliteSchemaVersion));
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function validatePersistedSnapshot(
  snapshot: GraphStoreSnapshot,
  source: string,
  definitions?: Record<string, AnyTypeOutput>,
): GraphStoreSnapshot {
  if (!definitions) return snapshot;

  const validation = validateAuthoritativeTotalSyncPayload(
    {
      mode: "total",
      scope: graphSyncScope,
      snapshot,
      cursor: "persisted:sqlite",
      completeness: "complete",
      freshness: "current",
    } satisfies TotalSyncPayload,
    definitions,
  );
  if (validation.ok) return snapshot;

  const messages = validation.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "snapshot";
    return `${path}: ${issue.message}`;
  });
  throw new Error(`Invalid SQLite authority snapshot in "${source}": ${messages.join(" | ")}`);
}

function readPersistedWriteHistory(rawHistory: unknown): {
  readonly writeHistory?: AuthoritativeGraphWriteHistory;
  readonly recovery: "none" | "repair";
  readonly startupDiagnostics: PersistedAuthoritativeGraphStartupDiagnostics;
} {
  if (!isObjectRecord(rawHistory)) {
    return {
      recovery: "none",
      startupDiagnostics: {
        recovery: "none",
        repairReasons: [],
        resetReasons: [],
      },
    };
  }

  const cursorPrefix = rawHistory.cursorPrefix;
  const baseSequence = rawHistory.baseSequence;
  const results = rawHistory.results;
  if (
    typeof cursorPrefix !== "string" ||
    typeof baseSequence !== "number" ||
    !Number.isInteger(baseSequence) ||
    baseSequence < 0 ||
    !Array.isArray(results)
  ) {
    return {
      recovery: "none",
      startupDiagnostics: {
        recovery: "none",
        repairReasons: [],
        resetReasons: [],
      },
    };
  }

  const retainedHistoryPolicy = rawHistory.retainedHistoryPolicy;
  const normalizedRetainedHistoryPolicy: AuthoritativeGraphRetainedHistoryPolicy =
    isAuthoritativeGraphRetainedHistoryPolicy(retainedHistoryPolicy)
      ? retainedHistoryPolicy
      : unboundedAuthoritativeGraphRetainedHistoryPolicy;
  const repairReasons = [
    ...(retainedHistoryPolicy === undefined ||
    !isAuthoritativeGraphRetainedHistoryPolicy(retainedHistoryPolicy)
      ? (["retained-history-policy-normalized"] as const)
      : []),
    ...(results.some((result) => isObjectRecord(result) && !("writeScope" in result))
      ? (["write-history-write-scope-normalized"] as const)
      : []),
  ];

  return {
    writeHistory: {
      cursorPrefix,
      retainedHistoryPolicy: normalizedRetainedHistoryPolicy,
      baseSequence,
      results: results as AuthoritativeGraphWriteResult[],
    },
    recovery: repairReasons.length > 0 ? "repair" : "none",
    startupDiagnostics: {
      recovery: repairReasons.length > 0 ? "repair" : "none",
      repairReasons,
      resetReasons: [],
    },
  };
}

function readPersistedRetainedRecords(
  rawRecords: unknown,
  source: string,
): readonly PersistedAuthoritativeGraphRetainedRecord[] | undefined {
  if (rawRecords === undefined) return undefined;
  if (!Array.isArray(rawRecords)) {
    throw new Error(`Invalid SQLite retained records in "${source}": expected an array.`);
  }

  return rawRecords.map((rawRecord, index) => {
    if (!isObjectRecord(rawRecord)) {
      throw new Error(
        `Invalid SQLite retained records in "${source}": expected entry ${index} to be an object.`,
      );
    }
    if (typeof rawRecord.recordKind !== "string") {
      throw new Error(
        `Invalid SQLite retained records in "${source}": expected entry ${index}.recordKind to be a string.`,
      );
    }
    if (typeof rawRecord.recordId !== "string") {
      throw new Error(
        `Invalid SQLite retained records in "${source}": expected entry ${index}.recordId to be a string.`,
      );
    }
    if (
      typeof rawRecord.version !== "number" ||
      !Number.isInteger(rawRecord.version) ||
      rawRecord.version < 0
    ) {
      throw new Error(
        `Invalid SQLite retained records in "${source}": expected entry ${index}.version to be a non-negative integer.`,
      );
    }
    if (!("payload" in rawRecord)) {
      throw new Error(
        `Invalid SQLite retained records in "${source}": expected entry ${index}.payload to be present.`,
      );
    }

    return {
      recordKind: rawRecord.recordKind,
      recordId: rawRecord.recordId,
      version: rawRecord.version,
      payload: rawRecord.payload,
    };
  });
}

function readCommitRowsDiagnostics(
  database: Database,
  authorityId: string,
  writeHistory: AuthoritativeGraphWriteHistory,
): PersistedAuthoritativeGraphStartupDiagnostics | undefined {
  const rows = database
    .query<AuthorityCommitRow, [string]>(
      `
        SELECT cursor, result_json
        FROM graphle_authority_commit
        WHERE authority_id = ?
        ORDER BY created_at ASC, cursor ASC
      `,
    )
    .all(authorityId);
  if (rows.length === 0 || rows.length === writeHistory.results.length) return undefined;

  return {
    recovery: "repair",
    repairReasons: ["head-sequence-mismatch"],
    resetReasons: [],
  };
}

function parsePersistedState(
  stateJson: string,
  source: string,
  definitions?: Record<string, AnyTypeOutput>,
): PersistedAuthoritativeGraphStorageLoadResult {
  const parsed = JSON.parse(stateJson) as unknown;
  if (!isObjectRecord(parsed)) {
    throw new Error(`Invalid SQLite authority state in "${source}": expected an object.`);
  }

  if (parsed.version !== persistedAuthoritativeGraphStateVersion || !("snapshot" in parsed)) {
    return {
      snapshot: validatePersistedSnapshot(parsed as GraphStoreSnapshot, source, definitions),
      recovery: "reset-baseline",
      startupDiagnostics: {
        recovery: "reset-baseline",
        repairReasons: [],
        resetReasons: ["missing-write-history"],
      },
    };
  }

  const snapshot = validatePersistedSnapshot(
    parsed.snapshot as GraphStoreSnapshot,
    source,
    definitions,
  );
  const retainedRecords = readPersistedRetainedRecords(parsed.retainedRecords, source);
  const persistedWriteHistory = readPersistedWriteHistory(parsed.writeHistory);
  if (!persistedWriteHistory.writeHistory) {
    return {
      snapshot,
      retainedRecords,
      recovery: "reset-baseline",
      startupDiagnostics: {
        recovery: "reset-baseline",
        repairReasons: [],
        resetReasons: ["missing-write-history"],
      },
    };
  }

  return {
    snapshot,
    writeHistory: persistedWriteHistory.writeHistory,
    retainedRecords,
    recovery: persistedWriteHistory.recovery,
    startupDiagnostics: persistedWriteHistory.startupDiagnostics,
  };
}

export function readGraphleSqliteHealth(database: Database, path: string): GraphleSqliteHealth {
  const row = database
    .query<SchemaVersionRow, [string]>("SELECT value FROM graphle_meta WHERE key = ?")
    .get(graphleSqliteSchemaVersionKey);
  const schemaVersion = Number.parseInt(row?.value ?? "", 10);

  return {
    path,
    opened: true,
    metaTableReady: row !== null && row !== undefined,
    schemaVersion: Number.isInteger(schemaVersion) ? schemaVersion : 0,
  };
}

export async function openGraphleSqlite({
  path,
}: OpenGraphleSqliteOptions): Promise<GraphleSqliteHandle> {
  assertAbsolutePath(path);
  await mkdir(dirname(path), { recursive: true });

  const database = new Database(path, {
    create: true,
    readwrite: true,
  });

  try {
    initializeGraphleSqlite(database);
  } catch (error) {
    database.close();
    throw error;
  }

  return {
    path,
    database,
    health() {
      return readGraphleSqliteHealth(database, path);
    },
    close() {
      database.close();
    },
  };
}

export function createGraphleSqlitePersistedAuthoritativeGraphStorage<
  const TDefinitions extends Record<string, AnyTypeOutput>,
>({
  handle,
  authorityId = "default",
  definitions,
}: GraphleSqlitePersistedAuthorityStorageOptions<TDefinitions>): PersistedAuthoritativeGraphStorage {
  const source = `${handle.path}#${authorityId}`;

  function buildState({
    snapshot,
    writeHistory,
    retainedRecords,
  }: PersistedAuthoritativeGraphStoragePersistInput): PersistedAuthoritativeGraphState {
    return {
      version: persistedAuthoritativeGraphStateVersion,
      snapshot,
      writeHistory,
      ...(retainedRecords ? { retainedRecords } : {}),
    };
  }

  function writeState(input: PersistedAuthoritativeGraphStoragePersistInput): void {
    const state = buildState(input);
    handle.database
      .query(
        `
          INSERT INTO graphle_authority_state (authority_id, state_json, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(authority_id) DO UPDATE SET
            state_json = excluded.state_json,
            updated_at = CURRENT_TIMESTAMP
        `,
      )
      .run(authorityId, JSON.stringify(state));
  }

  function insertCommitRow(result: AuthoritativeGraphWriteResult): void {
    handle.database
      .query(
        `
          INSERT INTO graphle_authority_commit (
            authority_id,
            tx_id,
            cursor,
            transaction_json,
            result_json,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(authority_id, tx_id) DO UPDATE SET
            cursor = excluded.cursor,
            transaction_json = excluded.transaction_json,
            result_json = excluded.result_json
        `,
      )
      .run(
        authorityId,
        result.txId,
        result.cursor,
        JSON.stringify(result.transaction),
        JSON.stringify(result),
      );
  }

  function runAtomic(write: () => void): void {
    handle.database.exec("BEGIN IMMEDIATE");
    try {
      write();
      handle.database.exec("COMMIT");
    } catch (error) {
      handle.database.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    async load(): Promise<PersistedAuthoritativeGraphStorageLoadResult | null> {
      const row = handle.database
        .query<AuthorityStateRow, [string]>(
          "SELECT state_json FROM graphle_authority_state WHERE authority_id = ?",
        )
        .get(authorityId);
      if (!row) return null;

      const result = parsePersistedState(row.state_json, source, definitions);
      if (!result.writeHistory) return result;

      const commitDiagnostics = readCommitRowsDiagnostics(
        handle.database,
        authorityId,
        result.writeHistory,
      );
      if (!commitDiagnostics) return result;
      if (result.startupDiagnostics.recovery !== "none") return result;

      return {
        ...result,
        recovery: commitDiagnostics.recovery,
        startupDiagnostics: commitDiagnostics,
      };
    },
    async commit(input: PersistedAuthoritativeGraphStorageCommitInput): Promise<void> {
      runAtomic(() => {
        writeState(input);
        insertCommitRow(input.result);
      });
    },
    async persist(input: PersistedAuthoritativeGraphStoragePersistInput): Promise<void> {
      runAtomic(() => {
        writeState(input);
        handle.database
          .query("DELETE FROM graphle_authority_commit WHERE authority_id = ?")
          .run(authorityId);
        for (const result of input.writeHistory.results) insertCommitRow(result);
      });
    },
  };
}

export async function createGraphleSqlitePersistedAuthoritativeGraph<
  const TNamespace extends Record<string, AnyTypeOutput>,
  const TDefinitions extends Record<string, AnyTypeOutput> = TNamespace,
>(
  store: GraphStore,
  namespace: TNamespace,
  options: GraphleSqlitePersistedAuthorityOptions<TNamespace, TDefinitions>,
): Promise<PersistedAuthoritativeGraph<TNamespace, TDefinitions>> {
  const definitions = (options.definitions ?? namespace) as TDefinitions;
  return createPersistedAuthoritativeGraph(store, namespace, {
    definitions,
    storage: createGraphleSqlitePersistedAuthoritativeGraphStorage({
      handle: options.handle,
      authorityId: options.authorityId,
      definitions,
    }),
    seed: options.seed,
    createCursorPrefix: options.createCursorPrefix,
    retainedHistoryPolicy: options.retainedHistoryPolicy,
  });
}
