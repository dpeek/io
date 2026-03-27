import type { RetainedWorkflowProjectionState } from "@io/graph-module-workflow";

import type { DurableObjectSqlStorageLike } from "./graph-authority-sql-startup.js";

type SqlRow = Record<string, unknown>;

type WorkflowProjectionCheckpointRow = {
  definition_hash: string;
  projected_at: string;
  projection_cursor: string;
  projection_id: string;
  source_cursor: string;
};

type WorkflowProjectionRow = {
  definition_hash: string;
  payload_json: string;
  projection_id: string;
  row_key: string;
  row_kind: RetainedWorkflowProjectionState["rows"][number]["rowKind"];
  sort_key: string;
};

function readAllRows<T extends SqlRow>(cursor: Iterable<T>): T[] {
  return [...cursor];
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected "${label}" to be a string.`);
  }
  return value;
}

export function bootstrapWorkflowProjectionTables(sql: DurableObjectSqlStorageLike): void {
  sql.exec(
    `CREATE TABLE IF NOT EXISTS io_workflow_projection_checkpoint (
      projection_id TEXT NOT NULL,
      definition_hash TEXT NOT NULL,
      source_cursor TEXT NOT NULL,
      projection_cursor TEXT NOT NULL,
      projected_at TEXT NOT NULL,
      PRIMARY KEY (projection_id, definition_hash)
    )`,
  );
  sql.exec(
    `CREATE TABLE IF NOT EXISTS io_workflow_projection_row (
      projection_id TEXT NOT NULL,
      definition_hash TEXT NOT NULL,
      row_kind TEXT NOT NULL,
      row_key TEXT NOT NULL,
      sort_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (projection_id, definition_hash, row_kind, row_key)
    )`,
  );
  sql.exec(
    `CREATE INDEX IF NOT EXISTS io_workflow_projection_checkpoint_source_cursor_idx
    ON io_workflow_projection_checkpoint (source_cursor)`,
  );
  sql.exec(
    `CREATE INDEX IF NOT EXISTS io_workflow_projection_row_lookup_idx
    ON io_workflow_projection_row (projection_id, definition_hash, row_kind, sort_key)`,
  );
}

export function readWorkflowProjectionFromSql(
  sql: DurableObjectSqlStorageLike,
  sourceCursor: string,
): RetainedWorkflowProjectionState | null {
  const checkpoints = readAllRows<WorkflowProjectionCheckpointRow>(
    sql.exec(
      `SELECT projection_id, definition_hash, source_cursor, projection_cursor, projected_at
      FROM io_workflow_projection_checkpoint
      ORDER BY projection_id ASC, definition_hash ASC`,
    ),
  );
  if (checkpoints.length === 0) {
    return null;
  }

  if (
    checkpoints.some(
      (checkpoint) =>
        requireString(
          checkpoint.source_cursor,
          "io_workflow_projection_checkpoint.source_cursor",
        ) !== sourceCursor,
    )
  ) {
    return null;
  }

  const rows = readAllRows<WorkflowProjectionRow>(
    sql.exec(
      `SELECT projection_id, definition_hash, row_kind, row_key, sort_key, payload_json
      FROM io_workflow_projection_row
      ORDER BY projection_id ASC, definition_hash ASC, row_kind ASC, sort_key ASC`,
    ),
  );

  return {
    checkpoints: checkpoints.map((checkpoint) => ({
      projectionId: requireString(
        checkpoint.projection_id,
        "io_workflow_projection_checkpoint.projection_id",
      ),
      definitionHash: requireString(
        checkpoint.definition_hash,
        "io_workflow_projection_checkpoint.definition_hash",
      ),
      sourceCursor: requireString(
        checkpoint.source_cursor,
        "io_workflow_projection_checkpoint.source_cursor",
      ),
      projectionCursor: requireString(
        checkpoint.projection_cursor,
        "io_workflow_projection_checkpoint.projection_cursor",
      ),
      projectedAt: requireString(
        checkpoint.projected_at,
        "io_workflow_projection_checkpoint.projected_at",
      ),
    })),
    rows: rows.map((row) => ({
      projectionId: requireString(row.projection_id, "io_workflow_projection_row.projection_id"),
      definitionHash: requireString(
        row.definition_hash,
        "io_workflow_projection_row.definition_hash",
      ),
      rowKind: requireString(
        row.row_kind,
        "io_workflow_projection_row.row_kind",
      ) as RetainedWorkflowProjectionState["rows"][number]["rowKind"],
      rowKey: requireString(row.row_key, "io_workflow_projection_row.row_key"),
      sortKey: requireString(row.sort_key, "io_workflow_projection_row.sort_key"),
      value: JSON.parse(requireString(row.payload_json, "io_workflow_projection_row.payload_json")),
    })) as RetainedWorkflowProjectionState["rows"],
  };
}

export function replaceWorkflowProjectionRows(
  sql: DurableObjectSqlStorageLike,
  projection?: RetainedWorkflowProjectionState,
): void {
  sql.exec("DELETE FROM io_workflow_projection_row");
  sql.exec("DELETE FROM io_workflow_projection_checkpoint");
  if (!projection) {
    return;
  }

  projection.checkpoints.forEach((checkpoint) => {
    sql.exec(
      `INSERT INTO io_workflow_projection_checkpoint (
        projection_id,
        definition_hash,
        source_cursor,
        projection_cursor,
        projected_at
      ) VALUES (?, ?, ?, ?, ?)`,
      checkpoint.projectionId,
      checkpoint.definitionHash,
      checkpoint.sourceCursor,
      checkpoint.projectionCursor,
      checkpoint.projectedAt,
    );
  });

  projection.rows.forEach((row) => {
    sql.exec(
      `INSERT INTO io_workflow_projection_row (
        projection_id,
        definition_hash,
        row_kind,
        row_key,
        sort_key,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      row.projectionId,
      row.definitionHash,
      row.rowKind,
      row.rowKey,
      row.sortKey,
      JSON.stringify(row.value),
    );
  });
}
