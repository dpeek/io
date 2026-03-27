import { type GraphStoreSnapshot } from "@io/app/graph";

import type {
  WebAppAuthoritySecretInventoryRecord,
  WebAppAuthoritySecretLoadOptions,
  WebAppAuthoritySecretRecord,
  WebAppAuthoritySecretWrite,
} from "./authority.js";
import { collectLiveSecretIds } from "./authority.js";
import {
  readAllRows,
  requireInteger,
  requireNullableString,
  requireString,
  type DurableObjectSqlStorageLike,
} from "./graph-authority-sql-startup.js";

type SecretValueRow = {
  external_key_id: string | null;
  fingerprint: string | null;
  provider: string | null;
  secret_id: string;
  stored_at: string;
  value: string;
  version: number;
};

export function readSecretsFromSql(
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

export function readSecretInventoryFromSql(
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

export function upsertSecretValue(
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

export function pruneSecretValueRows(
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

export function pruneOrphanedSecretValues(
  sql: DurableObjectSqlStorageLike,
  snapshot: GraphStoreSnapshot,
): void {
  pruneSecretValueRows(sql, collectLiveSecretIds(snapshot));
}

export function bootstrapSecretValueTable(sql: DurableObjectSqlStorageLike): void {
  sql.exec(
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
}
