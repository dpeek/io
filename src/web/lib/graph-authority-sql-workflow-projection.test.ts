import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import type { RetainedWorkflowProjectionState } from "@io/core/graph/modules/workflow";
import { projectionMetadata } from "@io/core/graph/modules/workflow";
import type {
  CommitQueueScopeCommitRow,
  WorkflowBranchSummary,
} from "@io/core/graph/modules/workflow";

import type { DurableObjectSqlStorageLike } from "./graph-authority-sql-startup.js";
import {
  bootstrapWorkflowProjectionTables,
  readWorkflowProjectionFromSql,
  replaceWorkflowProjectionRows,
} from "./graph-authority-sql-workflow-projection.js";

function createSqlStorage(): { db: Database; sql: DurableObjectSqlStorageLike } {
  const db = new Database(":memory:");
  return {
    db,
    sql: {
      exec<T extends Record<string, unknown>>(query: string, ...bindings: unknown[]) {
        const statement = db.query(query);
        const trimmed = query.trimStart();
        if (/^(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(trimmed)) {
          return statement.all(
            ...(bindings as never as Parameters<typeof statement.all>),
          ) as Iterable<T>;
        }
        statement.run(...(bindings as never as Parameters<typeof statement.run>));
        return [] as T[];
      },
    },
  };
}

function queryAll<T extends Record<string, unknown>>(
  db: Database,
  query: string,
  ...bindings: unknown[]
): T[] {
  const statement = db.query(query);
  return statement.all(...(bindings as never as Parameters<typeof statement.all>)) as T[];
}

function createWorkflowProjectionState(): RetainedWorkflowProjectionState {
  return {
    checkpoints: [
      {
        projectionId: projectionMetadata.branchCommitQueue.projectionId,
        definitionHash: projectionMetadata.branchCommitQueue.definitionHash,
        sourceCursor: "web-authority:1:9",
        projectionCursor: "workflow:branch-commit-queue:9",
        projectedAt: "2026-03-26T00:00:00.000Z",
      },
      {
        projectionId: projectionMetadata.projectBranchBoard.projectionId,
        definitionHash: projectionMetadata.projectBranchBoard.definitionHash,
        sourceCursor: "web-authority:1:9",
        projectionCursor: "workflow:project-branch-board:9",
        projectedAt: "2026-03-26T00:00:00.000Z",
      },
    ],
    rows: [
      {
        projectionId: projectionMetadata.branchCommitQueue.projectionId,
        definitionHash: projectionMetadata.branchCommitQueue.definitionHash,
        rowKind: "commit-row",
        rowKey: "commit:1",
        sortKey: "0002",
        value: {
          commit: {
            id: "commit:1",
            branchId: "branch:1",
            commitKey: "commit:first",
            createdAt: "2026-03-26T00:00:00.000Z",
            order: 1,
            state: "ready",
            title: "First commit",
            updatedAt: "2026-03-26T00:00:00.000Z",
          },
        } as CommitQueueScopeCommitRow,
      },
      {
        projectionId: projectionMetadata.projectBranchBoard.projectionId,
        definitionHash: projectionMetadata.projectBranchBoard.definitionHash,
        rowKind: "branch",
        rowKey: "branch:1",
        sortKey: "0001",
        value: {
          id: "branch:1",
          branchKey: "branch:alpha",
          createdAt: "2026-03-26T00:00:00.000Z",
          projectId: "project:1",
          state: "ready",
          title: "Alpha",
          updatedAt: "2026-03-26T00:00:00.000Z",
        } as WorkflowBranchSummary,
      },
    ],
  };
}

describe("graph-authority-sql-workflow-projection", () => {
  it("replaces and reloads retained workflow projection rows", () => {
    const { db, sql } = createSqlStorage();
    bootstrapWorkflowProjectionTables(sql);

    replaceWorkflowProjectionRows(sql, createWorkflowProjectionState());

    expect(readWorkflowProjectionFromSql(sql, "web-authority:1:9")).toEqual(
      createWorkflowProjectionState(),
    );
    expect(
      queryAll<{ projection_id: string }>(
        db,
        "SELECT projection_id FROM io_workflow_projection_checkpoint ORDER BY projection_id",
      ),
    ).toEqual([
      { projection_id: "workflow:branch-commit-queue" },
      { projection_id: "workflow:project-branch-board" },
    ]);
  });

  it("treats source cursor drift as incompatible retained state", () => {
    const { sql } = createSqlStorage();
    bootstrapWorkflowProjectionTables(sql);

    replaceWorkflowProjectionRows(sql, createWorkflowProjectionState());

    expect(readWorkflowProjectionFromSql(sql, "web-authority:1:10")).toBeNull();
  });

  it("clears retained workflow projection rows when replacement state is missing", () => {
    const { db, sql } = createSqlStorage();
    bootstrapWorkflowProjectionTables(sql);

    replaceWorkflowProjectionRows(sql, createWorkflowProjectionState());
    replaceWorkflowProjectionRows(sql, undefined);

    expect(readWorkflowProjectionFromSql(sql, "web-authority:1:9")).toBeNull();
    expect(queryAll(db, "SELECT * FROM io_workflow_projection_checkpoint")).toEqual([]);
    expect(queryAll(db, "SELECT * FROM io_workflow_projection_row")).toEqual([]);
  });
});
