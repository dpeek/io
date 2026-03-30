import { validateSerializedQueryRequest, type QueryLiteral } from "@io/graph-client";

import type { SavedQueryRecord, SavedViewRecord } from "./saved-query.js";
import {
  readAllRows,
  readOneRow,
  requireString,
  type DurableObjectSqlStorageLike,
} from "./graph-authority-sql-startup.js";

type SavedQuerySqlRow = {
  readonly catalog_id: string;
  readonly catalog_version: string;
  readonly name: string;
  readonly owner_id: string;
  readonly parameter_definitions_json: string;
  readonly query_id: string;
  readonly request_json: string;
  readonly surface_id: string;
  readonly surface_version: string;
  readonly updated_at: string;
};

type SavedViewSqlRow = {
  readonly catalog_id: string;
  readonly catalog_version: string;
  readonly name: string;
  readonly owner_id: string;
  readonly query_id: string;
  readonly spec_json: string;
  readonly surface_id: string;
  readonly surface_version: string;
  readonly updated_at: string;
  readonly view_id: string;
};

export function bootstrapSavedQueryTables(sql: DurableObjectSqlStorageLike): void {
  sql.exec(
    `CREATE TABLE IF NOT EXISTS io_saved_query (
      owner_id TEXT NOT NULL,
      query_id TEXT NOT NULL,
      catalog_id TEXT NOT NULL,
      catalog_version TEXT NOT NULL,
      name TEXT NOT NULL,
      parameter_definitions_json TEXT NOT NULL,
      request_json TEXT NOT NULL,
      surface_id TEXT NOT NULL,
      surface_version TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_id, query_id)
    )`,
  );
  sql.exec(
    `CREATE TABLE IF NOT EXISTS io_saved_view (
      owner_id TEXT NOT NULL,
      view_id TEXT NOT NULL,
      catalog_id TEXT NOT NULL,
      catalog_version TEXT NOT NULL,
      name TEXT NOT NULL,
      query_id TEXT NOT NULL,
      spec_json TEXT NOT NULL,
      surface_id TEXT NOT NULL,
      surface_version TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_id, view_id)
    )`,
  );
  sql.exec(
    `CREATE INDEX IF NOT EXISTS io_saved_query_owner_updated_idx
    ON io_saved_query (owner_id, updated_at DESC, name ASC)`,
  );
  sql.exec(
    `CREATE INDEX IF NOT EXISTS io_saved_view_owner_updated_idx
    ON io_saved_view (owner_id, updated_at DESC, name ASC)`,
  );
  sql.exec(
    `CREATE INDEX IF NOT EXISTS io_saved_view_owner_query_idx
    ON io_saved_view (owner_id, query_id)`,
  );
}

export function readSavedQueryFromSql(
  sql: DurableObjectSqlStorageLike,
  ownerId: string,
  queryId: string,
): SavedQueryRecord | undefined {
  const row = readOneRow<SavedQuerySqlRow>(
    sql,
    `SELECT owner_id, query_id, catalog_id, catalog_version, name,
        parameter_definitions_json, request_json, surface_id, surface_version, updated_at
      FROM io_saved_query
      WHERE owner_id = ? AND query_id = ?`,
    ownerId,
    queryId,
  );
  return row ? mapSavedQueryRow(row) : undefined;
}

export function readSavedViewFromSql(
  sql: DurableObjectSqlStorageLike,
  ownerId: string,
  viewId: string,
): SavedViewRecord | undefined {
  const row = readOneRow<SavedViewSqlRow>(
    sql,
    `SELECT owner_id, view_id, catalog_id, catalog_version, name, query_id,
        spec_json, surface_id, surface_version, updated_at
      FROM io_saved_view
      WHERE owner_id = ? AND view_id = ?`,
    ownerId,
    viewId,
  );
  return row ? mapSavedViewRow(row) : undefined;
}

export function readSavedQueriesFromSql(
  sql: DurableObjectSqlStorageLike,
  ownerId: string,
): readonly SavedQueryRecord[] {
  return readAllRows<SavedQuerySqlRow>(
    sql.exec(
      `SELECT owner_id, query_id, catalog_id, catalog_version, name,
          parameter_definitions_json, request_json, surface_id, surface_version, updated_at
        FROM io_saved_query
        WHERE owner_id = ?
        ORDER BY updated_at DESC, name ASC`,
      ownerId,
    ),
  ).map(mapSavedQueryRow);
}

export function readSavedViewsFromSql(
  sql: DurableObjectSqlStorageLike,
  ownerId: string,
): readonly SavedViewRecord[] {
  return readAllRows<SavedViewSqlRow>(
    sql.exec(
      `SELECT owner_id, view_id, catalog_id, catalog_version, name, query_id,
          spec_json, surface_id, surface_version, updated_at
        FROM io_saved_view
        WHERE owner_id = ?
        ORDER BY updated_at DESC, name ASC`,
      ownerId,
    ),
  ).map(mapSavedViewRow);
}

export function upsertSavedQueryRow(
  sql: DurableObjectSqlStorageLike,
  ownerId: string,
  query: SavedQueryRecord,
): void {
  sql.exec(
    `INSERT INTO io_saved_query (
      owner_id,
      query_id,
      catalog_id,
      catalog_version,
      name,
      parameter_definitions_json,
      request_json,
      surface_id,
      surface_version,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, query_id) DO UPDATE SET
      catalog_id = excluded.catalog_id,
      catalog_version = excluded.catalog_version,
      name = excluded.name,
      parameter_definitions_json = excluded.parameter_definitions_json,
      request_json = excluded.request_json,
      surface_id = excluded.surface_id,
      surface_version = excluded.surface_version,
      updated_at = excluded.updated_at`,
    ownerId,
    query.id,
    query.catalogId,
    query.catalogVersion,
    query.name,
    JSON.stringify(query.parameterDefinitions),
    JSON.stringify(query.request),
    query.surfaceId,
    query.surfaceVersion,
    query.updatedAt,
  );
}

export function upsertSavedViewRow(
  sql: DurableObjectSqlStorageLike,
  ownerId: string,
  view: SavedViewRecord,
): void {
  sql.exec(
    `INSERT INTO io_saved_view (
      owner_id,
      view_id,
      catalog_id,
      catalog_version,
      name,
      query_id,
      spec_json,
      surface_id,
      surface_version,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, view_id) DO UPDATE SET
      catalog_id = excluded.catalog_id,
      catalog_version = excluded.catalog_version,
      name = excluded.name,
      query_id = excluded.query_id,
      spec_json = excluded.spec_json,
      surface_id = excluded.surface_id,
      surface_version = excluded.surface_version,
      updated_at = excluded.updated_at`,
    ownerId,
    view.id,
    view.catalogId,
    view.catalogVersion,
    view.name,
    view.queryId,
    JSON.stringify(view.spec),
    view.surfaceId,
    view.surfaceVersion,
    view.updatedAt,
  );
}

export function deleteSavedQueryRows(
  sql: DurableObjectSqlStorageLike,
  ownerId: string,
  queryId: string,
): void {
  sql.exec(
    `DELETE FROM io_saved_view
    WHERE owner_id = ? AND query_id = ?`,
    ownerId,
    queryId,
  );
  sql.exec(
    `DELETE FROM io_saved_query
    WHERE owner_id = ? AND query_id = ?`,
    ownerId,
    queryId,
  );
}

export function deleteSavedViewRow(
  sql: DurableObjectSqlStorageLike,
  ownerId: string,
  viewId: string,
): void {
  sql.exec(
    `DELETE FROM io_saved_view
    WHERE owner_id = ? AND view_id = ?`,
    ownerId,
    viewId,
  );
}

function mapSavedQueryRow(row: SavedQuerySqlRow): SavedQueryRecord {
  void requireString(row.owner_id, "io_saved_query.owner_id");
  const parameterDefinitions = JSON.parse(
    requireString(row.parameter_definitions_json, "io_saved_query.parameter_definitions_json"),
  ) as SavedQueryRecord["parameterDefinitions"];
  const request = JSON.parse(
    requireString(row.request_json, "io_saved_query.request_json"),
  ) as SavedQueryRecord["request"];
  validateSerializedQueryRequest(request, {
    parameterDefinitions,
  });
  return {
    catalogId: requireString(row.catalog_id, "io_saved_query.catalog_id"),
    catalogVersion: requireString(row.catalog_version, "io_saved_query.catalog_version"),
    id: requireString(row.query_id, "io_saved_query.query_id"),
    name: requireString(row.name, "io_saved_query.name"),
    parameterDefinitions,
    request,
    surfaceId: requireString(row.surface_id, "io_saved_query.surface_id"),
    surfaceVersion: requireString(row.surface_version, "io_saved_query.surface_version"),
    updatedAt: requireString(row.updated_at, "io_saved_query.updated_at"),
  };
}

function mapSavedViewRow(row: SavedViewSqlRow): SavedViewRecord {
  void requireString(row.owner_id, "io_saved_view.owner_id");
  const spec = JSON.parse(
    requireString(row.spec_json, "io_saved_view.spec_json"),
  ) as SavedViewRecord["spec"];
  validateSavedViewSpec(spec);
  return {
    catalogId: requireString(row.catalog_id, "io_saved_view.catalog_id"),
    catalogVersion: requireString(row.catalog_version, "io_saved_view.catalog_version"),
    id: requireString(row.view_id, "io_saved_view.view_id"),
    name: requireString(row.name, "io_saved_view.name"),
    queryId: requireString(row.query_id, "io_saved_view.query_id"),
    spec,
    surfaceId: requireString(row.surface_id, "io_saved_view.surface_id"),
    surfaceVersion: requireString(row.surface_version, "io_saved_view.surface_version"),
    updatedAt: requireString(row.updated_at, "io_saved_view.updated_at"),
  };
}

function validateSavedViewSpec(spec: SavedViewRecord["spec"]): void {
  if (!spec || typeof spec !== "object") {
    throw new Error("Saved view spec must be an object.");
  }
  if (!spec.query || spec.query.kind !== "saved" || typeof spec.query.queryId !== "string") {
    throw new Error("Saved view spec must bind a saved query.");
  }
  if (spec.query.params) {
    for (const [name, value] of Object.entries(spec.query.params)) {
      if (name.trim().length === 0 || !isQueryLiteralValue(value)) {
        throw new Error("Saved view spec includes invalid parameter overrides.");
      }
    }
  }
}

function isQueryLiteralValue(value: unknown): value is QueryLiteral {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (!Array.isArray(value)) {
    return false;
  }
  if (value.length === 0) {
    return true;
  }
  return value.every((entry) => typeof entry === typeof value[0]);
}
