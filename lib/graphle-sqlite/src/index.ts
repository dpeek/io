import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

import { Database } from "bun:sqlite";

export const graphleSqliteSchemaVersion = 1;
export const graphleSqliteMetaTable = "graphle_meta";
export const graphleSqliteSchemaVersionKey = "schema_version";

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

type SchemaVersionRow = {
  readonly value: string;
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
