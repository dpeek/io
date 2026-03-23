import { Database } from "bun:sqlite";
import { describe, expect, it, setDefaultTimeout } from "bun:test";

import {
  bootstrap,
  createIdMap,
  createPersistedAuthoritativeGraph,
  createStore,
  createTypeClient,
  defineNamespace,
  defineType,
  edgeId,
  type AnyTypeOutput,
  type AuthorizationContext,
  type GraphWriteTransaction,
  type NamespaceClient,
  type PersistedAuthoritativeGraphStorage,
  type StoreSnapshot,
} from "@io/core/graph";
import { core } from "@io/core/graph/modules";
import { ops } from "@io/core/graph/modules/ops";

setDefaultTimeout(20_000);
import { pkm } from "@io/core/graph/modules/pkm";

import { createAnonymousAuthorizationContext } from "./auth-bridge.js";
import { createTestWebAppAuthority } from "./authority-test-helpers.js";
import {
  createWebAppAuthority,
  type WebAppAuthority,
  type WebAppAuthorityStorage,
} from "./authority.js";
import { WebGraphAuthorityDurableObject } from "./graph-authority-do.js";
import {
  encodeRequestAuthorizationContext,
  webAppAuthorizationContextHeader,
} from "./server-routes.js";

const productGraph = { ...core, ...pkm, ...ops } as const;
const envVarSecretPredicateId = edgeId(ops.envVar.fields.secret);
const hiddenCursorProbe = defineType({
  values: { key: "test:hiddenCursorProbe", name: "Hidden Cursor Probe" },
  fields: {
    ...core.node.fields,
    hiddenState: {
      ...core.node.fields.description,
      key: "test:hiddenCursorProbe:hiddenState",
      authority: {
        visibility: "authority-only",
        write: "authority-only",
      },
      meta: {
        ...core.node.fields.description.meta,
        label: "Hidden state",
      },
    },
  },
});
const hiddenCursorProbeNamespace = defineNamespace(createIdMap({ hiddenCursorProbe }).map, {
  hiddenCursorProbe,
});
const hiddenCursorGraph = { ...core, ...hiddenCursorProbeNamespace } as const;
const visibilityProbe = defineType({
  values: { key: "test:visibilityProbe", name: "Visibility Probe" },
  fields: {
    ...core.node.fields,
    memberNote: {
      ...core.node.fields.description,
      key: "test:visibilityProbe:memberNote",
      authority: {
        visibility: "replicated",
        write: "client-tx",
        policy: {
          readAudience: "graph-member",
          writeAudience: "authority",
          shareable: false,
        },
      },
      meta: {
        ...core.node.fields.description.meta,
        label: "Member note",
      },
    },
  },
});
const visibilityProbeNamespace = defineNamespace(createIdMap({ visibilityProbe }).map, {
  visibilityProbe,
});
const visibilityProofGraph = { ...productGraph, ...visibilityProbeNamespace } as const;
const visibilityProbeMemberNotePredicateId = edgeId(visibilityProbe.fields.memberNote);

type SqliteMasterRow = {
  name: string;
  type: "index" | "table";
};

type GraphTxRow = {
  cursor: string;
  seq: number;
  tx_id: string;
  write_scope: "authority-only" | "client-tx" | "server-command";
};

type GraphTxOpRow = {
  edge_id: string;
  op_index: number;
  op_kind: "assert" | "retract";
  tx_seq: number;
};

type GraphEdgeRow = {
  asserted_tx_seq?: number;
  edge_id: string;
  o: string;
  p: string;
  retracted_tx_seq: number | null;
  s: string;
};

type SecretValueRow = {
  rowid?: number;
  secret_id: string;
  stored_at?: string;
  value: string;
  version: number;
};

type SyncPayload = {
  readonly mode: "incremental" | "total";
  readonly after?: string;
  readonly cursor: string;
  readonly fallback?: "gap" | "reset" | "unknown-cursor";
  readonly snapshot?: StoreSnapshot;
  readonly transactions?: readonly {
    readonly cursor: string;
    readonly replayed: boolean;
    readonly transaction: {
      readonly id: string;
      readonly ops: readonly (
        | {
            readonly op: "assert";
            readonly edge: {
              readonly id: string;
              readonly o: string;
              readonly p: string;
              readonly s: string;
            };
          }
        | {
            readonly edgeId: string;
            readonly op: "retract";
          }
      )[];
    };
    readonly txId: string;
    readonly writeScope: "authority-only" | "client-tx" | "server-command";
  }[];
};

type TransactionResponse = {
  readonly cursor: string;
  readonly replayed: boolean;
  readonly txId: string;
};

type SecretFieldResponse = {
  readonly created: boolean;
  readonly entityId: string;
  readonly predicateId: string;
  readonly rotated: boolean;
  readonly secretId: string;
  readonly secretVersion: number;
};

type DurableObjectSqlCursor<T extends Record<string, unknown>> = Iterable<T> & {
  one(): T | null;
};

type SqlExecHook = (query: string, bindings: readonly unknown[]) => void;
type TestDurableObjectOptions = NonNullable<
  ConstructorParameters<typeof WebGraphAuthorityDurableObject>[2]
>;

const testAuthorization = createAnonymousAuthorizationContext({
  graphId: "graph:test",
  policyVersion: 0,
});

const testAuthorityAuthorization = {
  ...testAuthorization,
  principalId: "principal:authority",
  principalKind: "service" as const,
  roleKeys: ["graph:authority"],
  sessionId: "session:authority",
};

const testHumanAuthorization = {
  ...testAuthorization,
  principalId: "principal:human",
  principalKind: "human" as const,
  roleKeys: ["graph:member"],
  sessionId: "session:human",
};

const testOutsiderAuthorization = {
  ...testAuthorization,
  principalId: "principal:outsider",
  principalKind: "human" as const,
  roleKeys: [],
  sessionId: "session:outsider",
};

function createCursor<T extends Record<string, unknown>>(
  rows: readonly T[],
): DurableObjectSqlCursor<T> {
  return {
    one() {
      if (rows.length !== 1) {
        throw new Error(
          `Expected exactly one result from SQL query, but got ${rows.length === 0 ? "no results" : `${rows.length} results`}.`,
        );
      }
      const row = rows[0];
      if (!row) {
        throw new Error("Expected a SQL row when the cursor reports exactly one result.");
      }
      return row;
    },
    *[Symbol.iterator]() {
      yield* rows;
    },
  };
}

function createAuthorizedRequest(
  input: string,
  init: RequestInit = {},
  authorization: AuthorizationContext = testAuthorityAuthorization,
): Request {
  const request = new Request(input, init);
  const headers = new Headers(request.headers);

  headers.set(webAppAuthorizationContextHeader, encodeRequestAuthorizationContext(authorization));
  return new Request(request, { headers });
}

function createSqliteDurableObjectState(): {
  readonly db: Database;
  getBlockConcurrencyWhileCount(): number;
  setExecHook(hook: SqlExecHook | null): void;
  readonly state: ConstructorParameters<typeof WebGraphAuthorityDurableObject>[0];
} {
  const db = new Database(":memory:");
  let execHook: SqlExecHook | null = null;
  let blockConcurrencyWhileCount = 0;

  return {
    db,
    getBlockConcurrencyWhileCount() {
      return blockConcurrencyWhileCount;
    },
    setExecHook(hook) {
      execHook = hook;
    },
    state: {
      storage: {
        sql: {
          exec<T extends Record<string, unknown>>(
            query: string,
            ...bindings: unknown[]
          ): DurableObjectSqlCursor<T> {
            execHook?.(query, bindings);
            const statement = db.query(query);
            const trimmed = query.trimStart();
            if (/^(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(trimmed)) {
              return createCursor(
                statement.all(...(bindings as never as Parameters<typeof statement.all>)) as T[],
              );
            }
            statement.run(...(bindings as never as Parameters<typeof statement.run>));
            return createCursor([]);
          },
        },
        transactionSync<T>(callback: () => T): T {
          return db.transaction(callback)();
        },
      },
      async blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
        blockConcurrencyWhileCount += 1;
        return callback();
      },
    },
  };
}

function createTestDurableObject(
  state: ConstructorParameters<typeof WebGraphAuthorityDurableObject>[0],
  env: ConstructorParameters<typeof WebGraphAuthorityDurableObject>[1] = {},
  options: TestDurableObjectOptions = {},
): WebGraphAuthorityDurableObject {
  const { createAuthority, ...restOptions } = options;

  return new WebGraphAuthorityDurableObject(state, env, {
    ...restOptions,
    createAuthority: createAuthority
      ? (storage, authorityOptions) =>
          createAuthority(storage, {
            ...authorityOptions,
            seedExampleGraph: false,
          })
      : (storage, authorityOptions) => createTestWebAppAuthority(storage, authorityOptions),
  });
}

function queryAll<T extends Record<string, unknown>>(
  db: Database,
  query: string,
  ...bindings: unknown[]
): T[] {
  const statement = db.query(query);
  return statement.all(...(bindings as never as Parameters<typeof statement.all>)) as T[];
}

function buildGraphWriteTransaction(
  before: StoreSnapshot,
  after: StoreSnapshot,
  id: string,
): GraphWriteTransaction {
  const previousEdgeIds = new Set(before.edges.map((edge) => edge.id));
  const previousRetractedIds = new Set(before.retracted);

  return {
    id,
    ops: [
      ...after.retracted
        .filter((edgeId) => !previousRetractedIds.has(edgeId))
        .map((edgeId) => ({ op: "retract" as const, edgeId })),
      ...after.edges
        .filter((edge) => !previousEdgeIds.has(edge.id))
        .map((edge) => ({
          op: "assert" as const,
          edge: { ...edge },
        })),
    ],
  };
}

function buildTransactionFromSnapshot<TResult>(
  snapshot: StoreSnapshot,
  id: string,
  mutate: (graph: NamespaceClient<typeof productGraph>) => TResult,
): {
  readonly result: TResult;
  readonly transaction: GraphWriteTransaction;
} {
  return buildTransactionFromGraphSnapshot(snapshot, productGraph, id, mutate);
}

function buildTransactionFromGraphSnapshot<TGraph extends Record<string, AnyTypeOutput>, TResult>(
  snapshot: StoreSnapshot,
  graph: TGraph,
  id: string,
  mutate: (graph: NamespaceClient<TGraph>) => TResult,
): {
  readonly result: TResult;
  readonly transaction: GraphWriteTransaction;
} {
  const mutationStore = createStore(snapshot);
  const mutationGraph = createTypeClient(mutationStore, graph);
  const before = mutationStore.snapshot();
  const result = mutate(mutationGraph);

  return {
    result,
    transaction: buildGraphWriteTransaction(before, mutationStore.snapshot(), id),
  };
}

function createPersistedStorageAdapter(
  storage: WebAppAuthorityStorage,
): PersistedAuthoritativeGraphStorage {
  return {
    load() {
      return storage.load();
    },
    commit(input) {
      return storage.commit(input);
    },
    persist(input) {
      return storage.persist(input);
    },
  };
}

function createHiddenCursorAdvanceAuthorityFactory(ref: { entityId: string | null }) {
  let cursorEpoch = 0;

  return async (
    storage: WebAppAuthorityStorage,
    options: { readonly maxRetainedTransactions?: number },
  ): Promise<WebAppAuthority> => {
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, hiddenCursorProbeNamespace);

    const authority = await createPersistedAuthoritativeGraph(store, hiddenCursorGraph, {
      storage: createPersistedStorageAdapter(storage),
      seed(graph) {
        ref.entityId = graph.hiddenCursorProbe.create({
          name: "Hidden Cursor Probe",
        });
      },
      // Fresh prefixes keep baseline rewrites classifiable as "reset" instead of "unknown-cursor".
      createCursorPrefix: () => `web-hidden:${++cursorEpoch}:`,
      maxRetainedTransactions: options.maxRetainedTransactions,
    });

    return Object.assign(authority, {
      async writeSecretField() {
        throw new Error("Secret-field writes are not supported in the hidden cursor test.");
      },
    }) as unknown as WebAppAuthority;
  };
}

function buildHiddenCursorAdvanceTransaction(
  snapshot: StoreSnapshot,
  entityId: string,
  txId: string,
  hiddenState = `hidden:${txId}`,
): GraphWriteTransaction {
  const mutationStore = createStore(snapshot);
  const before = mutationStore.snapshot();
  const hiddenStatePredicateId = edgeId(hiddenCursorProbe.fields.hiddenState);

  mutationStore.batch(() => {
    for (const edge of mutationStore.facts(entityId, hiddenStatePredicateId)) {
      mutationStore.retract(edge.id);
    }
    mutationStore.assert(entityId, hiddenStatePredicateId, hiddenState);
  });

  return buildGraphWriteTransaction(before, mutationStore.snapshot(), txId);
}

async function readSyncPayload(
  durableObject: WebGraphAuthorityDurableObject,
  after?: string,
  authorization: AuthorizationContext = testAuthorityAuthorization,
): Promise<SyncPayload> {
  const url = new URL("https://graph-authority.local/api/sync");
  if (after) url.searchParams.set("after", after);
  const response = await durableObject.fetch(
    createAuthorizedRequest(url.toString(), {}, authorization),
  );

  expect(response.status).toBe(200);
  return (await response.json()) as SyncPayload;
}

async function postTransaction(
  durableObject: WebGraphAuthorityDurableObject,
  transaction: GraphWriteTransaction,
): Promise<TransactionResponse> {
  const response = await durableObject.fetch(
    createAuthorizedRequest("https://graph-authority.local/api/tx", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(transaction),
    }),
  );

  expect(response.status).toBe(200);
  return (await response.json()) as TransactionResponse;
}

async function postSecretField(
  durableObject: WebGraphAuthorityDurableObject,
  input: {
    readonly entityId: string;
    readonly plaintext: string;
    readonly predicateId: string;
  },
  expectedStatus = 201,
): Promise<SecretFieldResponse> {
  const response = await durableObject.fetch(
    createAuthorizedRequest("https://graph-authority.local/api/commands", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        kind: "write-secret-field",
        input,
      }),
    }),
  );

  expect(response.status).toBe(expectedStatus);
  return (await response.json()) as SecretFieldResponse;
}

async function postCommand(
  durableObject: WebGraphAuthorityDurableObject,
  command: {
    readonly kind: "write-secret-field";
    readonly input: {
      readonly entityId: string;
      readonly plaintext: string;
      readonly predicateId: string;
    };
  },
  expectedStatus = 201,
): Promise<SecretFieldResponse> {
  const response = await durableObject.fetch(
    createAuthorizedRequest("https://graph-authority.local/api/commands", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
    }),
  );

  expect(response.status).toBe(expectedStatus);
  return (await response.json()) as SecretFieldResponse;
}

async function getDurableAuthority(durableObject: WebGraphAuthorityDurableObject): Promise<{
  persist(): Promise<void>;
  readSnapshot(options: { authorization: AuthorizationContext }): StoreSnapshot;
}>;
async function getDurableAuthority<T>(durableObject: WebGraphAuthorityDurableObject): Promise<T>;
async function getDurableAuthority<
  T = {
    persist(): Promise<void>;
    readSnapshot(options: { authorization: AuthorizationContext }): StoreSnapshot;
  },
>(durableObject: WebGraphAuthorityDurableObject): Promise<T> {
  return (
    durableObject as unknown as {
      getAuthority(): Promise<T>;
    }
  ).getAuthority();
}

describe("web graph authority durable object", () => {
  it("requires an explicit request authorization context for API requests", async () => {
    const { state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const response = await durableObject.fetch(
      new Request("https://graph-authority.local/api/sync"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Request authorization context header is required.",
    });
  });

  it("passes the request authorization context through the durable authority boundary", async () => {
    const { state } = createSqliteDurableObjectState();
    const captured: AuthorizationContext[] = [];
    const durableObject = createTestDurableObject(
      state,
      {},
      {
        createAuthority: async (storage, options) => {
          const authority = await createWebAppAuthority(storage, options);

          return {
            ...authority,
            createSyncPayload(syncOptions) {
              captured.push(syncOptions.authorization);
              return authority.createSyncPayload(syncOptions);
            },
          } satisfies WebAppAuthority;
        },
      },
    );
    const authorization = createAnonymousAuthorizationContext({
      graphId: "graph:durable",
      policyVersion: 0,
    });
    const response = await durableObject.fetch(
      createAuthorizedRequest("https://graph-authority.local/api/sync", {}, authorization),
    );

    expect(response.status).toBe(200);
    expect(captured).toEqual([authorization]);
  });

  it("fails closed on stale policy versions when serving sync reads", async () => {
    const { state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const response = await durableObject.fetch(
      createAuthorizedRequest(
        "https://graph-authority.local/api/sync",
        {},
        {
          ...testAuthorityAuthorization,
          policyVersion: 1,
        },
      ),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: expect.stringContaining("policy.stale_context"),
    });
  });

  it("proves two principals receive different sync payloads and direct-read outcomes for the same entity", async () => {
    const { state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(
      state,
      {},
      {
        createAuthority(storage, options) {
          return createWebAppAuthority(storage, {
            ...options,
            graph: visibilityProofGraph,
          });
        },
      },
    );
    const memberBaseline = await readSyncPayload(durableObject, undefined, testHumanAuthorization);
    const outsiderBaseline = await readSyncPayload(
      durableObject,
      undefined,
      testOutsiderAuthorization,
    );

    expect(memberBaseline.mode).toBe("total");
    expect(outsiderBaseline.mode).toBe("total");
    expect(memberBaseline.cursor).toBe(outsiderBaseline.cursor);

    const createdProbe = buildTransactionFromGraphSnapshot(
      memberBaseline.snapshot ?? { edges: [], retracted: [] },
      visibilityProofGraph,
      "tx:create-visibility-probe",
      (graph) =>
        graph.visibilityProbe.create({
          memberNote: "Visible only to graph members",
          name: "Read divergence proof",
        }),
    );

    await postTransaction(durableObject, createdProbe.transaction);

    const memberTotal = await readSyncPayload(durableObject, undefined, testHumanAuthorization);
    const outsiderTotal = await readSyncPayload(
      durableObject,
      undefined,
      testOutsiderAuthorization,
    );
    const memberIncremental = await readSyncPayload(
      durableObject,
      memberBaseline.cursor,
      testHumanAuthorization,
    );
    const outsiderIncremental = await readSyncPayload(
      durableObject,
      outsiderBaseline.cursor,
      testOutsiderAuthorization,
    );

    if (memberTotal.mode !== "total" || outsiderTotal.mode !== "total") {
      throw new Error("Expected total sync payloads for the visibility proof baseline.");
    }
    if (memberIncremental.mode !== "incremental" || "fallback" in memberIncremental) {
      throw new Error("Expected a data-bearing incremental sync payload for the graph member.");
    }
    if (outsiderIncremental.mode !== "incremental" || "fallback" in outsiderIncremental) {
      throw new Error("Expected a data-bearing incremental sync payload for the outsider.");
    }
    const memberSnapshot = memberTotal.snapshot;
    const outsiderSnapshot = outsiderTotal.snapshot;
    const memberTransactions = memberIncremental.transactions;
    const outsiderTransactions = outsiderIncremental.transactions;

    if (!memberSnapshot || !outsiderSnapshot || !memberTransactions || !outsiderTransactions) {
      throw new Error("Expected sync proof payloads to include snapshots and transactions.");
    }

    expect(
      memberSnapshot.edges.some(
        (edge) => edge.s === createdProbe.result && edge.p === visibilityProbeMemberNotePredicateId,
      ),
    ).toBe(true);
    expect(
      outsiderSnapshot.edges.some(
        (edge) => edge.s === createdProbe.result && edge.p === visibilityProbeMemberNotePredicateId,
      ),
    ).toBe(false);
    expect(outsiderSnapshot.edges.some((edge) => edge.s === createdProbe.result)).toBe(true);
    expect(
      memberTransactions[0]?.transaction.ops.some(
        (operation) =>
          operation.op === "assert" &&
          operation.edge.s === createdProbe.result &&
          operation.edge.p === visibilityProbeMemberNotePredicateId,
      ),
    ).toBe(true);
    expect(
      outsiderTransactions[0]?.transaction.ops.some(
        (operation) =>
          operation.op === "assert" &&
          operation.edge.s === createdProbe.result &&
          operation.edge.p === visibilityProbeMemberNotePredicateId,
      ),
    ).toBe(false);
    expect(
      outsiderTransactions[0]?.transaction.ops.some(
        (operation) => operation.op === "assert" && operation.edge.s === createdProbe.result,
      ),
    ).toBe(true);

    const authority = await getDurableAuthority<WebAppAuthority>(durableObject);
    expect(
      authority.readPredicateValue(createdProbe.result, visibilityProbeMemberNotePredicateId, {
        authorization: testHumanAuthorization,
      }),
    ).toBe("Visible only to graph members");

    try {
      authority.readPredicateValue(createdProbe.result, visibilityProbeMemberNotePredicateId, {
        authorization: testOutsiderAuthorization,
      });
      throw new Error("Expected direct protected reads to fail for the outsider principal.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "policy.read.forbidden",
        message: expect.stringContaining("policy.read.forbidden"),
        status: 403,
      });
    }
  });

  it("bootstraps the graph tables and indexes in the constructor", () => {
    const { db, state } = createSqliteDurableObjectState();

    createTestDurableObject(state);

    const entries = queryAll<SqliteMasterRow>(
      db,
      `SELECT type, name
      FROM sqlite_master
      WHERE name LIKE 'io_graph_%' OR name = 'io_secret_value'
      ORDER BY type ASC, name ASC`,
    );

    expect(entries).toEqual(
      expect.arrayContaining([
        { type: "table", name: "io_graph_meta" },
        { type: "table", name: "io_graph_tx" },
        { type: "table", name: "io_graph_tx_op" },
        { type: "table", name: "io_graph_edge" },
        { type: "table", name: "io_secret_value" },
        { type: "index", name: "io_graph_edge_subject_predicate_idx" },
        { type: "index", name: "io_graph_edge_predicate_object_idx" },
        { type: "index", name: "io_graph_edge_retracted_tx_seq_idx" },
      ]),
    );
  });

  it("keeps constructor setup synchronous and defers async hydration until the first request", async () => {
    const { getBlockConcurrencyWhileCount, state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);

    expect(getBlockConcurrencyWhileCount()).toBe(0);

    await readSyncPayload(durableObject);
    expect(getBlockConcurrencyWhileCount()).toBe(1);

    await readSyncPayload(durableObject);
    expect(getBlockConcurrencyWhileCount()).toBe(1);
  });

  it("accepts secret-field command envelopes over /api/commands", async () => {
    const { db, state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const initialSync = await readSyncPayload(durableObject);
    const createdEnvVar = buildTransactionFromSnapshot(
      initialSync.snapshot ?? { edges: [], retracted: [] },
      "tx:create-command-env-var",
      (graph) =>
        graph.envVar.create({
          description: "Shared command route credential",
          name: "OPENAI_API_KEY",
        }),
    );

    await postTransaction(durableObject, createdEnvVar.transaction);
    const commandResult = await postCommand(durableObject, {
      kind: "write-secret-field",
      input: {
        entityId: createdEnvVar.result,
        predicateId: envVarSecretPredicateId,
        plaintext: "sk-live-command-route",
      },
    });
    const txRows = queryAll<GraphTxRow>(
      db,
      `SELECT seq, tx_id, cursor, write_scope
      FROM io_graph_tx
      ORDER BY seq ASC`,
    );
    const restarted = createTestDurableObject(state);
    const incremental = await readSyncPayload(restarted, initialSync.cursor);
    const commandRow = txRows.at(-1);

    if (!commandRow) {
      throw new Error("Expected the shared command route to append a durable transaction.");
    }

    expect(commandResult).toMatchObject({
      created: true,
      entityId: createdEnvVar.result,
      predicateId: envVarSecretPredicateId,
      rotated: false,
      secretVersion: 1,
    });
    expect(
      queryAll<SecretValueRow>(
        db,
        `SELECT secret_id, value, version
        FROM io_secret_value`,
      ),
    ).toEqual([
      {
        secret_id: commandResult.secretId,
        value: "sk-live-command-route",
        version: 1,
      },
    ]);
    expect(commandRow).toEqual({
      seq: 2,
      tx_id: expect.stringContaining(
        `secret-field:${createdEnvVar.result}:${envVarSecretPredicateId}:`,
      ),
      cursor: commandRow.cursor,
      write_scope: "server-command",
    });
    expect(incremental.transactions).toEqual([
      expect.objectContaining({
        txId: "tx:create-command-env-var",
        writeScope: "client-tx",
      }),
      expect.objectContaining({
        txId: commandRow.tx_id,
        writeScope: "server-command",
      }),
    ]);
  });

  it("surfaces stable deny vocabulary for unauthorized transaction requests", async () => {
    const { state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const initialSync = await readSyncPayload(durableObject);
    const createdEnvVar = buildTransactionFromSnapshot(
      initialSync.snapshot ?? { edges: [], retracted: [] },
      "tx:forbidden-env-var",
      (graph) =>
        graph.envVar.create({
          description: "Blocked without authority access",
          name: "OPENAI_API_KEY",
        }),
    );

    const response = await durableObject.fetch(
      createAuthorizedRequest(
        "https://graph-authority.local/api/tx",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(createdEnvVar.transaction),
        },
        testHumanAuthorization,
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: expect.stringContaining("policy.write.forbidden"),
    });
  });

  it("surfaces stable deny vocabulary for unauthorized command requests", async () => {
    const { state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const initialSync = await readSyncPayload(durableObject);
    const createdEnvVar = buildTransactionFromSnapshot(
      initialSync.snapshot ?? { edges: [], retracted: [] },
      "tx:create-forbidden-command-env-var",
      (graph) =>
        graph.envVar.create({
          description: "Shared command route credential",
          name: "OPENAI_API_KEY",
        }),
    );

    await postTransaction(durableObject, createdEnvVar.transaction);

    const response = await durableObject.fetch(
      createAuthorizedRequest(
        "https://graph-authority.local/api/commands",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            kind: "write-secret-field",
            input: {
              entityId: createdEnvVar.result,
              predicateId: envVarSecretPredicateId,
              plaintext: "sk-live-command-route",
            },
          }),
        },
        testHumanAuthorization,
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: "policy.command.forbidden",
      error: expect.stringContaining("policy.command.forbidden"),
    });
  });

  it("returns 404 for the removed /api/secret-fields route", async () => {
    const { state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);

    const response = await durableObject.fetch(
      new Request("https://graph-authority.local/api/secret-fields", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          entityId: "entity-id",
          predicateId: envVarSecretPredicateId,
          plaintext: "sk-live-removed-route",
        }),
      }),
    );

    expect(response.status).toBe(404);
  });

  it("normalizes legacy SQL rows without write_scope to client-tx on restart", async () => {
    const { db, state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const initialSync = await readSyncPayload(durableObject);
    const createdEnvVar = buildTransactionFromSnapshot(
      initialSync.snapshot ?? { edges: [], retracted: [] },
      "tx:create-env-var",
      (graph) =>
        graph.envVar.create({
          description: "Legacy compatibility credential",
          name: "OPENAI_API_KEY",
        }),
    );
    const createdTx = await postTransaction(durableObject, createdEnvVar.transaction);
    await postSecretField(durableObject, {
      entityId: createdEnvVar.result,
      predicateId: envVarSecretPredicateId,
      plaintext: "sk-live-legacy",
    });
    const scopedRows = queryAll<GraphTxRow>(
      db,
      `SELECT seq, tx_id, cursor, write_scope
      FROM io_graph_tx
      ORDER BY seq ASC`,
    );
    const [clientTxRow, serverCommandRow] = scopedRows;

    if (!clientTxRow || !serverCommandRow) {
      throw new Error("Expected client and server-command history rows before legacy migration.");
    }

    expect(serverCommandRow.write_scope).toBe("server-command");

    db.query(`ALTER TABLE io_graph_tx RENAME TO io_graph_tx_with_scope`).run();
    db.query(
      `CREATE TABLE io_graph_tx (
        seq INTEGER PRIMARY KEY,
        tx_id TEXT NOT NULL UNIQUE,
        cursor TEXT NOT NULL UNIQUE,
        committed_at TEXT NOT NULL
      )`,
    ).run();
    db.query(
      `INSERT INTO io_graph_tx (seq, tx_id, cursor, committed_at)
      SELECT seq, tx_id, cursor, committed_at
      FROM io_graph_tx_with_scope`,
    ).run();
    db.query(`DROP TABLE io_graph_tx_with_scope`).run();

    const restarted = createTestDurableObject(state);
    const graphTxColumns = queryAll<{ name: string }>(db, `PRAGMA table_info(io_graph_tx)`);
    const legacyRows = queryAll<GraphTxRow>(
      db,
      `SELECT seq, tx_id, cursor, write_scope
      FROM io_graph_tx
      ORDER BY seq ASC`,
    );
    const incremental = await readSyncPayload(restarted, initialSync.cursor);

    expect(graphTxColumns.map((column) => column.name)).toContain("write_scope");
    expect(legacyRows).toEqual([
      {
        ...clientTxRow,
        write_scope: "client-tx",
      },
      {
        ...serverCommandRow,
        write_scope: "client-tx",
      },
    ]);
    expect(incremental.transactions).toEqual([
      expect.objectContaining({
        txId: createdTx.txId,
        writeScope: "client-tx",
      }),
      expect.objectContaining({
        txId: serverCommandRow.tx_id,
        writeScope: "client-tx",
      }),
    ]);
  });

  it("preserves hidden-only cursor advances through SQL-backed incremental sync after restart", async () => {
    const { db, state } = createSqliteDurableObjectState();
    const hiddenProbe = { entityId: null as string | null };
    const durableObject = createTestDurableObject(
      state,
      {},
      {
        createAuthority: createHiddenCursorAdvanceAuthorityFactory(hiddenProbe),
      },
    );
    const initialSync = await readSyncPayload(durableObject);
    const authority = await getDurableAuthority<{
      applyTransaction(
        transaction: GraphWriteTransaction,
        options?: {
          writeScope?: "authority-only" | "client-tx" | "server-command";
        },
      ): Promise<{
        cursor: string;
        replayed: boolean;
        txId: string;
        writeScope: "authority-only" | "client-tx" | "server-command";
      }>;
      store: {
        snapshot(): StoreSnapshot;
      };
    }>(durableObject);

    if (!hiddenProbe.entityId) {
      throw new Error("Expected the hidden cursor probe to be seeded.");
    }

    const hiddenResult = await authority.applyTransaction(
      buildHiddenCursorAdvanceTransaction(
        authority.store.snapshot(),
        hiddenProbe.entityId,
        "tx:hidden:1",
      ),
      {
        writeScope: "authority-only",
      },
    );
    const txRows = queryAll<GraphTxRow>(
      db,
      `SELECT seq, tx_id, cursor, write_scope
      FROM io_graph_tx
      ORDER BY seq ASC`,
    );
    const restarted = createTestDurableObject(
      state,
      {},
      {
        createAuthority: createHiddenCursorAdvanceAuthorityFactory(hiddenProbe),
      },
    );
    const incremental = await readSyncPayload(restarted, initialSync.cursor);

    expect(hiddenResult.writeScope).toBe("authority-only");
    expect(txRows).toEqual([
      {
        seq: 1,
        tx_id: "tx:hidden:1",
        cursor: hiddenResult.cursor,
        write_scope: "authority-only",
      },
    ]);
    expect(incremental.mode).toBe("incremental");
    expect(incremental.after).toBe(initialSync.cursor);
    expect(incremental.after).not.toBe(incremental.cursor);
    expect(incremental.cursor).toBe(hiddenResult.cursor);
    expect(incremental.transactions).toEqual([]);
  });

  it("falls back with gap when pruned hidden-only cursor advances fall behind retained history", async () => {
    const { db, state } = createSqliteDurableObjectState();
    const hiddenProbe = { entityId: null as string | null };
    const durableObject = createTestDurableObject(
      state,
      {
        GRAPH_AUTHORITY_MAX_RETAINED_TRANSACTIONS: 2,
      },
      {
        createAuthority: createHiddenCursorAdvanceAuthorityFactory(hiddenProbe),
      },
    );
    const initialSync = await readSyncPayload(durableObject);
    const authority = await getDurableAuthority<{
      applyTransaction(
        transaction: GraphWriteTransaction,
        options?: {
          writeScope?: "authority-only" | "client-tx" | "server-command";
        },
      ): Promise<{
        cursor: string;
        replayed: boolean;
        txId: string;
        writeScope: "authority-only" | "client-tx" | "server-command";
      }>;
      store: {
        snapshot(): StoreSnapshot;
      };
    }>(durableObject);

    if (!hiddenProbe.entityId) {
      throw new Error("Expected the hidden cursor probe to be seeded.");
    }

    const firstHidden = await authority.applyTransaction(
      buildHiddenCursorAdvanceTransaction(
        authority.store.snapshot(),
        hiddenProbe.entityId,
        "tx:hidden:1",
      ),
      {
        writeScope: "authority-only",
      },
    );
    const secondHidden = await authority.applyTransaction(
      buildHiddenCursorAdvanceTransaction(
        authority.store.snapshot(),
        hiddenProbe.entityId,
        "tx:hidden:2",
      ),
      {
        writeScope: "authority-only",
      },
    );
    const thirdHidden = await authority.applyTransaction(
      buildHiddenCursorAdvanceTransaction(
        authority.store.snapshot(),
        hiddenProbe.entityId,
        "tx:hidden:3",
      ),
      {
        writeScope: "authority-only",
      },
    );
    const txRows = queryAll<GraphTxRow>(
      db,
      `SELECT seq, tx_id, cursor, write_scope
      FROM io_graph_tx
      ORDER BY seq ASC`,
    );
    const metaRows = queryAll<{
      cursor_prefix: string;
      head_cursor: string;
      head_seq: number;
      history_retained_from_seq: number;
    }>(
      db,
      `SELECT cursor_prefix, head_seq, head_cursor, history_retained_from_seq
      FROM io_graph_meta
      WHERE id = 1`,
    );
    const gap = await readSyncPayload(durableObject, initialSync.cursor);
    const retained = await readSyncPayload(durableObject, firstHidden.cursor);
    const restarted = createTestDurableObject(
      state,
      {
        GRAPH_AUTHORITY_MAX_RETAINED_TRANSACTIONS: 2,
      },
      {
        createAuthority: createHiddenCursorAdvanceAuthorityFactory(hiddenProbe),
      },
    );
    const restartedGap = await readSyncPayload(restarted, initialSync.cursor);
    const restartedRetained = await readSyncPayload(restarted, firstHidden.cursor);

    expect(firstHidden.writeScope).toBe("authority-only");
    expect(secondHidden.writeScope).toBe("authority-only");
    expect(thirdHidden.writeScope).toBe("authority-only");
    expect(txRows).toEqual([
      {
        seq: 2,
        tx_id: "tx:hidden:2",
        cursor: secondHidden.cursor,
        write_scope: "authority-only",
      },
      {
        seq: 3,
        tx_id: "tx:hidden:3",
        cursor: thirdHidden.cursor,
        write_scope: "authority-only",
      },
    ]);
    expect(metaRows).toEqual([
      {
        cursor_prefix: metaRows[0]?.cursor_prefix ?? "",
        head_seq: 3,
        head_cursor: thirdHidden.cursor,
        history_retained_from_seq: 1,
      },
    ]);
    expect(gap).toMatchObject({
      mode: "incremental",
      after: initialSync.cursor,
      fallback: "gap",
      cursor: thirdHidden.cursor,
      transactions: [],
    });
    expect(retained).toMatchObject({
      mode: "incremental",
      after: firstHidden.cursor,
      cursor: thirdHidden.cursor,
      transactions: [],
    });
    expect(retained.fallback).toBeUndefined();
    expect(gap.cursor).not.toBe(gap.after);
    expect(retained.cursor).not.toBe(retained.after);
    expect(restartedGap).toMatchObject({
      mode: "incremental",
      after: initialSync.cursor,
      fallback: "gap",
      cursor: thirdHidden.cursor,
      transactions: [],
    });
    expect(restartedRetained).toMatchObject({
      mode: "incremental",
      after: firstHidden.cursor,
      cursor: thirdHidden.cursor,
      transactions: [],
    });
    expect(restartedRetained.fallback).toBeUndefined();
  });

  it("falls back with reset when a hidden-only baseline rewrite drops retained history", async () => {
    const { db, state } = createSqliteDurableObjectState();
    const hiddenProbe = { entityId: null as string | null };
    const durableObject = createTestDurableObject(
      state,
      {},
      {
        createAuthority: createHiddenCursorAdvanceAuthorityFactory(hiddenProbe),
      },
    );
    const initialSync = await readSyncPayload(durableObject);
    const authority = await getDurableAuthority<{
      applyTransaction(
        transaction: GraphWriteTransaction,
        options?: {
          writeScope?: "authority-only" | "client-tx" | "server-command";
        },
      ): Promise<{
        cursor: string;
        replayed: boolean;
        txId: string;
        writeScope: "authority-only" | "client-tx" | "server-command";
      }>;
      persist(): Promise<void>;
      store: {
        snapshot(): StoreSnapshot;
      };
    }>(durableObject);

    if (!hiddenProbe.entityId) {
      throw new Error("Expected the hidden cursor probe to be seeded.");
    }

    const hiddenResult = await authority.applyTransaction(
      buildHiddenCursorAdvanceTransaction(
        authority.store.snapshot(),
        hiddenProbe.entityId,
        "tx:hidden:reset:1",
      ),
      {
        writeScope: "authority-only",
      },
    );
    const retained = await readSyncPayload(durableObject, initialSync.cursor);

    await authority.persist();

    const txCount = queryAll<{ count: number }>(db, `SELECT COUNT(*) AS count FROM io_graph_tx`);
    const metaRows = queryAll<{
      cursor_prefix: string;
      head_cursor: string;
      head_seq: number;
      history_retained_from_seq: number;
    }>(
      db,
      `SELECT cursor_prefix, head_seq, head_cursor, history_retained_from_seq
      FROM io_graph_meta
      WHERE id = 1`,
    );
    const restarted = createTestDurableObject(
      state,
      {},
      {
        createAuthority: createHiddenCursorAdvanceAuthorityFactory(hiddenProbe),
      },
    );
    const restartedSync = await readSyncPayload(restarted);
    const reset = await readSyncPayload(restarted, initialSync.cursor);
    const metaRow = metaRows[0];

    if (!metaRow) {
      throw new Error("Expected durable graph metadata after the baseline rewrite.");
    }

    expect(hiddenResult.writeScope).toBe("authority-only");
    expect(retained).toMatchObject({
      mode: "incremental",
      after: initialSync.cursor,
      cursor: hiddenResult.cursor,
      transactions: [],
    });
    expect(retained.fallback).toBeUndefined();
    expect(txCount).toEqual([{ count: 0 }]);
    expect(metaRows).toHaveLength(1);
    expect(metaRow.head_seq).toBe(0);
    expect(metaRow.history_retained_from_seq).toBe(0);
    expect(restartedSync.cursor).toBe(metaRow.head_cursor);
    expect(restartedSync.cursor).not.toBe(hiddenResult.cursor);
    expect(reset).toMatchObject({
      mode: "incremental",
      after: initialSync.cursor,
      fallback: "reset",
      cursor: restartedSync.cursor,
      transactions: [],
    });
    expect(reset.cursor).not.toBe(reset.after);
  });

  it("persists accepted graph transactions as ordered rows and hydrates from SQL after restart", async () => {
    const { db, state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const initialSync = await readSyncPayload(durableObject);
    const envVarWrite = buildTransactionFromSnapshot(
      initialSync.snapshot ?? { edges: [], retracted: [] },
      "tx:create-env-var",
      (graph) =>
        graph.envVar.create({
          description: "Primary model credential",
          name: "OPENAI_API_KEY",
        }),
    );
    const createdTx = await postTransaction(durableObject, envVarWrite.transaction);
    const replayedTx = await postTransaction(durableObject, envVarWrite.transaction);
    const afterCreateRows = queryAll<GraphTxRow>(
      db,
      `SELECT seq, tx_id, cursor, write_scope
      FROM io_graph_tx
      ORDER BY seq ASC`,
    );
    const secretWrite = await postSecretField(durableObject, {
      entityId: envVarWrite.result,
      predicateId: envVarSecretPredicateId,
      plaintext: "sk-live-first",
    });
    const txRows = queryAll<GraphTxRow>(
      db,
      `SELECT seq, tx_id, cursor, write_scope
      FROM io_graph_tx
      ORDER BY seq ASC`,
    );
    const txOpRows = queryAll<GraphTxOpRow>(
      db,
      `SELECT tx_seq, op_index, op_kind, edge_id
      FROM io_graph_tx_op
      ORDER BY tx_seq ASC, op_index ASC`,
    );
    const secretEdge = queryAll<GraphEdgeRow>(
      db,
      `SELECT edge_id, s, p, o, retracted_tx_seq
      FROM io_graph_edge
      WHERE s = ? AND p = ?`,
      envVarWrite.result,
      envVarSecretPredicateId,
    );
    const secretRows = queryAll<SecretValueRow>(
      db,
      `SELECT secret_id, value, version
      FROM io_secret_value`,
    );
    const metaRows = queryAll<{
      cursor_prefix: string;
      head_cursor: string;
      head_seq: number;
      history_retained_from_seq: number;
    }>(
      db,
      `SELECT cursor_prefix, head_seq, head_cursor, history_retained_from_seq
      FROM io_graph_meta
      WHERE id = 1`,
    );
    const latestTx = txRows[1];
    const secretEdgeRow = secretEdge[0];
    const metaRow = metaRows[0];
    const restarted = createTestDurableObject(state);
    const restartedSync = await readSyncPayload(restarted);
    const incremental = await readSyncPayload(restarted, initialSync.cursor);

    if (!latestTx) throw new Error("Expected the secret-field transaction row.");
    if (!secretEdgeRow) throw new Error("Expected the current env var secret edge row.");
    if (!metaRow) throw new Error("Expected durable graph metadata.");

    expect(createdTx).toMatchObject({
      txId: "tx:create-env-var",
      replayed: false,
    });
    expect(replayedTx).toMatchObject({
      txId: "tx:create-env-var",
      replayed: true,
      cursor: createdTx.cursor,
    });
    expect(afterCreateRows).toHaveLength(1);
    expect(txRows).toHaveLength(2);
    expect(txRows.map((row) => row.seq)).toEqual([1, 2]);
    expect(txRows[0]).toMatchObject({
      seq: 1,
      tx_id: "tx:create-env-var",
      cursor: createdTx.cursor,
      write_scope: "client-tx",
    });
    expect(
      latestTx.tx_id.startsWith(`secret-field:${envVarWrite.result}:${envVarSecretPredicateId}:`),
    ).toBe(true);
    expect(latestTx.write_scope).toBe("server-command");
    expect(txOpRows.filter((row) => row.tx_seq === 1).map((row) => row.op_index)).toEqual([
      ...txOpRows.filter((row) => row.tx_seq === 1).keys(),
    ]);
    expect(txOpRows.filter((row) => row.tx_seq === 2).map((row) => row.op_index)).toEqual([
      ...txOpRows.filter((row) => row.tx_seq === 2).keys(),
    ]);
    expect(secretWrite).toMatchObject({
      created: true,
      entityId: envVarWrite.result,
      predicateId: envVarSecretPredicateId,
      rotated: false,
      secretVersion: 1,
    });
    expect(secretEdge).toEqual([
      {
        edge_id: secretEdgeRow.edge_id,
        s: envVarWrite.result,
        p: envVarSecretPredicateId,
        o: secretWrite.secretId,
        retracted_tx_seq: null,
      },
    ]);
    expect(secretRows).toEqual([
      {
        secret_id: secretWrite.secretId,
        value: "sk-live-first",
        version: 1,
      },
    ]);
    expect(metaRows).toEqual([
      {
        cursor_prefix: metaRow.cursor_prefix,
        head_seq: 2,
        head_cursor: latestTx.cursor,
        history_retained_from_seq: 0,
      },
    ]);
    expect(restartedSync.cursor).toBe(latestTx.cursor);
    expect(JSON.stringify(restartedSync)).not.toContain("sk-live-first");
    expect(incremental.transactions).toEqual([
      expect.objectContaining({
        txId: "tx:create-env-var",
        writeScope: "client-tx",
      }),
      expect.objectContaining({
        txId: latestTx.tx_id,
        writeScope: "server-command",
      }),
    ]);
  });

  it("preserves secret side-table rows across graph-only commits and baseline persists", async () => {
    const { db, state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const initialSync = await readSyncPayload(durableObject);
    const createdEnvVar = buildTransactionFromSnapshot(
      initialSync.snapshot ?? { edges: [], retracted: [] },
      "tx:create-env-var",
      (graph) =>
        graph.envVar.create({
          description: "Primary model credential",
          name: "OPENAI_API_KEY",
        }),
    );

    await postTransaction(durableObject, createdEnvVar.transaction);
    const secretWrite = await postSecretField(durableObject, {
      entityId: createdEnvVar.result,
      predicateId: envVarSecretPredicateId,
      plaintext: "sk-live-first",
    });
    const secretRowsBeforeGraphUpdate = queryAll<Required<SecretValueRow>>(
      db,
      `SELECT rowid, secret_id, value, version, stored_at
      FROM io_secret_value`,
    );
    const secretRowBeforeGraphUpdate = secretRowsBeforeGraphUpdate[0];

    const afterCreateSync = await readSyncPayload(durableObject);
    const renameEnvVar = buildTransactionFromSnapshot(
      afterCreateSync.snapshot ?? { edges: [], retracted: [] },
      "tx:update-env-var",
      (graph) =>
        graph.envVar.update(createdEnvVar.result, {
          description: "Primary model credential (renamed)",
        }),
    );

    await postTransaction(durableObject, renameEnvVar.transaction);

    const secretRowsAfterGraphUpdate = queryAll<Required<SecretValueRow>>(
      db,
      `SELECT rowid, secret_id, value, version, stored_at
      FROM io_secret_value`,
    );
    const authority = await getDurableAuthority(durableObject);

    await authority.persist();

    const secretRowsAfterPersist = queryAll<Required<SecretValueRow>>(
      db,
      `SELECT rowid, secret_id, value, version, stored_at
      FROM io_secret_value`,
    );

    if (!secretRowBeforeGraphUpdate) {
      throw new Error("Expected the initial secret side-table row.");
    }

    expect(secretWrite.secretVersion).toBe(1);
    expect(secretRowsBeforeGraphUpdate).toEqual([
      {
        rowid: secretRowBeforeGraphUpdate.rowid,
        secret_id: secretWrite.secretId,
        value: "sk-live-first",
        version: 1,
        stored_at: secretRowBeforeGraphUpdate.stored_at,
      },
    ]);
    expect(secretRowsAfterGraphUpdate).toEqual(secretRowsBeforeGraphUpdate);
    expect(secretRowsAfterPersist).toEqual(secretRowsBeforeGraphUpdate);
  });

  it("rolls back graph and secret rows together when the secret side-table write fails", async () => {
    const { db, setExecHook, state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const initialSync = await readSyncPayload(durableObject);
    const createdEnvVar = buildTransactionFromSnapshot(
      initialSync.snapshot ?? { edges: [], retracted: [] },
      "tx:create-env-var",
      (graph) =>
        graph.envVar.create({
          description: "Primary model credential",
          name: "OPENAI_API_KEY",
        }),
    );

    await postTransaction(durableObject, createdEnvVar.transaction);

    setExecHook((query) => {
      if (query.includes("INSERT INTO io_secret_value")) {
        throw new Error("forced secret side-table failure");
      }
    });

    await expect(
      postSecretField(durableObject, {
        entityId: createdEnvVar.result,
        predicateId: envVarSecretPredicateId,
        plaintext: "sk-live-first",
      }),
    ).rejects.toThrow("forced secret side-table failure");

    setExecHook(null);

    const txRows = queryAll<GraphTxRow>(
      db,
      `SELECT seq, tx_id, cursor
      FROM io_graph_tx
      ORDER BY seq ASC`,
    );
    const secretEdgeRows = queryAll<GraphEdgeRow>(
      db,
      `SELECT edge_id, s, p, o, retracted_tx_seq
      FROM io_graph_edge
      WHERE s = ? AND p = ?`,
      createdEnvVar.result,
      envVarSecretPredicateId,
    );
    const secretRows = queryAll<SecretValueRow>(
      db,
      `SELECT secret_id, value, version
      FROM io_secret_value`,
    );
    const afterFailureSync = await readSyncPayload(durableObject);

    expect(txRows).toHaveLength(1);
    expect(txRows[0]?.tx_id).toBe("tx:create-env-var");
    expect(secretEdgeRows).toEqual([]);
    expect(secretRows).toEqual([]);
    expect(
      afterFailureSync.snapshot?.edges.some(
        (edge) => edge.s === createdEnvVar.result && edge.p === envVarSecretPredicateId,
      ),
    ).toBe(false);
  });

  it("rolls back graph rows when a SQL commit fails after graph inserts begin", async () => {
    const { db, setExecHook, state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const initialSync = await readSyncPayload(durableObject);
    const createdEnvVar = buildTransactionFromSnapshot(
      initialSync.snapshot ?? { edges: [], retracted: [] },
      "tx:create-env-var",
      (graph) =>
        graph.envVar.create({
          description: "Primary model credential",
          name: "OPENAI_API_KEY",
        }),
    );

    setExecHook((query) => {
      if (query.includes("INSERT INTO io_graph_meta")) {
        throw new Error("forced graph meta failure");
      }
    });

    await expect(postTransaction(durableObject, createdEnvVar.transaction)).rejects.toThrow(
      "forced graph meta failure",
    );

    setExecHook(null);

    const txRows = queryAll<GraphTxRow>(
      db,
      `SELECT seq, tx_id, cursor
      FROM io_graph_tx
      ORDER BY seq ASC`,
    );
    const createdEntityRows = queryAll<GraphEdgeRow>(
      db,
      `SELECT edge_id, s, p, o, retracted_tx_seq
      FROM io_graph_edge
      WHERE s = ?`,
      createdEnvVar.result,
    );
    const afterFailureSync = await readSyncPayload(durableObject);

    expect(txRows).toEqual([]);
    expect(createdEntityRows).toEqual([]);
    expect(afterFailureSync.snapshot?.edges.some((edge) => edge.s === createdEnvVar.result)).toBe(
      false,
    );
  });

  it("hydrates retracted edge order from SQL rows after restart", async () => {
    const { state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const initialSync = await readSyncPayload(durableObject);
    const createdEnvVar = buildTransactionFromSnapshot(
      initialSync.snapshot ?? { edges: [], retracted: [] },
      "tx:create-env-var",
      (graph) =>
        graph.envVar.create({
          description: "Primary model credential",
          name: "OPENAI_API_KEY",
        }),
    );

    await postTransaction(durableObject, createdEnvVar.transaction);

    const afterCreateSync = await readSyncPayload(durableObject);
    const renameEnvVar = buildTransactionFromSnapshot(
      afterCreateSync.snapshot ?? { edges: [], retracted: [] },
      "tx:update-env-var",
      (graph) =>
        graph.envVar.update(createdEnvVar.result, {
          description: "Primary model credential (rotated)",
        }),
    );

    await postTransaction(durableObject, renameEnvVar.transaction);

    const authority = await getDurableAuthority(durableObject);
    const snapshotBeforeRestart = authority.readSnapshot({
      authorization: testAuthorityAuthorization,
    });
    const restarted = createTestDurableObject(state);
    const restartedSync = await readSyncPayload(restarted);

    expect(snapshotBeforeRestart.retracted.length).toBeGreaterThan(1);
    expect(restartedSync.snapshot).toEqual(snapshotBeforeRestart);
  });

  it("preserves retracted snapshot edges when a baseline rewrite drops retained history", async () => {
    const { db, state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const initialSync = await readSyncPayload(durableObject);
    const createdEnvVar = buildTransactionFromSnapshot(
      initialSync.snapshot ?? { edges: [], retracted: [] },
      "tx:create-env-var",
      (graph) =>
        graph.envVar.create({
          description: "Primary model credential",
          name: "OPENAI_API_KEY",
        }),
    );

    await postTransaction(durableObject, createdEnvVar.transaction);

    const afterCreateSync = await readSyncPayload(durableObject);
    const renameEnvVar = buildTransactionFromSnapshot(
      afterCreateSync.snapshot ?? { edges: [], retracted: [] },
      "tx:update-env-var",
      (graph) =>
        graph.envVar.update(createdEnvVar.result, {
          description: "Primary model credential (rotated)",
        }),
    );

    const updatedTx = await postTransaction(durableObject, renameEnvVar.transaction);
    const authority = await getDurableAuthority(durableObject);
    const snapshotBeforePersist = authority.readSnapshot({
      authorization: testAuthorityAuthorization,
    });

    expect(snapshotBeforePersist.retracted.length).toBeGreaterThan(0);

    await authority.persist();

    const txCount = queryAll<{ count: number }>(db, `SELECT COUNT(*) AS count FROM io_graph_tx`);
    const retractedRows = queryAll<GraphEdgeRow>(
      db,
      `SELECT edge_id, retracted_tx_seq
      FROM io_graph_edge
      WHERE retracted_tx_seq IS NOT NULL
      ORDER BY retracted_tx_seq ASC, rowid ASC`,
    );
    const restarted = createTestDurableObject(state);
    const restartedSync = await readSyncPayload(restarted);
    const reset = await readSyncPayload(restarted, updatedTx.cursor);

    expect(txCount).toEqual([{ count: 0 }]);
    expect(retractedRows).toHaveLength(snapshotBeforePersist.retracted.length);
    expect(restartedSync.snapshot).toEqual(snapshotBeforePersist);
    expect(reset).toMatchObject({
      fallback: "reset",
      transactions: [],
    });
  });

  it("rewrites a reset baseline when retained transaction rows no longer reach the hydrated snapshot", async () => {
    const { db, state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const initialSync = await readSyncPayload(durableObject);
    const createdEnvVar = buildTransactionFromSnapshot(
      initialSync.snapshot ?? { edges: [], retracted: [] },
      "tx:create-env-var",
      (graph) =>
        graph.envVar.create({
          description: "Primary model credential",
          name: "OPENAI_API_KEY",
        }),
    );
    const createdTx = await postTransaction(durableObject, createdEnvVar.transaction);
    const secretWrite = await postSecretField(durableObject, {
      entityId: createdEnvVar.result,
      predicateId: envVarSecretPredicateId,
      plaintext: "sk-live-first",
    });
    const expectedSnapshot = (await readSyncPayload(durableObject)).snapshot;

    db.query(`DELETE FROM io_graph_tx_op WHERE tx_seq = 2`).run();
    db.query(`DELETE FROM io_graph_tx WHERE seq = 2`).run();

    const restarted = createTestDurableObject(state);
    const restartedSync = await readSyncPayload(restarted);
    const reset = await readSyncPayload(restarted, createdTx.cursor);
    const txCount = queryAll<{ count: number }>(db, `SELECT COUNT(*) AS count FROM io_graph_tx`);
    const metaRows = queryAll<{
      cursor_prefix: string;
      head_cursor: string;
      head_seq: number;
      history_retained_from_seq: number;
    }>(
      db,
      `SELECT cursor_prefix, head_seq, head_cursor, history_retained_from_seq
      FROM io_graph_meta
      WHERE id = 1`,
    );

    expect(secretWrite.secretVersion).toBe(1);
    expect(restartedSync.snapshot).toEqual(expectedSnapshot);
    expect(restartedSync.cursor).not.toBe(createdTx.cursor);
    expect(txCount).toEqual([{ count: 0 }]);
    expect(metaRows).toHaveLength(1);
    expect(metaRows[0]?.head_seq).toBe(0);
    expect(metaRows[0]?.history_retained_from_seq).toBe(0);
    expect(reset).toMatchObject({
      fallback: "reset",
      transactions: [],
    });
  });

  it("prunes retained transaction rows and falls back for old or unknown cursors", async () => {
    const { db, state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state, {
      GRAPH_AUTHORITY_MAX_RETAINED_TRANSACTIONS: 2,
    });
    const initialSync = await readSyncPayload(durableObject);
    const createdEnvVar = buildTransactionFromSnapshot(
      initialSync.snapshot ?? { edges: [], retracted: [] },
      "tx:create-env-var",
      (graph) =>
        graph.envVar.create({
          description: "Primary model credential",
          name: "OPENAI_API_KEY",
        }),
    );
    const createdTx = await postTransaction(durableObject, createdEnvVar.transaction);
    const afterCreateSync = await readSyncPayload(durableObject);
    const firstUpdate = buildTransactionFromSnapshot(
      afterCreateSync.snapshot ?? { edges: [], retracted: [] },
      "tx:update-env-var:1",
      (graph) =>
        graph.envVar.update(createdEnvVar.result, {
          description: "Primary model credential (rotated once)",
        }),
    );
    const updatedTx = await postTransaction(durableObject, firstUpdate.transaction);
    const afterFirstUpdateSync = await readSyncPayload(durableObject);
    const secondUpdate = buildTransactionFromSnapshot(
      afterFirstUpdateSync.snapshot ?? { edges: [], retracted: [] },
      "tx:update-env-var:2",
      (graph) =>
        graph.envVar.update(createdEnvVar.result, {
          description: "Primary model credential (rotated twice)",
        }),
    );
    const latestTx = await postTransaction(durableObject, secondUpdate.transaction);
    const txRows = queryAll<GraphTxRow>(
      db,
      `SELECT seq, tx_id, cursor, write_scope
      FROM io_graph_tx
      ORDER BY seq ASC`,
    );
    const txOpSequences = queryAll<{ tx_seq: number }>(
      db,
      `SELECT DISTINCT tx_seq
      FROM io_graph_tx_op
      ORDER BY tx_seq ASC`,
    );
    const metaRows = queryAll<{
      cursor_prefix: string;
      head_cursor: string;
      head_seq: number;
      history_retained_from_seq: number;
    }>(
      db,
      `SELECT cursor_prefix, head_seq, head_cursor, history_retained_from_seq
      FROM io_graph_meta
      WHERE id = 1`,
    );
    const gap = await readSyncPayload(durableObject, initialSync.cursor);
    const retained = await readSyncPayload(durableObject, createdTx.cursor);
    const unknown = await readSyncPayload(durableObject, "web-authority:unknown");
    const restarted = createTestDurableObject(state, {
      GRAPH_AUTHORITY_MAX_RETAINED_TRANSACTIONS: 2,
    });
    const restartedGap = await readSyncPayload(restarted, initialSync.cursor);
    const restartedRetained = await readSyncPayload(restarted, createdTx.cursor);

    expect(txRows).toEqual([
      {
        seq: 2,
        tx_id: "tx:update-env-var:1",
        cursor: updatedTx.cursor,
        write_scope: "client-tx",
      },
      {
        seq: 3,
        tx_id: "tx:update-env-var:2",
        cursor: latestTx.cursor,
        write_scope: "client-tx",
      },
    ]);
    expect(txOpSequences).toEqual([{ tx_seq: 2 }, { tx_seq: 3 }]);
    expect(metaRows).toEqual([
      {
        cursor_prefix: metaRows[0]?.cursor_prefix ?? "",
        head_seq: 3,
        head_cursor: latestTx.cursor,
        history_retained_from_seq: 1,
      },
    ]);
    expect(gap).toMatchObject({
      fallback: "gap",
      cursor: latestTx.cursor,
      transactions: [],
    });
    expect(retained.transactions?.map((transaction) => transaction.txId)).toEqual([
      "tx:update-env-var:1",
      "tx:update-env-var:2",
    ]);
    expect(unknown).toMatchObject({
      fallback: "unknown-cursor",
      cursor: latestTx.cursor,
      transactions: [],
    });
    expect(restartedGap).toMatchObject({
      fallback: "gap",
      cursor: latestTx.cursor,
      transactions: [],
    });
    expect(restartedRetained.transactions?.map((transaction) => transaction.txId)).toEqual([
      "tx:update-env-var:1",
      "tx:update-env-var:2",
    ]);
  });
});
