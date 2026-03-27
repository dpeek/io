import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import type { GraphStoreSnapshot } from "@io/core/graph";
import { edgeId } from "@io/core/graph";
import { core } from "@io/graph-module-core";
import { workflow } from "@io/graph-module-workflow";

import {
  bootstrapSecretValueTable,
  pruneOrphanedSecretValues,
  readSecretInventoryFromSql,
  readSecretsFromSql,
  upsertSecretValue,
} from "./graph-authority-sql-secrets.js";
import type { DurableObjectSqlStorageLike } from "./graph-authority-sql-startup.js";

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

const typePredicateId = edgeId(core.node.fields.type);
const envVarSecretPredicateId = edgeId(workflow.envVar.fields.secret);

describe("graph-authority-sql-secrets", () => {
  it("reads secret inventory and hydrates filtered plaintext rows", () => {
    const { sql } = createSqlStorage();
    bootstrapSecretValueTable(sql);

    upsertSecretValue(
      sql,
      {
        secretId: "secret-a",
        value: "sk-live-a",
        version: 2,
        storedAt: "2026-03-26T00:00:00.000Z",
        provider: "manual",
        fingerprint: "fp-a",
        externalKeyId: "ext-a",
      },
      "2026-03-26T00:00:00.000Z",
    );
    upsertSecretValue(
      sql,
      {
        secretId: "secret-b",
        value: "sk-live-b",
        version: 3,
      },
      "2026-03-26T00:01:00.000Z",
    );

    expect(readSecretInventoryFromSql(sql)).toEqual({
      "secret-a": { version: 2 },
      "secret-b": { version: 3 },
    });
    expect(readSecretsFromSql(sql, { secretIds: ["secret-b"] })).toEqual({
      "secret-b": {
        value: "sk-live-b",
        version: 3,
        storedAt: "2026-03-26T00:01:00.000Z",
      },
    });
  });

  it("prunes orphaned secret rows from the live graph snapshot", () => {
    const { db, sql } = createSqlStorage();
    bootstrapSecretValueTable(sql);

    upsertSecretValue(
      sql,
      {
        secretId: "secret-live",
        value: "sk-live",
        version: 1,
      },
      "2026-03-26T00:00:00.000Z",
    );
    upsertSecretValue(
      sql,
      {
        secretId: "secret-orphan",
        value: "sk-orphan",
        version: 1,
      },
      "2026-03-26T00:00:00.000Z",
    );

    const snapshot: GraphStoreSnapshot = {
      edges: [
        {
          id: "edge:secret-live:type",
          s: "secret-live",
          p: typePredicateId,
          o: core.secretHandle.values.id,
        },
        {
          id: "edge:env-1:secret",
          s: "env-1",
          p: envVarSecretPredicateId,
          o: "secret-live",
        },
      ],
      retracted: [],
    };

    pruneOrphanedSecretValues(sql, snapshot);

    expect(
      queryAll<{ secret_id: string }>(
        db,
        "SELECT secret_id FROM io_secret_value ORDER BY secret_id",
      ),
    ).toEqual([{ secret_id: "secret-live" }]);
  });
});
