import { Database } from "bun:sqlite";
import { describe, expect, it, setDefaultTimeout } from "bun:test";

import {
  bootstrap,
  createIdMap,
  createPersistedAuthoritativeGraph,
  createStore,
  createTypeClient,
  defineNamespace,
  defineSecretField,
  defineType,
  edgeId,
  type AuthoritativeGraphRetainedHistoryPolicy,
  type AuthSubjectRef,
  type AnyTypeOutput,
  type AuthorizationContext,
  type GraphWriteTransaction,
  type NamespaceClient,
  type PersistedAuthoritativeGraphStorage,
  type StoreSnapshot,
} from "@io/core/graph";
import { core } from "@io/core/graph/modules";
import { ops } from "@io/core/graph/modules/ops";
import {
  workflowReviewModuleReadScope,
  workflowReviewSyncScopeRequest,
} from "@io/core/graph/modules/ops/workflow";
import { pkm } from "@io/core/graph/modules/pkm";

import {
  createBearerShareAuthorizationContext,
  createAnonymousAuthorizationContext,
  issueBearerShareToken,
  type SessionPrincipalLookupInput,
} from "./auth-bridge.js";
import { createTestWebAppAuthority, createTestWorkflowFixture } from "./authority-test-helpers.js";
import {
  createWebAppAuthority,
  type WebAppAuthority,
  type WebAppAuthorityStorage,
} from "./authority.js";
import {
  WebGraphAuthorityDurableObject,
  webGraphAuthorityBearerShareLookupPath,
  webGraphAuthoritySessionPrincipalLookupPath,
} from "./graph-authority-do.js";
import {
  encodeRequestAuthorizationContext,
  webAppAuthorizationContextHeader,
} from "./server-routes.js";
import { webWorkflowLivePath, type WorkflowLiveResponse } from "./workflow-live-transport.js";
import { webWorkflowReadPath, type WorkflowReadResponse } from "./workflow-transport.js";

setDefaultTimeout(20_000);

const productGraph = { ...core, ...pkm, ...ops } as const;
const envVarSecretPredicateId = edgeId(ops.envVar.fields.secret);
const workflowModuleScope = workflowReviewSyncScopeRequest;
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
const secretNote = defineType({
  values: { key: "test:secretNote", name: "Secret Note" },
  fields: {
    ...core.node.fields,
    secret: defineSecretField({
      range: core.secretHandle,
      cardinality: "one?",
      meta: {
        label: "Credential",
      },
      revealCapability: "secret:reveal",
      rotateCapability: "secret:rotate",
    }),
  },
});
const secretNoteNamespace = defineNamespace(createIdMap({ secretNote }).map, {
  secretNote,
});
const secretNoteGraph = { ...productGraph, ...secretNoteNamespace } as const;
const secretNoteSecretPredicateId = edgeId(secretNote.fields.secret);
const capabilityNote = defineType({
  values: { key: "test:capabilityNote", name: "Capability Note" },
  fields: {
    readNote: {
      ...core.node.fields.description,
      key: "test:capabilityNote:readNote",
      authority: {
        visibility: "replicated",
        write: "authority-only",
        policy: {
          readAudience: "capability",
          writeAudience: "authority",
          shareable: false,
          requiredCapabilities: ["test.capability.note.read"],
        },
      },
      meta: {
        ...core.node.fields.description.meta,
        label: "Read-gated note",
      },
    },
    writeNote: {
      ...core.node.fields.description,
      key: "test:capabilityNote:writeNote",
      authority: {
        visibility: "replicated",
        write: "client-tx",
        policy: {
          readAudience: "public",
          writeAudience: "capability",
          shareable: false,
          requiredCapabilities: ["test.capability.note.write"],
        },
      },
      meta: {
        ...core.node.fields.description.meta,
        label: "Write-gated note",
      },
    },
  },
});
const capabilityNoteNamespace = defineNamespace(createIdMap({ capabilityNote }).map, {
  capabilityNote,
});
const capabilityProofGraph = { ...productGraph, ...capabilityNoteNamespace } as const;
const capabilityReadNotePredicateId = edgeId(capabilityNote.fields.readNote);
const shareableNote = defineType({
  values: { key: "test:shareableNote", name: "Shareable Note" },
  fields: {
    sharedNote: {
      ...core.node.fields.description,
      key: "test:shareableNote:sharedNote",
      authority: {
        visibility: "replicated",
        write: "authority-only",
        policy: {
          readAudience: "graph-member",
          writeAudience: "authority",
          shareable: true,
        },
      },
      meta: {
        ...core.node.fields.description.meta,
        label: "Shared note",
      },
    },
    otherSharedNote: {
      ...core.node.fields.description,
      key: "test:shareableNote:otherSharedNote",
      authority: {
        visibility: "replicated",
        write: "authority-only",
        policy: {
          readAudience: "graph-member",
          writeAudience: "authority",
          shareable: true,
        },
      },
      meta: {
        ...core.node.fields.description.meta,
        label: "Other shared note",
      },
    },
  },
});
const shareableNoteNamespace = defineNamespace(createIdMap({ shareableNote }).map, {
  shareableNote,
});
const shareableProofGraph = { ...productGraph, ...shareableNoteNamespace } as const;
const shareableSharedNotePredicateId = edgeId(shareableNote.fields.sharedNote);
const shareableOtherSharedNotePredicateId = edgeId(shareableNote.fields.otherSharedNote);

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
  readonly scope?: {
    readonly kind: "graph" | "module";
    readonly moduleId?: string;
    readonly scopeId?: string;
    readonly definitionHash?: string;
    readonly policyFilterVersion?: string;
  };
  readonly after?: string;
  readonly cursor: string;
  readonly fallback?: "gap" | "reset" | "unknown-cursor" | "scope-changed" | "policy-changed";
  readonly completeness?: "complete" | "incomplete";
  readonly freshness?: "current" | "stale";
  readonly diagnostics?: {
    readonly retainedBaseCursor: string;
    readonly retainedHistoryPolicy:
      | {
          readonly kind: "all";
        }
      | {
          readonly kind: "transaction-count";
          readonly maxTransactions: number;
        };
  };
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

function createProjectedAuthorizationContext(
  lookupInput: SessionPrincipalLookupInput,
  projection: {
    readonly principalId: string;
    readonly principalKind: AuthorizationContext["principalKind"];
    readonly roleKeys?: readonly string[];
    readonly capabilityGrantIds?: readonly string[];
    readonly capabilityVersion?: number;
  },
): AuthorizationContext {
  return {
    ...testAuthorization,
    graphId: lookupInput.graphId,
    principalId: projection.principalId,
    principalKind: projection.principalKind,
    roleKeys: [...(projection.roleKeys ?? [])],
    sessionId: "session:browser",
    capabilityGrantIds: [...(projection.capabilityGrantIds ?? [])],
    capabilityVersion: projection.capabilityVersion ?? 0,
  };
}

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

function encodeRetainedHistoryPolicy(policy: AuthoritativeGraphRetainedHistoryPolicy): string {
  return JSON.stringify(policy);
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

function createSessionPrincipalLookupInput(
  overrides: {
    readonly graphId?: string;
    readonly subject?: Partial<AuthSubjectRef>;
  } = {},
): SessionPrincipalLookupInput {
  return {
    graphId: overrides.graphId ?? "graph:test",
    subject: {
      issuer: "better-auth",
      provider: "user",
      providerAccountId: "user-1",
      authUserId: "auth-user-1",
      ...overrides.subject,
    },
  };
}

function createSessionPrincipalLookupRequest(
  input: SessionPrincipalLookupInput,
  init: RequestInit = {},
): Request {
  return new Request(
    `https://graph-authority.local${webGraphAuthoritySessionPrincipalLookupPath}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
      ...init,
    },
  );
}

function createBearerShareLookupRequest(
  input: {
    readonly graphId: string;
    readonly tokenHash: string;
  },
  init: RequestInit = {},
): Request {
  return new Request(`https://graph-authority.local${webGraphAuthorityBearerShareLookupPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
    ...init,
  });
}

function readProductGraph(authority: WebAppAuthority, authorization: AuthorizationContext) {
  return createTypeClient(createStore(authority.readSnapshot({ authorization })), productGraph);
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

function buildRetractSecretReferenceTransaction(
  snapshot: StoreSnapshot,
  entityId: string,
  txId: string,
): GraphWriteTransaction {
  const mutationStore = createStore(snapshot);
  const before = mutationStore.snapshot();

  for (const edge of mutationStore.facts(entityId, envVarSecretPredicateId)) {
    mutationStore.retract(edge.id);
  }

  return buildGraphWriteTransaction(before, mutationStore.snapshot(), txId);
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
    options: { readonly retainedHistoryPolicy?: AuthoritativeGraphRetainedHistoryPolicy },
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
      retainedHistoryPolicy: options.retainedHistoryPolicy,
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

function updateScopedCursor(cursor: string, updates: Record<string, string>): string {
  if (!cursor.startsWith("scope:")) {
    throw new Error(`Expected a scoped cursor, received "${cursor}".`);
  }

  const params = new URLSearchParams(cursor.slice("scope:".length));
  for (const [key, value] of Object.entries(updates)) {
    params.set(key, value);
  }
  return `scope:${params.toString()}`;
}

async function readSyncPayload(
  durableObject: WebGraphAuthorityDurableObject,
  after?: string,
  authorization: AuthorizationContext = testAuthorityAuthorization,
  scope?: typeof workflowModuleScope,
): Promise<SyncPayload> {
  const url = new URL("https://graph-authority.local/api/sync");
  if (after) url.searchParams.set("after", after);
  if (scope) {
    url.searchParams.set("scopeKind", scope.kind);
    url.searchParams.set("moduleId", scope.moduleId);
    url.searchParams.set("scopeId", scope.scopeId);
  }
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

async function postWorkflowRead(
  durableObject: WebGraphAuthorityDurableObject,
  request: {
    readonly kind: "project-branch-scope" | "commit-queue-scope";
    readonly query: Record<string, unknown>;
  },
  authorization: AuthorizationContext = testAuthorityAuthorization,
): Promise<{
  readonly response: Response;
  readonly payload: WorkflowReadResponse | { readonly code?: string; readonly error?: string };
}> {
  const response = await durableObject.fetch(
    createAuthorizedRequest(
      `https://graph-authority.local${webWorkflowReadPath}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
      },
      authorization,
    ),
  );

  const payload = (await response.json()) as
    | WorkflowReadResponse
    | { readonly code?: string; readonly error?: string };

  return { response, payload };
}

async function postWorkflowLive(
  durableObject: WebGraphAuthorityDurableObject,
  request:
    | {
        readonly kind: "workflow-review-register";
        readonly cursor: string;
      }
    | {
        readonly kind: "workflow-review-pull";
        readonly scopeId: string;
      }
    | {
        readonly kind: "workflow-review-remove";
        readonly scopeId: string;
      },
  authorization: AuthorizationContext = testAuthorityAuthorization,
): Promise<{
  readonly response: Response;
  readonly payload: WorkflowLiveResponse | { readonly code?: string; readonly error?: string };
}> {
  const response = await durableObject.fetch(
    createAuthorizedRequest(
      `https://graph-authority.local${webWorkflowLivePath}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
      },
      authorization,
    ),
  );

  const payload = (await response.json()) as
    | WorkflowLiveResponse
    | { readonly code?: string; readonly error?: string };

  return { response, payload };
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

async function applyServerCommandTransaction(
  authority: WebAppAuthority,
  transaction: GraphWriteTransaction,
): Promise<void> {
  await authority.applyTransaction(transaction, {
    authorization: testAuthorityAuthorization,
    writeScope: "server-command",
  });
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

  it("repairs first-use principals through the internal lookup route and reuses them idempotently", async () => {
    const { state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const lookupInput = createSessionPrincipalLookupInput();
    const firstResponse = await durableObject.fetch(
      createSessionPrincipalLookupRequest(lookupInput),
    );
    const secondResponse = await durableObject.fetch(
      createSessionPrincipalLookupRequest(lookupInput),
    );
    const first = (await firstResponse.json()) as {
      readonly principalId: string;
      readonly principalKind: string;
    };
    const second = (await secondResponse.json()) as typeof first;
    const authority = await getDurableAuthority<WebAppAuthority>(durableObject);
    const persistedGraph = readProductGraph(authority, testAuthorityAuthorization);
    const repairedProjection = persistedGraph.authSubjectProjection.list()[0];

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      principalKind: "human",
    });
    expect(persistedGraph.principal.list()).toHaveLength(1);
    expect(persistedGraph.authSubjectProjection.list()).toHaveLength(1);
    expect(repairedProjection).toMatchObject({
      authUserId: lookupInput.subject.authUserId,
      principal: first.principalId,
      providerAccountId: lookupInput.subject.providerAccountId,
      status: core.authSubjectStatus.values.active.id,
    });
  });

  it("returns explicit conflict failures from the internal lookup route", async () => {
    const { state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const authority = await getDurableAuthority<WebAppAuthority>(durableObject);
    const lookupInput = createSessionPrincipalLookupInput({
      subject: {
        providerAccountId: "user-1:slack",
      },
    });
    const seeded = buildTransactionFromSnapshot(
      authority.readSnapshot({ authorization: testAuthorityAuthorization }),
      "tx:create-conflicting-auth-user-projections",
      (graph) => {
        const firstPrincipalId = graph.principal.create({
          homeGraphId: lookupInput.graphId,
          kind: core.principalKind.values.human.id,
          name: "First Principal",
          status: core.principalStatus.values.active.id,
        });
        const secondPrincipalId = graph.principal.create({
          homeGraphId: lookupInput.graphId,
          kind: core.principalKind.values.human.id,
          name: "Second Principal",
          status: core.principalStatus.values.active.id,
        });

        graph.authSubjectProjection.create({
          authUserId: lookupInput.subject.authUserId,
          issuer: lookupInput.subject.issuer,
          mirroredAt: new Date("2026-03-24T00:00:00.000Z"),
          name: "First Subject",
          principal: firstPrincipalId,
          provider: lookupInput.subject.provider,
          providerAccountId: "user-1:first",
          status: core.authSubjectStatus.values.active.id,
        });
        graph.authSubjectProjection.create({
          authUserId: lookupInput.subject.authUserId,
          issuer: lookupInput.subject.issuer,
          mirroredAt: new Date("2026-03-24T00:00:00.000Z"),
          name: "Second Subject",
          principal: secondPrincipalId,
          provider: lookupInput.subject.provider,
          providerAccountId: "user-1:second",
          status: core.authSubjectStatus.values.active.id,
        });
      },
    );

    await authority.applyTransaction(seeded.transaction, {
      authorization: testAuthorityAuthorization,
      writeScope: "authority-only",
    });

    const response = await durableObject.fetch(createSessionPrincipalLookupRequest(lookupInput));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "auth.principal_missing",
      error: expect.stringContaining(`"${lookupInput.subject.authUserId}"`),
    });
  });

  it("resolves active bearer share grants through the internal hash lookup route", async () => {
    const { state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(
      state,
      {},
      {
        createAuthority(storage, options) {
          return createWebAppAuthority(storage, {
            ...options,
            graph: shareableProofGraph,
          });
        },
      },
    );
    const authority = await getDurableAuthority<WebAppAuthority>(durableObject);
    const ownerProjection = await authority.lookupSessionPrincipal(
      createSessionPrincipalLookupInput(),
    );
    const issued = await issueBearerShareToken();
    const createdNote = buildTransactionFromGraphSnapshot(
      authority.readSnapshot({ authorization: testAuthorityAuthorization }),
      shareableProofGraph,
      "tx:create-bearer-lookup-shareable-note",
      (graph) =>
        graph.shareableNote.create({
          sharedNote: "Durable bearer share",
        }),
    );

    await authority.applyTransaction(createdNote.transaction, {
      authorization: testAuthorityAuthorization,
      writeScope: "authority-only",
    });

    const grantedShare = buildTransactionFromGraphSnapshot(
      authority.readSnapshot({ authorization: testAuthorityAuthorization }),
      shareableProofGraph,
      "tx:grant-bearer-lookup-shareable-note-read",
      (graph) => {
        const shareSurfaceId = "surface:shareable-note:bearer-shared-note";
        const capabilityGrantId = graph.capabilityGrant.create({
          bearerTokenHash: issued.tokenHash,
          constraintExpiresAt: new Date(Date.now() + 60_000),
          constraintPredicateId: [shareableSharedNotePredicateId],
          constraintRootEntityId: createdNote.result,
          grantedByPrincipal: ownerProjection.principalId,
          name: "Bearer shareable note read",
          resourceKind: core.capabilityGrantResourceKind.values.shareSurface.id,
          resourceSurfaceId: shareSurfaceId,
          status: core.capabilityGrantStatus.values.active.id,
          targetKind: core.capabilityGrantTargetKind.values.bearer.id,
        });

        graph.shareGrant.create({
          capabilityGrant: capabilityGrantId,
          name: "Bearer shareable note grant",
          status: core.capabilityGrantStatus.values.active.id,
          surfaceId: shareSurfaceId,
          surfaceKind: core.shareSurfaceKind.values.entityPredicateSlice.id,
          surfacePredicateId: [shareableSharedNotePredicateId],
          surfaceRootEntityId: createdNote.result,
        });
      },
    );

    await authority.applyTransaction(grantedShare.transaction, {
      authorization: testAuthorityAuthorization,
      writeScope: "authority-only",
    });

    const response = await durableObject.fetch(
      createBearerShareLookupRequest({
        graphId: "graph:test",
        tokenHash: issued.tokenHash,
      }),
    );
    const projection = (await response.json()) as {
      readonly capabilityGrantIds: readonly string[];
    };
    const bearerAuthorization = createBearerShareAuthorizationContext({
      graphId: "graph:test",
      policyVersion: 0,
      capabilityGrantIds: projection.capabilityGrantIds,
    });
    const sync = await readSyncPayload(durableObject, undefined, bearerAuthorization);

    expect(response.status).toBe(200);
    expect(projection.capabilityGrantIds).toHaveLength(1);
    expect(
      sync.snapshot?.edges.some(
        (edge) =>
          edge.s === createdNote.result &&
          edge.p === shareableSharedNotePredicateId &&
          edge.o === "Durable bearer share",
      ),
    ).toBe(true);
  });

  it("rejects revoked bearer share grants through the internal hash lookup route", async () => {
    const { state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(
      state,
      {},
      {
        createAuthority(storage, options) {
          return createWebAppAuthority(storage, {
            ...options,
            graph: shareableProofGraph,
          });
        },
      },
    );
    const authority = await getDurableAuthority<WebAppAuthority>(durableObject);
    const ownerProjection = await authority.lookupSessionPrincipal(
      createSessionPrincipalLookupInput(),
    );
    const issued = await issueBearerShareToken();
    const createdNote = buildTransactionFromGraphSnapshot(
      authority.readSnapshot({ authorization: testAuthorityAuthorization }),
      shareableProofGraph,
      "tx:create-revoked-bearer-shareable-note",
      (graph) =>
        graph.shareableNote.create({
          sharedNote: "Revoked durable bearer share",
        }),
    );

    await authority.applyTransaction(createdNote.transaction, {
      authorization: testAuthorityAuthorization,
      writeScope: "authority-only",
    });

    const grantedShare = buildTransactionFromGraphSnapshot(
      authority.readSnapshot({ authorization: testAuthorityAuthorization }),
      shareableProofGraph,
      "tx:grant-revoked-bearer-shareable-note-read",
      (graph) => {
        const shareSurfaceId = "surface:shareable-note:revoked-bearer-shared-note";
        const capabilityGrantId = graph.capabilityGrant.create({
          bearerTokenHash: issued.tokenHash,
          constraintExpiresAt: new Date(Date.now() + 60_000),
          constraintPredicateId: [shareableSharedNotePredicateId],
          constraintRootEntityId: createdNote.result,
          grantedByPrincipal: ownerProjection.principalId,
          name: "Revoked bearer shareable note read",
          resourceKind: core.capabilityGrantResourceKind.values.shareSurface.id,
          resourceSurfaceId: shareSurfaceId,
          status: core.capabilityGrantStatus.values.active.id,
          targetKind: core.capabilityGrantTargetKind.values.bearer.id,
        });

        return {
          shareGrantId: graph.shareGrant.create({
            capabilityGrant: capabilityGrantId,
            name: "Revoked bearer shareable note grant",
            status: core.capabilityGrantStatus.values.active.id,
            surfaceId: shareSurfaceId,
            surfaceKind: core.shareSurfaceKind.values.entityPredicateSlice.id,
            surfacePredicateId: [shareableSharedNotePredicateId],
            surfaceRootEntityId: createdNote.result,
          }),
        };
      },
    );

    await authority.applyTransaction(grantedShare.transaction, {
      authorization: testAuthorityAuthorization,
      writeScope: "authority-only",
    });

    const revokedShare = buildTransactionFromGraphSnapshot(
      authority.readSnapshot({ authorization: testAuthorityAuthorization }),
      shareableProofGraph,
      "tx:revoke-bearer-lookup-shareable-note-read",
      (graph) =>
        graph.shareGrant.update(grantedShare.result.shareGrantId, {
          status: core.capabilityGrantStatus.values.revoked.id,
        }),
    );

    await authority.applyTransaction(revokedShare.transaction, {
      authorization: testAuthorityAuthorization,
      writeScope: "authority-only",
    });

    const response = await durableObject.fetch(
      createBearerShareLookupRequest({
        graphId: "graph:test",
        tokenHash: issued.tokenHash,
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: "grant.invalid",
      error: expect.stringContaining("revoked"),
    });
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

  it("serves project branch scope reads over the durable workflow route", async () => {
    const { state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const authority = await getDurableAuthority<WebAppAuthority>(durableObject);
    const fixture = await createTestWorkflowFixture(authority, testAuthorityAuthorization);
    const { payload, response } = await postWorkflowRead(durableObject, {
      kind: "project-branch-scope",
      query: {
        projectId: fixture.projectId,
        filter: {
          showUnmanagedRepositoryBranches: true,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      kind: "project-branch-scope",
      result: {
        project: {
          id: fixture.projectId,
        },
        repository: {
          id: fixture.repositoryId,
        },
        rows: [
          {
            workflowBranch: {
              id: fixture.branchId,
            },
            repositoryBranch: {
              repositoryBranch: {
                id: fixture.repositoryBranchId,
              },
            },
          },
        ],
        unmanagedRepositoryBranches: [],
      },
    });
  });

  it("serves commit queue scope reads over the durable workflow route", async () => {
    const { state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const authority = await getDurableAuthority<WebAppAuthority>(durableObject);
    const fixture = await createTestWorkflowFixture(authority, testAuthorityAuthorization);
    const createdCommit = (await authority.executeCommand(
      {
        kind: "workflow-mutation",
        input: {
          action: "createCommit",
          branchId: fixture.branchId,
          title: "Transport-backed commit queue read",
          commitKey: "commit:transport-backed-read",
          order: 0,
          state: "ready",
        },
      },
      {
        authorization: testAuthorityAuthorization,
      },
    )) as { readonly summary: { readonly id: string } };
    const { payload, response } = await postWorkflowRead(durableObject, {
      kind: "commit-queue-scope",
      query: {
        branchId: fixture.branchId,
        limit: 5,
      },
    });

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      kind: "commit-queue-scope",
      result: {
        branch: {
          workflowBranch: {
            id: fixture.branchId,
          },
        },
        rows: [
          {
            workflowCommit: {
              id: createdCommit.summary.id,
            },
          },
        ],
      },
    });
  });

  it("registers and removes workflow review live scope interest over the durable workflow live route", async () => {
    const { state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const authority = await getDurableAuthority<WebAppAuthority>(durableObject);
    await createTestWorkflowFixture(authority, testAuthorityAuthorization);
    const total = await readSyncPayload(
      durableObject,
      undefined,
      testAuthorityAuthorization,
      workflowModuleScope,
    );
    const registered = await postWorkflowLive(durableObject, {
      kind: "workflow-review-register",
      cursor: total.cursor,
    });
    const removed = await postWorkflowLive(durableObject, {
      kind: "workflow-review-remove",
      scopeId: workflowReviewModuleReadScope.scopeId,
    });

    expect(registered.response.status).toBe(200);
    expect(registered.payload).toMatchObject({
      kind: "workflow-review-register",
      result: {
        registrationId: `workflow-review:${testAuthorityAuthorization.sessionId}:${workflowReviewModuleReadScope.scopeId}`,
        sessionId: testAuthorityAuthorization.sessionId,
        principalId: testAuthorityAuthorization.principalId,
        scopeId: workflowReviewModuleReadScope.scopeId,
        definitionHash: workflowReviewModuleReadScope.definitionHash,
        policyFilterVersion: "policy:0",
      },
    });
    expect(removed.response.status).toBe(200);
    expect(removed.payload).toEqual({
      kind: "workflow-review-remove",
      result: {
        removed: true,
        scopeId: workflowReviewModuleReadScope.scopeId,
        sessionId: testAuthorityAuthorization.sessionId,
      },
    });
  });

  it("delivers workflow review invalidations and recovers with scoped re-pull after router loss", async () => {
    const { state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    let authority = await getDurableAuthority<WebAppAuthority>(durableObject);
    const fixture = await createTestWorkflowFixture(authority, testAuthorityAuthorization);
    const total = await readSyncPayload(
      durableObject,
      undefined,
      testAuthorityAuthorization,
      workflowModuleScope,
    );

    await postWorkflowLive(durableObject, {
      kind: "workflow-review-register",
      cursor: total.cursor,
    });

    const firstCommit = (await authority.executeCommand(
      {
        kind: "workflow-mutation",
        input: {
          action: "createCommit",
          branchId: fixture.branchId,
          title: "Durable workflow live invalidation",
          commitKey: "commit:durable-workflow-live-invalidation",
          order: 0,
          state: "ready",
        },
      },
      {
        authorization: testAuthorityAuthorization,
      },
    )) as { readonly cursor: string; readonly summary: { readonly id: string } };
    const delivered = await postWorkflowLive(durableObject, {
      kind: "workflow-review-pull",
      scopeId: workflowReviewModuleReadScope.scopeId,
    });

    expect(delivered.response.status).toBe(200);
    expect(delivered.payload).toMatchObject({
      kind: "workflow-review-pull",
      result: {
        active: true,
        scopeId: workflowReviewModuleReadScope.scopeId,
        sessionId: testAuthorityAuthorization.sessionId,
        invalidations: [
          {
            sourceCursor: firstCommit.cursor,
            dependencyKeys: [
              "scope:ops/workflow:review",
              "projection:ops/workflow:project-branch-board",
              "projection:ops/workflow:branch-commit-queue",
            ],
            affectedScopeIds: [workflowReviewModuleReadScope.scopeId],
            delivery: { kind: "cursor-advanced" },
          },
        ],
      },
    });

    const firstRefresh = await readSyncPayload(
      durableObject,
      total.cursor,
      testAuthorityAuthorization,
      workflowModuleScope,
    );

    if (firstRefresh.mode !== "incremental" || "fallback" in firstRefresh) {
      throw new Error("Expected a scoped incremental refresh after live invalidation.");
    }
    if (!firstRefresh.transactions) {
      throw new Error("Expected scoped incremental transactions after live invalidation.");
    }

    expect(firstRefresh.scope).toMatchObject({
      kind: "module",
      moduleId: workflowModuleScope.moduleId,
      scopeId: workflowModuleScope.scopeId,
    });
    expect(firstRefresh.transactions).toHaveLength(1);
    expect(
      firstRefresh.transactions[0]?.transaction.ops.some(
        (operation) =>
          operation.op === "assert" &&
          operation.edge.s === firstCommit.summary.id &&
          operation.edge.p === edgeId(core.node.fields.name),
      ),
    ).toBe(true);

    const restarted = createTestDurableObject(state);
    authority = await getDurableAuthority<WebAppAuthority>(restarted);
    const secondCommit = (await authority.executeCommand(
      {
        kind: "workflow-mutation",
        input: {
          action: "createCommit",
          branchId: fixture.branchId,
          title: "Durable workflow live recovery",
          commitKey: "commit:durable-workflow-live-recovery",
          order: 1,
          state: "ready",
        },
      },
      {
        authorization: testAuthorityAuthorization,
      },
    )) as { readonly summary: { readonly id: string } };

    const missed = await postWorkflowLive(restarted, {
      kind: "workflow-review-pull",
      scopeId: workflowReviewModuleReadScope.scopeId,
    });

    expect(missed.response.status).toBe(200);
    expect(missed.payload).toEqual({
      kind: "workflow-review-pull",
      result: {
        active: false,
        invalidations: [],
        scopeId: workflowReviewModuleReadScope.scopeId,
        sessionId: testAuthorityAuthorization.sessionId,
      },
    });

    const reregistered = await postWorkflowLive(restarted, {
      kind: "workflow-review-register",
      cursor: firstRefresh.cursor,
    });

    expect(reregistered.response.status).toBe(200);

    const recovered = await readSyncPayload(
      restarted,
      firstRefresh.cursor,
      testAuthorityAuthorization,
      workflowModuleScope,
    );

    if (recovered.mode !== "incremental" || "fallback" in recovered) {
      throw new Error("Expected router-loss recovery to stay on the scoped incremental path.");
    }
    if (!recovered.transactions) {
      throw new Error("Expected scoped incremental transactions after router-loss recovery.");
    }

    expect(recovered.scope).toEqual(firstRefresh.scope);
    expect(recovered.transactions).toHaveLength(1);
    expect(
      recovered.transactions[0]?.transaction.ops.some(
        (operation) =>
          operation.op === "assert" &&
          operation.edge.s === secondCommit.summary.id &&
          operation.edge.p === edgeId(core.node.fields.name),
      ),
    ).toBe(true);
  });

  it("surfaces stable workflow live policy drift failures over the durable route", async () => {
    const { state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const authority = await getDurableAuthority<WebAppAuthority>(durableObject);
    await createTestWorkflowFixture(authority, testAuthorityAuthorization);
    const total = await readSyncPayload(
      durableObject,
      undefined,
      testAuthorityAuthorization,
      workflowModuleScope,
    );
    const response = await postWorkflowLive(durableObject, {
      kind: "workflow-review-register",
      cursor: updateScopedCursor(total.cursor, {
        policyFilterVersion: "policy:999",
      }),
    });

    expect(response.response.status).toBe(409);
    expect(response.payload).toEqual({
      error: expect.stringContaining('policy "policy:999"'),
      code: "policy-changed",
    });
  });

  it("serves the first workflow module scope through the durable sync route", async () => {
    const { state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const authority = await getDurableAuthority<WebAppAuthority>(durableObject);
    const fixture = await createTestWorkflowFixture(authority, testAuthorityAuthorization);
    const total = await readSyncPayload(
      durableObject,
      undefined,
      testAuthorityAuthorization,
      workflowModuleScope,
    );

    if (total.mode !== "total") {
      throw new Error("Expected a scoped total sync payload.");
    }

    expect(total).toMatchObject({
      scope: {
        kind: "module",
        moduleId: workflowModuleScope.moduleId,
        scopeId: workflowModuleScope.scopeId,
        definitionHash: workflowReviewModuleReadScope.definitionHash,
        policyFilterVersion: "policy:0",
      },
      completeness: "complete",
      freshness: "current",
    });
    if (!total.snapshot) {
      throw new Error("Expected the scoped total payload to include a snapshot.");
    }
    expect(total.snapshot.edges.some((edge) => edge.s === fixture.branchId)).toBe(true);

    const createdCommit = (await authority.executeCommand(
      {
        kind: "workflow-mutation",
        input: {
          action: "createCommit",
          branchId: fixture.branchId,
          title: "Durable scoped incremental",
          commitKey: "commit:durable-scoped-incremental",
          order: 0,
          state: "ready",
        },
      },
      {
        authorization: testAuthorityAuthorization,
      },
    )) as { readonly summary: { readonly id: string } };

    const incremental = await readSyncPayload(
      durableObject,
      total.cursor,
      testAuthorityAuthorization,
      workflowModuleScope,
    );

    if (incremental.mode !== "incremental" || "fallback" in incremental) {
      throw new Error("Expected a data-bearing scoped incremental payload.");
    }

    expect(incremental.scope).toEqual(total.scope);
    if (!incremental.transactions) {
      throw new Error("Expected scoped incremental transactions.");
    }
    expect(incremental.transactions).toHaveLength(1);
    expect(
      incremental.transactions[0]?.transaction.ops.some(
        (operation) =>
          operation.op === "assert" &&
          operation.edge.s === createdCommit.summary.id &&
          operation.edge.p === edgeId(core.node.fields.name),
      ),
    ).toBe(true);
  });

  it("returns scoped fallback from the durable sync route and keeps whole-graph recovery explicit", async () => {
    const { state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const authority = await getDurableAuthority<WebAppAuthority>(durableObject);
    const fixture = await createTestWorkflowFixture(authority, testAuthorityAuthorization);
    const envVarWrite = buildTransactionFromSnapshot(
      authority.readSnapshot({ authorization: testAuthorityAuthorization }),
      "tx:create-env-var:scoped-recovery",
      (graph) =>
        graph.envVar.create({
          description: "Only whole-graph recovery should include this env var.",
          name: "OPENAI_API_KEY",
        }),
    );
    await postTransaction(durableObject, envVarWrite.transaction);

    const scopedTotal = await readSyncPayload(
      durableObject,
      undefined,
      testAuthorityAuthorization,
      workflowModuleScope,
    );

    if (scopedTotal.mode !== "total") {
      throw new Error("Expected a scoped total sync payload.");
    }

    expect(scopedTotal.snapshot?.edges.some((edge) => edge.s === fixture.branchId)).toBe(true);
    expect(scopedTotal.snapshot?.edges.some((edge) => edge.s === envVarWrite.result)).toBe(false);

    const staleCursor = updateScopedCursor(scopedTotal.cursor, {
      policyFilterVersion: "policy:999",
    });
    const fallback = await readSyncPayload(
      durableObject,
      staleCursor,
      testAuthorityAuthorization,
      workflowModuleScope,
    );

    expect(fallback).toMatchObject({
      mode: "incremental",
      scope: scopedTotal.scope,
      after: staleCursor,
      cursor: scopedTotal.cursor,
      fallback: "policy-changed",
      completeness: "complete",
      freshness: "current",
      transactions: [],
    });

    const recovered = await readSyncPayload(durableObject, undefined, testAuthorityAuthorization);

    expect(recovered).toMatchObject({
      mode: "total",
      scope: {
        kind: "graph",
      },
      completeness: "complete",
      freshness: "current",
    });
    expect(recovered.snapshot?.edges.some((edge) => edge.s === fixture.branchId)).toBe(true);
    expect(recovered.snapshot?.edges.some((edge) => edge.s === envVarWrite.result)).toBe(true);
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

  it("threads principal-target capability grants into sync and direct-read authorization", async () => {
    const { state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(
      state,
      {},
      {
        createAuthority(storage, options) {
          return createWebAppAuthority(storage, {
            ...options,
            graph: capabilityProofGraph,
          });
        },
      },
    );
    const authority = await getDurableAuthority<WebAppAuthority>(durableObject);
    const lookupInput = createSessionPrincipalLookupInput();
    const initialProjection = await authority.lookupSessionPrincipal(lookupInput);
    const createdNote = buildTransactionFromGraphSnapshot(
      authority.readSnapshot({ authorization: testAuthorityAuthorization }),
      capabilityProofGraph,
      "tx:create-capability-proof-note",
      (graph) => graph.capabilityNote.create({}),
    );

    await authority.applyTransaction(createdNote.transaction, {
      authorization: testAuthorityAuthorization,
      writeScope: "authority-only",
    });
    const seedSetup = buildTransactionFromSnapshot(
      authority.readSnapshot({ authorization: testAuthorityAuthorization }),
      "tx:grant-capability-proof-seed-write",
      (graph) => ({
        roleBindingId: graph.principalRoleBinding.create({
          name: "Capability proof authority seed role",
          principal: initialProjection.principalId,
          roleKey: "graph:authority",
          status: core.principalRoleBindingStatus.values.active.id,
        }),
        grantId: graph.capabilityGrant.create({
          grantedByPrincipal: initialProjection.principalId,
          name: "Capability proof seed write grant",
          resourceKind: core.capabilityGrantResourceKind.values.predicateWrite.id,
          resourcePredicateId: capabilityReadNotePredicateId,
          status: core.capabilityGrantStatus.values.active.id,
          targetKind: core.capabilityGrantTargetKind.values.principal.id,
          targetPrincipal: initialProjection.principalId,
        }),
      }),
    );

    await authority.applyTransaction(seedSetup.transaction, {
      authorization: testAuthorityAuthorization,
      writeScope: "authority-only",
    });

    const seededProjection = await authority.lookupSessionPrincipal(lookupInput);
    const seededAuthorization = createProjectedAuthorizationContext(lookupInput, seededProjection);
    const seedValueTransaction = buildTransactionFromGraphSnapshot(
      authority.readSnapshot({ authorization: testAuthorityAuthorization }),
      capabilityProofGraph,
      "tx:seed-capability-proof-read-note",
      (graph) =>
        graph.capabilityNote.update(createdNote.result, {
          readNote: "Capability-gated sync note",
        }),
    );

    await authority.applyTransaction(seedValueTransaction.transaction, {
      authorization: seededAuthorization,
      writeScope: "authority-only",
    });
    const deniedTotal = await readSyncPayload(durableObject, undefined, seededAuthorization);

    if (deniedTotal.mode !== "total") {
      throw new Error("Expected a total sync payload before read grants are applied.");
    }

    expect(
      deniedTotal.snapshot?.edges.some(
        (edge) => edge.s === createdNote.result && edge.p === capabilityReadNotePredicateId,
      ),
    ).toBe(false);
    try {
      authority.readPredicateValue(createdNote.result, capabilityReadNotePredicateId, {
        authorization: seededAuthorization,
      });
      throw new Error("Expected direct protected reads to fail before the read grant is applied.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "policy.read.forbidden",
        message: expect.stringContaining("policy.read.forbidden"),
        status: 403,
      });
    }

    const readGrant = buildTransactionFromSnapshot(
      authority.readSnapshot({ authorization: testAuthorityAuthorization }),
      "tx:grant-capability-proof-read",
      (graph) =>
        graph.capabilityGrant.create({
          grantedByPrincipal: initialProjection.principalId,
          name: "Capability proof read grant",
          resourceKind: core.capabilityGrantResourceKind.values.predicateRead.id,
          resourcePredicateId: capabilityReadNotePredicateId,
          status: core.capabilityGrantStatus.values.active.id,
          targetKind: core.capabilityGrantTargetKind.values.principal.id,
          targetPrincipal: initialProjection.principalId,
        }),
    );

    await authority.applyTransaction(readGrant.transaction, {
      authorization: testAuthorityAuthorization,
      writeScope: "authority-only",
    });

    const refreshedProjection = await authority.lookupSessionPrincipal(lookupInput);
    const refreshedAuthorization = createProjectedAuthorizationContext(
      lookupInput,
      refreshedProjection,
    );
    const grantedTotal = await readSyncPayload(durableObject, undefined, refreshedAuthorization);

    if (grantedTotal.mode !== "total") {
      throw new Error("Expected a total sync payload after capability grants are applied.");
    }

    expect(
      grantedTotal.snapshot?.edges.some(
        (edge) =>
          edge.s === createdNote.result &&
          edge.p === capabilityReadNotePredicateId &&
          edge.o === "Capability-gated sync note",
      ),
    ).toBe(true);
    expect(
      authority.readPredicateValue(createdNote.result, capabilityReadNotePredicateId, {
        authorization: refreshedAuthorization,
      }),
    ).toBe("Capability-gated sync note");
  });

  it("applies principal-target share grants to delegated sync and direct reads", async () => {
    const { state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(
      state,
      {},
      {
        createAuthority(storage, options) {
          return createWebAppAuthority(storage, {
            ...options,
            graph: shareableProofGraph,
          });
        },
      },
    );
    const authority = await getDurableAuthority<WebAppAuthority>(durableObject);
    const ownerLookupInput = createSessionPrincipalLookupInput();
    const delegateLookupInput = createSessionPrincipalLookupInput({
      subject: {
        providerAccountId: "user-2",
        authUserId: "auth-user-2",
      },
    });
    const ownerProjection = await authority.lookupSessionPrincipal(ownerLookupInput);
    const initialDelegateProjection = await authority.lookupSessionPrincipal(delegateLookupInput);
    const createdNote = buildTransactionFromGraphSnapshot(
      authority.readSnapshot({ authorization: testAuthorityAuthorization }),
      shareableProofGraph,
      "tx:create-shareable-note",
      (graph) =>
        graph.shareableNote.create({
          sharedNote: "Shared before grant",
          otherSharedNote: "Always private",
        }),
    );

    await authority.applyTransaction(createdNote.transaction, {
      authorization: testAuthorityAuthorization,
      writeScope: "authority-only",
    });

    const initialDelegateAuthorization = createProjectedAuthorizationContext(
      delegateLookupInput,
      initialDelegateProjection,
    );
    const deniedTotal = await readSyncPayload(
      durableObject,
      undefined,
      initialDelegateAuthorization,
    );

    if (deniedTotal.mode !== "total") {
      throw new Error("Expected a total sync payload before the share grant is applied.");
    }

    expect(
      deniedTotal.snapshot?.edges.some(
        (edge) =>
          edge.s === createdNote.result &&
          (edge.p === shareableSharedNotePredicateId ||
            edge.p === shareableOtherSharedNotePredicateId),
      ),
    ).toBe(false);
    try {
      authority.readPredicateValue(createdNote.result, shareableSharedNotePredicateId, {
        authorization: initialDelegateAuthorization,
      });
      throw new Error("Expected shared-note direct reads to fail before the share grant.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "policy.read.forbidden",
        message: expect.stringContaining("policy.read.forbidden"),
        status: 403,
      });
    }

    const grantedShare = buildTransactionFromGraphSnapshot(
      authority.readSnapshot({ authorization: testAuthorityAuthorization }),
      shareableProofGraph,
      "tx:grant-shareable-note-read",
      (graph) => {
        const shareSurfaceId = "surface:shareable-note:shared-note";
        const capabilityGrantId = graph.capabilityGrant.create({
          grantedByPrincipal: ownerProjection.principalId,
          name: "Delegated shareable note read",
          resourceKind: core.capabilityGrantResourceKind.values.shareSurface.id,
          resourceSurfaceId: shareSurfaceId,
          constraintRootEntityId: createdNote.result,
          constraintPredicateId: [shareableSharedNotePredicateId],
          status: core.capabilityGrantStatus.values.active.id,
          targetKind: core.capabilityGrantTargetKind.values.principal.id,
          targetPrincipal: initialDelegateProjection.principalId,
        });

        return {
          capabilityGrantId,
          shareGrantId: graph.shareGrant.create({
            capabilityGrant: capabilityGrantId,
            name: "Delegated shareable note grant",
            status: core.capabilityGrantStatus.values.active.id,
            surfaceId: shareSurfaceId,
            surfaceKind: core.shareSurfaceKind.values.entityPredicateSlice.id,
            surfacePredicateId: [shareableSharedNotePredicateId],
            surfaceRootEntityId: createdNote.result,
          }),
        };
      },
    );

    await authority.applyTransaction(grantedShare.transaction, {
      authorization: testAuthorityAuthorization,
      writeScope: "authority-only",
    });

    const refreshedDelegateProjection = await authority.lookupSessionPrincipal(delegateLookupInput);
    const refreshedDelegateAuthorization = createProjectedAuthorizationContext(
      delegateLookupInput,
      refreshedDelegateProjection,
    );
    const grantedTotal = await readSyncPayload(
      durableObject,
      undefined,
      refreshedDelegateAuthorization,
    );
    const grantedIncremental = await readSyncPayload(
      durableObject,
      deniedTotal.cursor,
      refreshedDelegateAuthorization,
    );

    if (grantedTotal.mode !== "total") {
      throw new Error("Expected a total sync payload after the share grant is applied.");
    }
    if (
      grantedIncremental.mode !== "incremental" ||
      !("fallback" in grantedIncremental) ||
      grantedIncremental.fallback !== "reset"
    ) {
      throw new Error("Expected delegated sharing to force total-sync recovery.");
    }
    if (!grantedTotal.snapshot) {
      throw new Error("Expected delegated share proofs to include a total snapshot.");
    }

    expect(
      grantedTotal.snapshot.edges.some(
        (edge) =>
          edge.s === createdNote.result &&
          edge.p === shareableSharedNotePredicateId &&
          edge.o === "Shared before grant",
      ),
    ).toBe(true);
    expect(
      grantedTotal.snapshot.edges.some(
        (edge) => edge.s === createdNote.result && edge.p === shareableOtherSharedNotePredicateId,
      ),
    ).toBe(false);
    expect(
      authority.readPredicateValue(createdNote.result, shareableSharedNotePredicateId, {
        authorization: refreshedDelegateAuthorization,
      }),
    ).toBe("Shared before grant");
    try {
      authority.readPredicateValue(createdNote.result, shareableOtherSharedNotePredicateId, {
        authorization: refreshedDelegateAuthorization,
      });
      throw new Error("Expected non-shared predicates to remain forbidden.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "policy.read.forbidden",
        message: expect.stringContaining("policy.read.forbidden"),
        status: 403,
      });
    }

    const revokedShare = buildTransactionFromGraphSnapshot(
      authority.readSnapshot({ authorization: testAuthorityAuthorization }),
      shareableProofGraph,
      "tx:revoke-shareable-note-read",
      (graph) =>
        graph.shareGrant.update(grantedShare.result.shareGrantId, {
          status: core.capabilityGrantStatus.values.revoked.id,
        }),
    );

    await authority.applyTransaction(revokedShare.transaction, {
      authorization: testAuthorityAuthorization,
      writeScope: "authority-only",
    });

    const revokedTotal = await readSyncPayload(
      durableObject,
      undefined,
      refreshedDelegateAuthorization,
    );
    const revokedIncremental = await readSyncPayload(
      durableObject,
      grantedTotal.cursor,
      refreshedDelegateAuthorization,
    );

    if (revokedTotal.mode !== "total") {
      throw new Error("Expected a total sync payload after revoking the share grant.");
    }
    if (
      revokedIncremental.mode !== "incremental" ||
      !("fallback" in revokedIncremental) ||
      revokedIncremental.fallback !== "reset"
    ) {
      throw new Error("Expected share revocation to force total-sync recovery.");
    }
    if (!revokedTotal.snapshot) {
      throw new Error("Expected revoked share proofs to include a total snapshot.");
    }

    expect(
      revokedTotal.snapshot.edges.some(
        (edge) =>
          edge.s === createdNote.result &&
          (edge.p === shareableSharedNotePredicateId ||
            edge.p === shareableOtherSharedNotePredicateId),
      ),
    ).toBe(false);
    try {
      authority.readPredicateValue(createdNote.result, shareableSharedNotePredicateId, {
        authorization: refreshedDelegateAuthorization,
      });
      throw new Error("Expected shared-note direct reads to fail after share revocation.");
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

  it("accepts secret-field command envelopes for non-env-var secret-backed predicates", async () => {
    const { db, state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(
      state,
      {},
      {
        createAuthority(storage, options) {
          return createWebAppAuthority(storage, {
            ...options,
            graph: secretNoteGraph,
          });
        },
      },
    );
    const initialSync = await readSyncPayload(durableObject);
    const createdSecretNote = buildTransactionFromGraphSnapshot(
      initialSync.snapshot ?? { edges: [], retracted: [] },
      secretNoteGraph,
      "tx:create-command-secret-note",
      (graph) =>
        graph.secretNote.create({
          name: "Shared command note",
        }),
    );

    await postTransaction(durableObject, createdSecretNote.transaction);
    const commandResult = await postCommand(durableObject, {
      kind: "write-secret-field",
      input: {
        entityId: createdSecretNote.result,
        predicateId: secretNoteSecretPredicateId,
        plaintext: "shared-note-secret",
      },
    });
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
        createAuthority(storage, options) {
          return createWebAppAuthority(storage, {
            ...options,
            graph: secretNoteGraph,
          });
        },
      },
    );
    const incremental = await readSyncPayload(restarted, initialSync.cursor);
    const commandRow = txRows.at(-1);

    if (!commandRow) {
      throw new Error("Expected the shared command route to append a durable transaction.");
    }

    expect(commandResult).toMatchObject({
      created: true,
      entityId: createdSecretNote.result,
      predicateId: secretNoteSecretPredicateId,
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
        value: "shared-note-secret",
        version: 1,
      },
    ]);
    expect(commandRow).toEqual({
      seq: 2,
      tx_id: expect.stringContaining(
        `secret-field:${createdSecretNote.result}:${secretNoteSecretPredicateId}:`,
      ),
      cursor: commandRow.cursor,
      write_scope: "server-command",
    });
    expect(incremental.transactions).toEqual([
      expect.objectContaining({
        txId: "tx:create-command-secret-note",
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
        GRAPH_AUTHORITY_RETAINED_HISTORY_POLICY: encodeRetainedHistoryPolicy({
          kind: "transaction-count",
          maxTransactions: 2,
        }),
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
      retained_history_policy_kind: string;
      retained_history_policy_max_transactions: number | null;
    }>(
      db,
      `SELECT
        cursor_prefix,
        head_seq,
        head_cursor,
        history_retained_from_seq,
        retained_history_policy_kind,
        retained_history_policy_max_transactions
      FROM io_graph_meta
      WHERE id = 1`,
    );
    const gap = await readSyncPayload(durableObject, initialSync.cursor);
    const retained = await readSyncPayload(durableObject, firstHidden.cursor);
    const restarted = createTestDurableObject(
      state,
      {
        GRAPH_AUTHORITY_RETAINED_HISTORY_POLICY: encodeRetainedHistoryPolicy({
          kind: "transaction-count",
          maxTransactions: 2,
        }),
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
        retained_history_policy_kind: "transaction-count",
        retained_history_policy_max_transactions: 2,
      },
    ]);
    expect(gap).toMatchObject({
      mode: "incremental",
      after: initialSync.cursor,
      fallback: "gap",
      cursor: thirdHidden.cursor,
      diagnostics: {
        retainedBaseCursor: firstHidden.cursor,
        retainedHistoryPolicy: {
          kind: "transaction-count",
          maxTransactions: 2,
        },
      },
      transactions: [],
    });
    expect(retained).toMatchObject({
      mode: "incremental",
      after: firstHidden.cursor,
      cursor: thirdHidden.cursor,
      diagnostics: {
        retainedBaseCursor: firstHidden.cursor,
        retainedHistoryPolicy: {
          kind: "transaction-count",
          maxTransactions: 2,
        },
      },
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
      diagnostics: {
        retainedBaseCursor: firstHidden.cursor,
        retainedHistoryPolicy: {
          kind: "transaction-count",
          maxTransactions: 2,
        },
      },
      transactions: [],
    });
    expect(restartedRetained).toMatchObject({
      mode: "incremental",
      after: firstHidden.cursor,
      cursor: thirdHidden.cursor,
      diagnostics: {
        retainedBaseCursor: firstHidden.cursor,
        retainedHistoryPolicy: {
          kind: "transaction-count",
          maxTransactions: 2,
        },
      },
      transactions: [],
    });
    expect(restartedRetained.fallback).toBeUndefined();
  });

  it("keeps hidden-only cursor recovery incremental when the retained policy is unbounded", async () => {
    const { db, state } = createSqliteDurableObjectState();
    const hiddenProbe = { entityId: null as string | null };
    const durableObject = createTestDurableObject(
      state,
      {
        GRAPH_AUTHORITY_RETAINED_HISTORY_POLICY: encodeRetainedHistoryPolicy({
          kind: "all",
        }),
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

    await authority.applyTransaction(
      buildHiddenCursorAdvanceTransaction(
        authority.store.snapshot(),
        hiddenProbe.entityId,
        "tx:hidden:all:1",
      ),
      {
        writeScope: "authority-only",
      },
    );
    await authority.applyTransaction(
      buildHiddenCursorAdvanceTransaction(
        authority.store.snapshot(),
        hiddenProbe.entityId,
        "tx:hidden:all:2",
      ),
      {
        writeScope: "authority-only",
      },
    );
    const thirdHidden = await authority.applyTransaction(
      buildHiddenCursorAdvanceTransaction(
        authority.store.snapshot(),
        hiddenProbe.entityId,
        "tx:hidden:all:3",
      ),
      {
        writeScope: "authority-only",
      },
    );
    const txCount = queryAll<{ count: number }>(db, `SELECT COUNT(*) AS count FROM io_graph_tx`);
    const incremental = await readSyncPayload(durableObject, initialSync.cursor);

    expect(txCount).toEqual([{ count: 3 }]);
    expect(incremental).toMatchObject({
      mode: "incremental",
      after: initialSync.cursor,
      cursor: thirdHidden.cursor,
      diagnostics: {
        retainedBaseCursor: initialSync.cursor,
        retainedHistoryPolicy: {
          kind: "all",
        },
      },
      transactions: [],
    });
    expect(incremental.fallback).toBeUndefined();
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
      retained_history_policy_kind: string;
      retained_history_policy_max_transactions: number | null;
    }>(
      db,
      `SELECT
        cursor_prefix,
        head_seq,
        head_cursor,
        history_retained_from_seq,
        retained_history_policy_kind,
        retained_history_policy_max_transactions
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
      diagnostics: {
        retainedBaseCursor: restartedSync.cursor,
        retainedHistoryPolicy: {
          kind: "transaction-count",
          maxTransactions: 128,
        },
      },
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
      retained_history_policy_kind: string;
      retained_history_policy_max_transactions: number | null;
    }>(
      db,
      `SELECT
        cursor_prefix,
        head_seq,
        head_cursor,
        history_retained_from_seq,
        retained_history_policy_kind,
        retained_history_policy_max_transactions
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
        retained_history_policy_kind: "transaction-count",
        retained_history_policy_max_transactions: 128,
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

  it("preserves live secret side-table rows across graph-only commits, baseline persists, and restart", async () => {
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
    const restarted = createTestDurableObject(state);

    await readSyncPayload(restarted);

    const secretRowsAfterRestart = queryAll<Required<SecretValueRow>>(
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
    expect(secretRowsAfterRestart).toEqual(secretRowsBeforeGraphUpdate);
  });

  it("preserves live secret side-table rows across rotation and restart", async () => {
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
    const createdSecret = await postSecretField(durableObject, {
      entityId: createdEnvVar.result,
      predicateId: envVarSecretPredicateId,
      plaintext: "sk-live-first",
    });
    const rotatedSecret = await postSecretField(
      durableObject,
      {
        entityId: createdEnvVar.result,
        predicateId: envVarSecretPredicateId,
        plaintext: "sk-live-second",
      },
      200,
    );
    const secretRowsAfterRotate = queryAll<Required<SecretValueRow>>(
      db,
      `SELECT rowid, secret_id, value, version, stored_at
      FROM io_secret_value`,
    );
    const rotatedSecretRow = secretRowsAfterRotate[0];
    const restarted = createTestDurableObject(state);
    const restartedSync = await readSyncPayload(restarted);
    const secretRowsAfterRestart = queryAll<Required<SecretValueRow>>(
      db,
      `SELECT rowid, secret_id, value, version, stored_at
      FROM io_secret_value`,
    );

    if (!rotatedSecretRow) {
      throw new Error("Expected the rotated secret side-table row.");
    }

    expect(createdSecret.secretVersion).toBe(1);
    expect(rotatedSecret).toMatchObject({
      created: false,
      entityId: createdEnvVar.result,
      predicateId: envVarSecretPredicateId,
      rotated: true,
      secretId: createdSecret.secretId,
      secretVersion: 2,
    });
    expect(secretRowsAfterRotate).toEqual([
      {
        rowid: rotatedSecretRow.rowid,
        secret_id: createdSecret.secretId,
        value: "sk-live-second",
        version: 2,
        stored_at: rotatedSecretRow.stored_at,
      },
    ]);
    expect(secretRowsAfterRestart).toEqual(secretRowsAfterRotate);
    expect(JSON.stringify(restartedSync)).not.toContain("sk-live-second");
  });

  it("prunes plaintext rows when a secret-backed reference is retracted", async () => {
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
    await postSecretField(durableObject, {
      entityId: createdEnvVar.result,
      predicateId: envVarSecretPredicateId,
      plaintext: "sk-live-first",
    });
    const afterSecretSync = await readSyncPayload(durableObject);
    const secretEdge = afterSecretSync.snapshot?.edges.find(
      (edge) => edge.s === createdEnvVar.result && edge.p === envVarSecretPredicateId,
    );
    const authority = await getDurableAuthority<WebAppAuthority>(durableObject);

    if (!secretEdge) {
      throw new Error("Expected the current env var secret edge before retraction.");
    }

    const retractTransaction = buildRetractSecretReferenceTransaction(
      afterSecretSync.snapshot ?? { edges: [], retracted: [] },
      createdEnvVar.result,
      "tx:retract-env-var-secret",
    );

    await applyServerCommandTransaction(authority, retractTransaction);

    const currentSync = await readSyncPayload(durableObject);
    const incremental = await readSyncPayload(durableObject, afterSecretSync.cursor);
    const secretRows = queryAll<SecretValueRow>(
      db,
      `SELECT secret_id, value, version
      FROM io_secret_value`,
    );
    const restarted = createTestDurableObject(state);
    const restartedSync = await readSyncPayload(restarted);
    const restartedIncremental = await readSyncPayload(restarted, afterSecretSync.cursor);

    expect(
      createStore(currentSync.snapshot ?? { edges: [], retracted: [] }).facts(
        createdEnvVar.result,
        envVarSecretPredicateId,
      ),
    ).toHaveLength(0);
    expect(JSON.stringify(currentSync)).not.toContain("sk-live-first");
    expect(secretRows).toEqual([]);
    expect(incremental.transactions).toEqual([
      expect.objectContaining({
        txId: "tx:retract-env-var-secret",
        writeScope: "server-command",
        transaction: expect.objectContaining({
          ops: [expect.objectContaining({ op: "retract", edgeId: secretEdge.id })],
        }),
      }),
    ]);
    expect(JSON.stringify(incremental)).not.toContain("sk-live-first");
    expect(
      createStore(restartedSync.snapshot ?? { edges: [], retracted: [] }).facts(
        createdEnvVar.result,
        envVarSecretPredicateId,
      ),
    ).toHaveLength(0);
    expect(restartedIncremental.transactions).toEqual(incremental.transactions);
    expect(JSON.stringify(restartedSync)).not.toContain("sk-live-first");
  });

  it("prunes orphaned side-table rows during restart when orphaned SQL rows remain", async () => {
    const { db, state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const initialSync = await readSyncPayload(durableObject);
    const liveEnvVar = buildTransactionFromSnapshot(
      initialSync.snapshot ?? { edges: [], retracted: [] },
      "tx:create-live-env-var",
      (graph) =>
        graph.envVar.create({
          description: "Primary model credential",
          name: "OPENAI_API_KEY",
        }),
    );

    await postTransaction(durableObject, liveEnvVar.transaction);
    const afterLiveEnvVarSync = await readSyncPayload(durableObject);
    const orphanedEnvVar = buildTransactionFromSnapshot(
      afterLiveEnvVarSync.snapshot ?? { edges: [], retracted: [] },
      "tx:create-orphaned-env-var",
      (graph) =>
        graph.envVar.create({
          description: "Secondary model credential",
          name: "ANTHROPIC_API_KEY",
        }),
    );

    await postTransaction(durableObject, orphanedEnvVar.transaction);
    const liveSecret = await postSecretField(durableObject, {
      entityId: liveEnvVar.result,
      predicateId: envVarSecretPredicateId,
      plaintext: "sk-live-first",
    });
    const orphanedSecret = await postSecretField(durableObject, {
      entityId: orphanedEnvVar.result,
      predicateId: envVarSecretPredicateId,
      plaintext: "sk-orphaned-first",
    });
    const authority = await getDurableAuthority<WebAppAuthority>(durableObject);
    const retractTransaction = buildRetractSecretReferenceTransaction(
      authority.readSnapshot({ authorization: testAuthorityAuthorization }),
      orphanedEnvVar.result,
      "tx:retract-env-var-secret:orphaned-sql-row",
    );

    await applyServerCommandTransaction(authority, retractTransaction);

    expect(
      queryAll<SecretValueRow>(
        db,
        `SELECT secret_id, value, version
        FROM io_secret_value
        ORDER BY secret_id ASC`,
      ),
    ).toEqual([
      {
        secret_id: liveSecret.secretId,
        value: "sk-live-first",
        version: 1,
      },
    ]);

    db.query(
      `INSERT INTO io_secret_value (
        secret_id,
        value,
        version,
        stored_at,
        provider,
        fingerprint,
        external_key_id
      ) VALUES (?, ?, ?, ?, NULL, NULL, NULL)`,
    ).run(
      orphanedSecret.secretId,
      "sk-orphaned-first",
      orphanedSecret.secretVersion,
      "2026-03-24T00:00:00.000Z",
    );

    const requestedSecretIds: Array<readonly string[] | undefined> = [];
    const restarted = createTestDurableObject(
      state,
      {},
      {
        createAuthority: async (storage, options) =>
          createWebAppAuthority(
            {
              load() {
                return storage.load();
              },
              inspectSecrets() {
                return storage.inspectSecrets();
              },
              loadSecrets(loadOptions) {
                requestedSecretIds.push(loadOptions?.secretIds);
                return storage.loadSecrets(loadOptions);
              },
              repairSecrets(input) {
                return storage.repairSecrets(input);
              },
              commit(input, commitOptions) {
                return storage.commit(input, commitOptions);
              },
              persist(input) {
                return storage.persist(input);
              },
            },
            options,
          ),
      },
    );
    const restartedSync = await readSyncPayload(restarted);
    const confirmedLive = await postSecretField(
      restarted,
      {
        entityId: liveEnvVar.result,
        predicateId: envVarSecretPredicateId,
        plaintext: "sk-live-first",
      },
      200,
    );

    expect(requestedSecretIds).toEqual([[liveSecret.secretId]]);
    const secretRowsAfterRestart = queryAll<SecretValueRow>(
      db,
      `SELECT secret_id, value, version
      FROM io_secret_value
      ORDER BY secret_id ASC`,
    );

    expect(secretRowsAfterRestart).toEqual([
      {
        secret_id: liveSecret.secretId,
        value: "sk-live-first",
        version: 1,
      },
    ]);
    expect(confirmedLive).toMatchObject({
      created: false,
      rotated: false,
      secretId: liveSecret.secretId,
      secretVersion: liveSecret.secretVersion,
    });
    expect(
      createStore(restartedSync.snapshot ?? { edges: [], retracted: [] }).facts(
        orphanedEnvVar.result,
        envVarSecretPredicateId,
      ),
    ).toHaveLength(0);
    expect(JSON.stringify(restartedSync)).not.toContain("sk-orphaned-first");
  });

  it("fails restart when a live secret handle loses its plaintext side row", async () => {
    const { db, state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const initialSync = await readSyncPayload(durableObject);
    const createdEnvVar = buildTransactionFromSnapshot(
      initialSync.snapshot ?? { edges: [], retracted: [] },
      "tx:create-missing-secret-row-env-var",
      (graph) =>
        graph.envVar.create({
          description: "Primary model credential",
          name: "OPENAI_API_KEY",
        }),
    );

    await postTransaction(durableObject, createdEnvVar.transaction);
    const createdSecret = await postSecretField(durableObject, {
      entityId: createdEnvVar.result,
      predicateId: envVarSecretPredicateId,
      plaintext: "sk-live-first",
    });

    db.query("DELETE FROM io_secret_value WHERE secret_id = ?").run(createdSecret.secretId);

    const restarted = createTestDurableObject(state);

    await expect(readSyncPayload(restarted)).rejects.toThrow(
      `Cannot start web authority because secret storage drift was detected: missing plaintext rows for ${createdSecret.secretId}.`,
    );
  });

  it("fails restart when a live secret handle version drifts from its plaintext side row", async () => {
    const { db, state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state);
    const initialSync = await readSyncPayload(durableObject);
    const createdEnvVar = buildTransactionFromSnapshot(
      initialSync.snapshot ?? { edges: [], retracted: [] },
      "tx:create-version-drift-env-var",
      (graph) =>
        graph.envVar.create({
          description: "Primary model credential",
          name: "OPENAI_API_KEY",
        }),
    );

    await postTransaction(durableObject, createdEnvVar.transaction);
    const createdSecret = await postSecretField(durableObject, {
      entityId: createdEnvVar.result,
      predicateId: envVarSecretPredicateId,
      plaintext: "sk-live-first",
    });

    db.query("UPDATE io_secret_value SET version = ? WHERE secret_id = ?").run(
      createdSecret.secretVersion + 1,
      createdSecret.secretId,
    );

    const restarted = createTestDurableObject(state);

    await expect(readSyncPayload(restarted)).rejects.toThrow(
      `Cannot start web authority because secret storage drift was detected: version mismatch for ${createdSecret.secretId} (graph ${createdSecret.secretVersion}, stored ${createdSecret.secretVersion + 1}).`,
    );
  });

  it("prunes plaintext rows when retracting an entity that owns a secret-backed reference", async () => {
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
    await postSecretField(durableObject, {
      entityId: createdEnvVar.result,
      predicateId: envVarSecretPredicateId,
      plaintext: "sk-live-first",
    });
    const afterSecretSync = await readSyncPayload(durableObject);
    const authority = await getDurableAuthority<WebAppAuthority>(durableObject);
    const deleteTransaction = buildTransactionFromSnapshot(
      afterSecretSync.snapshot ?? { edges: [], retracted: [] },
      "tx:delete-env-var-with-secret",
      (graph) => graph.envVar.delete(createdEnvVar.result),
    ).transaction;

    await applyServerCommandTransaction(authority, deleteTransaction);

    const currentSync = await readSyncPayload(durableObject);
    const secretRows = queryAll<SecretValueRow>(
      db,
      `SELECT secret_id, value, version
      FROM io_secret_value`,
    );
    const restarted = createTestDurableObject(state);
    const restartedSync = await readSyncPayload(restarted);

    expect(
      createStore(currentSync.snapshot ?? { edges: [], retracted: [] }).facts(createdEnvVar.result),
    ).toHaveLength(0);
    expect(secretRows).toEqual([]);
    expect(JSON.stringify(currentSync)).not.toContain("sk-live-first");
    expect(
      createStore(restartedSync.snapshot ?? { edges: [], retracted: [] }).facts(
        createdEnvVar.result,
      ),
    ).toHaveLength(0);
    expect(JSON.stringify(restartedSync)).not.toContain("sk-live-first");
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

  it("rewrites stale persisted head metadata when retained history still matches the hydrated snapshot", async () => {
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

    db.query(
      `UPDATE io_graph_meta
      SET head_seq = ?, head_cursor = ?
      WHERE id = 1`,
    ).run(1, createdTx.cursor);

    const restarted = createTestDurableObject(state);
    const restartedSync = await readSyncPayload(restarted);
    const incremental = await readSyncPayload(restarted, createdTx.cursor);
    const txCount = queryAll<{ count: number }>(db, `SELECT COUNT(*) AS count FROM io_graph_tx`);
    const metaRows = queryAll<{
      head_cursor: string;
      head_seq: number;
      history_retained_from_seq: number;
    }>(
      db,
      `SELECT head_seq, head_cursor, history_retained_from_seq
      FROM io_graph_meta
      WHERE id = 1`,
    );

    expect(secretWrite.secretVersion).toBe(1);
    expect(restartedSync.snapshot).toEqual(expectedSnapshot);
    expect(restartedSync.cursor).not.toBe(createdTx.cursor);
    expect(txCount).toEqual([{ count: 2 }]);
    expect(metaRows).toEqual([
      {
        head_seq: 2,
        head_cursor: restartedSync.cursor,
        history_retained_from_seq: 0,
      },
    ]);
    expect(incremental.transactions).toEqual([
      expect.objectContaining({
        txId: expect.stringContaining(`secret-field:${createdEnvVar.result}:`),
        writeScope: "server-command",
      }),
    ]);
    expect(incremental.fallback).toBeUndefined();
  });

  it("rewrites a stale retained-history boundary when retained transaction rows still match", async () => {
    const { db, state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state, {
      GRAPH_AUTHORITY_RETAINED_HISTORY_POLICY: encodeRetainedHistoryPolicy({
        kind: "transaction-count",
        maxTransactions: 2,
      }),
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

    await postTransaction(durableObject, createdEnvVar.transaction);
    await postSecretField(durableObject, {
      entityId: createdEnvVar.result,
      predicateId: envVarSecretPredicateId,
      plaintext: "sk-live-first",
    });
    const afterSecretSync = await readSyncPayload(durableObject);
    const renameEnvVar = buildTransactionFromSnapshot(
      afterSecretSync.snapshot ?? { edges: [], retracted: [] },
      "tx:update-env-var",
      (graph) =>
        graph.envVar.update(createdEnvVar.result, {
          description: "Primary model credential (rotated)",
        }),
    );
    const latestTx = await postTransaction(durableObject, renameEnvVar.transaction);
    const expectedSnapshot = (await readSyncPayload(durableObject)).snapshot;

    db.query(
      `UPDATE io_graph_meta
      SET history_retained_from_seq = ?
      WHERE id = 1`,
    ).run(0);

    const restarted = createTestDurableObject(state, {
      GRAPH_AUTHORITY_RETAINED_HISTORY_POLICY: encodeRetainedHistoryPolicy({
        kind: "transaction-count",
        maxTransactions: 2,
      }),
    });
    const restartedAuthority = await (
      restarted as unknown as {
        getAuthority(): Promise<{ startupDiagnostics: unknown }>;
      }
    ).getAuthority();
    const restartedSync = await readSyncPayload(restarted);
    const reset = await readSyncPayload(restarted, initialSync.cursor);
    const txRows = queryAll<{ seq: number }>(
      db,
      `SELECT seq
      FROM io_graph_tx
      ORDER BY seq ASC`,
    );
    const metaRows = queryAll<{
      head_cursor: string;
      head_seq: number;
      history_retained_from_seq: number;
    }>(
      db,
      `SELECT head_seq, head_cursor, history_retained_from_seq
      FROM io_graph_meta
      WHERE id = 1`,
    );

    expect(restartedSync.snapshot).toEqual(expectedSnapshot);
    expect(restartedSync.cursor).toBe(latestTx.cursor);
    expect(txRows).toEqual([{ seq: 2 }, { seq: 3 }]);
    expect(metaRows).toEqual([
      {
        head_seq: 3,
        head_cursor: latestTx.cursor,
        history_retained_from_seq: 1,
      },
    ]);
    expect(restartedAuthority.startupDiagnostics).toEqual({
      recovery: "repair",
      repairReasons: ["retained-history-boundary-mismatch"],
      resetReasons: [],
    });
    expect(reset).toMatchObject({
      fallback: "gap",
      cursor: latestTx.cursor,
      transactions: [],
      diagnostics: {
        retainedBaseCursor: expect.stringMatching(/:1$/),
      },
    });
  });

  it("resets the retained history baseline when persisted cursor metadata no longer matches transaction cursors", async () => {
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
    await postSecretField(durableObject, {
      entityId: createdEnvVar.result,
      predicateId: envVarSecretPredicateId,
      plaintext: "sk-live-first",
    });
    const expectedSnapshot = (await readSyncPayload(durableObject)).snapshot;

    db.query(
      `UPDATE io_graph_meta
      SET cursor_prefix = ?, head_cursor = ?
      WHERE id = 1`,
    ).run("drifted:", "drifted:2");

    const restarted = createTestDurableObject(state);
    const restartedAuthority = await (
      restarted as unknown as {
        getAuthority(): Promise<{ startupDiagnostics: unknown }>;
      }
    ).getAuthority();
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

    expect(restartedSync.snapshot).toEqual(expectedSnapshot);
    expect(restartedSync.cursor).not.toBe(createdTx.cursor);
    expect(restartedSync.cursor).not.toBe("drifted:2");
    expect(txCount).toEqual([{ count: 0 }]);
    expect(metaRows).toEqual([
      {
        cursor_prefix: metaRows[0]?.cursor_prefix ?? "",
        head_seq: 0,
        head_cursor: restartedSync.cursor,
        history_retained_from_seq: 0,
      },
    ]);
    expect(restartedAuthority.startupDiagnostics).toEqual({
      recovery: "reset-baseline",
      repairReasons: [],
      resetReasons: ["retained-history-sequence-mismatch"],
    });
    expect(reset).toMatchObject({
      fallback: "reset",
      cursor: restartedSync.cursor,
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
    const restartedAuthority = await (
      restarted as unknown as {
        getAuthority(): Promise<{ startupDiagnostics: unknown }>;
      }
    ).getAuthority();
    const restartedSync = await readSyncPayload(restarted);
    const reset = await readSyncPayload(restarted, createdTx.cursor);
    const txCount = queryAll<{ count: number }>(db, `SELECT COUNT(*) AS count FROM io_graph_tx`);
    const metaRows = queryAll<{
      cursor_prefix: string;
      head_cursor: string;
      head_seq: number;
      history_retained_from_seq: number;
      retained_history_policy_kind: string;
      retained_history_policy_max_transactions: number | null;
    }>(
      db,
      `SELECT
        cursor_prefix,
        head_seq,
        head_cursor,
        history_retained_from_seq,
        retained_history_policy_kind,
        retained_history_policy_max_transactions
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
    expect(restartedAuthority.startupDiagnostics).toEqual({
      recovery: "reset-baseline",
      repairReasons: [],
      resetReasons: ["retained-history-head-mismatch"],
    });
    expect(reset).toMatchObject({
      fallback: "reset",
      transactions: [],
    });
  });

  it("prunes retained transaction rows and falls back for old or unknown cursors", async () => {
    const { db, state } = createSqliteDurableObjectState();
    const durableObject = createTestDurableObject(state, {
      GRAPH_AUTHORITY_RETAINED_HISTORY_POLICY: encodeRetainedHistoryPolicy({
        kind: "transaction-count",
        maxTransactions: 2,
      }),
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
      retained_history_policy_kind: string;
      retained_history_policy_max_transactions: number | null;
    }>(
      db,
      `SELECT
        cursor_prefix,
        head_seq,
        head_cursor,
        history_retained_from_seq,
        retained_history_policy_kind,
        retained_history_policy_max_transactions
      FROM io_graph_meta
      WHERE id = 1`,
    );
    const gap = await readSyncPayload(durableObject, initialSync.cursor);
    const retained = await readSyncPayload(durableObject, createdTx.cursor);
    const unknown = await readSyncPayload(durableObject, "web-authority:unknown");
    const restarted = createTestDurableObject(state, {
      GRAPH_AUTHORITY_RETAINED_HISTORY_POLICY: encodeRetainedHistoryPolicy({
        kind: "transaction-count",
        maxTransactions: 2,
      }),
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
        retained_history_policy_kind: "transaction-count",
        retained_history_policy_max_transactions: 2,
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
