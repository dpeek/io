import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import type { AuthorizationContext } from "@io/graph-authority";

import { createInstalledQueryEditorCatalog } from "../components/query-editor.js";
import {
  builtInQueryRendererRegistry,
  createQueryRendererCapabilityMap,
} from "../components/query-renderers.js";
import { createAnonymousAuthorizationContext } from "./auth-bridge.js";
import { createTestWebAppAuthority } from "./authority-test-helpers.js";
import {
  bootstrapDurableObjectAuthoritySchema,
  createSqliteDurableObjectAuthorityStorage,
} from "./graph-authority-sql-storage.js";
import type { DurableObjectSqlStorageLike } from "./graph-authority-sql-startup.js";
import { webAppPolicyVersion } from "./policy-version.js";
import { createQueryEditorDraft } from "./query-editor.js";
import { getInstalledModuleQuerySurfaceRendererCompatibility } from "./query-surface-registry.js";
import {
  createSavedQueryMemoryStore,
  saveSavedQueryDraft,
  saveSavedViewDraft,
  type SavedQueryRecord,
  type SavedViewRecord,
} from "./saved-query.js";

const workflowProjectBranchBoardSurfaceId = "workflow:project-branch-board";

function createSqlStorage(): {
  readonly db: Database;
  readonly storage: ReturnType<typeof createSqliteDurableObjectAuthorityStorage>;
} {
  const db = new Database(":memory:");
  const state = {
    storage: {
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
      } satisfies DurableObjectSqlStorageLike,
      transactionSync<T>(callback: () => T): T {
        return db.transaction(callback)();
      },
    },
  };

  bootstrapDurableObjectAuthoritySchema(state.storage);

  return {
    db,
    storage: createSqliteDurableObjectAuthorityStorage(state),
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

function createAuthorityAuthorizationContext(
  overrides: Partial<AuthorizationContext> = {},
): AuthorizationContext {
  return {
    ...createAnonymousAuthorizationContext({
      graphId: "graph:test",
      policyVersion: webAppPolicyVersion,
    }),
    principalId: "principal:authority",
    principalKind: "service",
    roleKeys: ["graph:authority"],
    sessionId: "session:authority",
    ...overrides,
  };
}

async function saveSavedQueryFixture(input: {
  readonly authorization: AuthorizationContext;
  readonly storage: ReturnType<typeof createSqliteDurableObjectAuthorityStorage>;
}): Promise<{
  readonly query: SavedQueryRecord;
  readonly view: SavedViewRecord;
}> {
  const authority = await createTestWebAppAuthority(input.storage);
  const catalog = createInstalledQueryEditorCatalog();
  const rendererCapabilities = createQueryRendererCapabilityMap(builtInQueryRendererRegistry);
  const draft = {
    ...createQueryEditorDraft(catalog, workflowProjectBranchBoardSurfaceId),
    filters: [
      {
        fieldId: "state",
        id: "filter:state",
        operator: "eq" as const,
        value: { kind: "param" as const, name: "state" },
      },
    ],
    parameters: [
      {
        defaultValue: "active",
        id: "param:state",
        label: "State",
        name: "state",
        required: false,
        type: "enum" as const,
      },
    ],
  };

  const querySeed = saveSavedQueryDraft({
    catalog,
    draft,
    name: "Owner board",
    store: createSavedQueryMemoryStore(),
  });
  const { updatedAt: _queryUpdatedAt, ...queryInput } = querySeed;
  const query = await authority.saveSavedQuery(queryInput, {
    authorization: input.authorization,
  });

  const viewSeed = saveSavedViewDraft({
    catalog,
    draft,
    queryId: query.id,
    queryName: query.name,
    rendererCapabilities,
    spec: {
      containerId: "saved-view-preview",
      pagination: {
        mode: "paged",
        pageSize: 25,
      },
      refresh: {
        mode: "manual",
      },
      renderer: {
        rendererId: "core:list",
      },
    },
    store: createSavedQueryMemoryStore({
      queries: [query],
    }),
    surface: getInstalledModuleQuerySurfaceRendererCompatibility(
      workflowProjectBranchBoardSurfaceId,
    ),
    viewName: "Owner board view",
  });
  const { updatedAt: _viewUpdatedAt, ...viewInput } = viewSeed.view;
  const view = await authority.saveSavedView(viewInput, {
    authorization: input.authorization,
  });

  return {
    query,
    view,
  };
}

describe("graph-authority-sql-saved-query", () => {
  it("persists saved queries and views through sqlite durable-object storage and re-derives normalized records after restart", async () => {
    const { db, storage } = createSqlStorage();
    const authorization = createAuthorityAuthorizationContext();
    const initialAuthority = await createTestWebAppAuthority(storage);
    const saved = await saveSavedQueryFixture({ authorization, storage });

    const resolvedQuery = await initialAuthority.resolveSavedQuery(
      {
        params: { state: "ready" },
        queryId: saved.query.id,
      },
      { authorization },
    );

    expect(
      queryAll<{
        catalog_version: string;
        owner_id: string;
        query_id: string;
      }>(db, "SELECT owner_id, query_id, catalog_version FROM io_saved_query ORDER BY query_id"),
    ).toEqual([
      {
        catalog_version: saved.query.catalogVersion,
        owner_id: authorization.principalId ?? "",
        query_id: saved.query.id,
      },
    ]);
    expect(
      queryAll<{
        owner_id: string;
        query_id: string;
        view_id: string;
      }>(db, "SELECT owner_id, query_id, view_id FROM io_saved_view ORDER BY view_id"),
    ).toEqual([
      {
        owner_id: authorization.principalId ?? "",
        query_id: saved.query.id,
        view_id: saved.view.id,
      },
    ]);
    expect(resolvedQuery.request.params?.state).toBe("ready");
    expect(resolvedQuery.normalizedRequest.metadata.identityHash).toEqual(expect.any(String));
    expect(resolvedQuery.normalizedRequest.params[0]).toMatchObject({
      name: "state",
      value: "ready",
    });

    const restartedAuthority = await createTestWebAppAuthority(storage);
    const resolvedView = await restartedAuthority.resolveSavedView(
      {
        params: { state: "blocked" },
        viewId: saved.view.id,
      },
      { authorization },
    );

    expect(
      (await restartedAuthority.listSavedQueries({ authorization })).map((query) => query.id),
    ).toEqual([saved.query.id]);
    expect(
      (await restartedAuthority.listSavedViews({ authorization })).map((view) => view.id),
    ).toEqual([saved.view.id]);
    expect(resolvedView.view.id).toBe(saved.view.id);
    expect(resolvedView.normalizedRequest.metadata.identityHash).toEqual(expect.any(String));
    expect(resolvedView.normalizedRequest.params[0]).toMatchObject({
      name: "state",
      value: "blocked",
    });
  });

  it("fails closed after restart when a persisted query catalog version no longer matches the installed module catalog", async () => {
    const { db, storage } = createSqlStorage();
    const authorization = createAuthorityAuthorizationContext();
    const saved = await saveSavedQueryFixture({ authorization, storage });

    db.query(
      "UPDATE io_saved_query SET catalog_version = ? WHERE owner_id = ? AND query_id = ?",
    ).run("query-catalog:workflow:v0", authorization.principalId, saved.query.id);

    const restartedAuthority = await createTestWebAppAuthority(storage);

    await expect(
      restartedAuthority.resolveSavedQuery(
        {
          queryId: saved.query.id,
        },
        { authorization },
      ),
    ).rejects.toMatchObject({
      message:
        `Saved query "${saved.query.id}" references incompatible query catalog ` +
        '"workflow:query-surfaces@query-catalog:workflow:v0".',
      status: 409,
    });
  });

  it("fails closed after restart when a persisted saved view points at a removed saved query and can be explicitly recovered", async () => {
    const { db, storage } = createSqlStorage();
    const authorization = createAuthorityAuthorizationContext();
    const saved = await saveSavedQueryFixture({ authorization, storage });

    db.query("DELETE FROM io_saved_query WHERE owner_id = ? AND query_id = ?").run(
      authorization.principalId,
      saved.query.id,
    );

    const restartedAuthority = await createTestWebAppAuthority(storage);

    await expect(
      restartedAuthority.resolveSavedView(
        {
          viewId: saved.view.id,
        },
        { authorization },
      ),
    ).rejects.toMatchObject({
      message: `Saved view "${saved.view.id}" references missing saved query "${saved.query.id}".`,
      status: 404,
    });

    await restartedAuthority.deleteSavedView(saved.view.id, { authorization });

    expect(await restartedAuthority.getSavedView(saved.view.id, { authorization })).toBeUndefined();
    expect(queryAll<{ view_id: string }>(db, "SELECT view_id FROM io_saved_view")).toEqual([]);
  });
});
