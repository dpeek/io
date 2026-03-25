import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import {
  createStore,
  createTypeClient,
  type AuthorizationContext,
  type GraphWriteTransaction,
  type StoreSnapshot,
} from "@io/core/graph";
import { core } from "@io/core/graph/modules";

import { createAnonymousAuthorizationContext, issueBearerShareToken } from "../lib/auth-bridge.js";
import { createTestWebAppAuthority } from "../lib/authority-test-helpers.js";
import type { WebAppAuthority } from "../lib/authority.js";
import type { BetterAuthWorkerEnv } from "../lib/better-auth.js";
import {
  WebGraphAuthorityDurableObject,
  webGraphAuthorityBearerShareLookupPath,
  webGraphAuthoritySessionPrincipalLookupPath,
} from "../lib/graph-authority-do.js";
import { readRequestAuthorizationContext } from "../lib/server-routes.js";
import { webWorkflowLivePath } from "../lib/workflow-live-transport.js";
import { webWorkflowReadPath } from "../lib/workflow-transport.js";
import worker, { BetterAuthSessionVerificationError, createWorkerFetchHandler } from "./index.js";

type DurableObjectSqlCursor<T extends Record<string, unknown>> = Iterable<T> & {
  one(): T;
};

const authorityAuthorization: AuthorizationContext = {
  graphId: "graph:global",
  principalId: "principal:authority",
  principalKind: "service",
  sessionId: "session:authority",
  roleKeys: ["graph:authority"],
  capabilityGrantIds: [],
  capabilityVersion: 0,
  policyVersion: 0,
};

function createBetterAuthEnv(): BetterAuthWorkerEnv {
  return {
    AUTH_DB: new Database(":memory:"),
    BETTER_AUTH_SECRET: "L5tH1pQ8xJ2mR9vN4sC7kW3yF6uB0dE!ZaG1oP5qT8xV2",
    BETTER_AUTH_URL: "https://web.local",
  };
}

function createCursor<T extends Record<string, unknown>>(
  rows: readonly T[],
): DurableObjectSqlCursor<T> {
  return {
    one() {
      if (rows.length !== 1) {
        throw new Error(`Expected exactly one SQL row but received ${rows.length}.`);
      }

      const row = rows[0];
      if (!row) {
        throw new Error("Expected a SQL row when the cursor contains exactly one result.");
      }

      return row;
    },
    *[Symbol.iterator]() {
      yield* rows;
    },
  };
}

function createSqliteDurableObjectState(): {
  readonly db: Database;
  readonly state: ConstructorParameters<typeof WebGraphAuthorityDurableObject>[0];
} {
  const db = new Database(":memory:");

  return {
    db,
    state: {
      storage: {
        sql: {
          exec<T extends Record<string, unknown>>(
            query: string,
            ...bindings: unknown[]
          ): DurableObjectSqlCursor<T> {
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
        return callback();
      },
    },
  };
}

function createMutationStore(snapshot: StoreSnapshot) {
  const mutationStore = createStore(snapshot);
  return {
    mutationGraph: createTypeClient(mutationStore, core),
    mutationStore,
  };
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

function readCoreGraph(authority: WebAppAuthority, authorization = authorityAuthorization) {
  return createTypeClient(createStore(authority.readSnapshot({ authorization })), core);
}

async function getDurableAuthority(
  durableObject: WebGraphAuthorityDurableObject,
): Promise<WebAppAuthority> {
  return (durableObject as unknown as { getAuthority(): Promise<WebAppAuthority> }).getAuthority();
}

async function writeAdmissionPolicy(
  authority: WebAppAuthority,
  input: {
    readonly graphId?: string;
    readonly bootstrapMode?: string;
    readonly signupPolicy?: string;
    readonly allowedEmailDomain?: readonly string[];
    readonly firstUserRoleKey?: readonly string[];
    readonly signupRoleKey?: readonly string[];
  } = {},
): Promise<void> {
  const { mutationGraph, mutationStore } = createMutationStore(
    authority.readSnapshot({ authorization: authorityAuthorization }),
  );
  const before = mutationStore.snapshot();
  const graphId = input.graphId ?? "graph:global";
  const existing = mutationGraph.admissionPolicy
    .list()
    .find((policy) => policy.graphId === graphId);
  const nextValues = {
    allowedEmailDomain: [...(input.allowedEmailDomain ?? [])],
    bootstrapMode: input.bootstrapMode ?? core.admissionBootstrapMode.values.manual.id,
    firstUserRoleKey: [...(input.firstUserRoleKey ?? ["graph:owner"])],
    graphId,
    name: "Admission policy",
    signupPolicy: input.signupPolicy ?? core.admissionSignupPolicy.values.closed.id,
    signupRoleKey: [...(input.signupRoleKey ?? ["graph:member"])],
  };

  if (existing) {
    mutationGraph.admissionPolicy.update(existing.id, nextValues);
  } else {
    mutationGraph.admissionPolicy.create(nextValues);
  }

  await authority.applyTransaction(
    buildGraphWriteTransaction(
      before,
      mutationStore.snapshot(),
      `tx:write-admission-policy:${Date.now()}`,
    ),
    {
      authorization: authorityAuthorization,
      writeScope: "authority-only",
    },
  );
}

async function createProjectedPrincipalWithoutBindings(
  authority: WebAppAuthority,
  input: {
    readonly email: string;
    readonly userId: string;
    readonly graphId?: string;
  },
): Promise<void> {
  const { mutationGraph, mutationStore } = createMutationStore(
    authority.readSnapshot({ authorization: authorityAuthorization }),
  );
  const before = mutationStore.snapshot();
  const graphId = input.graphId ?? "graph:global";
  const principalId = mutationGraph.principal.create({
    homeGraphId: graphId,
    kind: core.principalKind.values.human.id,
    name: "Approved Principal",
    status: core.principalStatus.values.active.id,
  });

  mutationGraph.authSubjectProjection.create({
    authUserId: input.userId,
    issuer: "better-auth",
    mirroredAt: new Date("2026-03-24T00:00:00.000Z"),
    name: "Approved Subject",
    principal: principalId,
    provider: "user",
    providerAccountId: input.userId,
    status: core.authSubjectStatus.values.active.id,
  });

  await authority.applyTransaction(
    buildGraphWriteTransaction(
      before,
      mutationStore.snapshot(),
      `tx:create-unbound-principal:${input.userId}:${Date.now()}`,
    ),
    {
      authorization: authorityAuthorization,
      writeScope: "authority-only",
    },
  );
}

function createEndToEndWorkerEnv() {
  const { state } = createSqliteDurableObjectState();
  const durableObject = new WebGraphAuthorityDurableObject(
    state,
    {},
    {
      createAuthority(storage, options) {
        return createTestWebAppAuthority(storage, options);
      },
    },
  );
  const env = {
    ...createBetterAuthEnv(),
    ASSETS: {
      async fetch() {
        return new Response("asset");
      },
    },
    GRAPH_AUTHORITY: {
      idFromName(name: string) {
        expect(name).toBe("global");
        return "graph-authority-id";
      },
      get(id: unknown) {
        expect(id).toBe("graph-authority-id");
        return {
          fetch(request: Request) {
            return durableObject.fetch(request);
          },
        };
      },
    },
  } satisfies Parameters<typeof worker.fetch>[1];

  return {
    durableObject,
    env,
  };
}

function createWorkerEnv(
  input: {
    readonly assetResponse?: Response;
    readonly authorityResponse?: Response;
    readonly bearerLookupResponse?: Response;
    readonly principalLookupResponse?: Response;
    readonly onAuthorityFetch?: (request: Request) => Promise<void> | void;
    readonly onBearerLookup?: (request: Request) => Promise<void> | void;
    readonly onPrincipalLookup?: (request: Request) => Promise<void> | void;
  } = {},
) {
  const assetPaths: string[] = [];
  const authorityPaths: string[] = [];
  const bearerLookupPaths: string[] = [];
  const principalLookupPaths: string[] = [];
  let forwardedAuthorization: AuthorizationContext | null = null;

  const env = {
    ...createBetterAuthEnv(),
    ASSETS: {
      async fetch(request: Request) {
        assetPaths.push(new URL(request.url).pathname);
        return input.assetResponse ?? new Response("asset");
      },
    },
    GRAPH_AUTHORITY: {
      idFromName(name: string) {
        expect(name).toBe("global");
        return "graph-authority-id";
      },
      get(id: unknown) {
        expect(id).toBe("graph-authority-id");
        return {
          async fetch(request: Request) {
            const pathname = new URL(request.url).pathname;
            if (pathname === webGraphAuthorityBearerShareLookupPath) {
              bearerLookupPaths.push(pathname);
              await input.onBearerLookup?.(request);
              return input.bearerLookupResponse ?? new Response(null, { status: 404 });
            }

            if (pathname === webGraphAuthoritySessionPrincipalLookupPath) {
              principalLookupPaths.push(pathname);
              await input.onPrincipalLookup?.(request);
              return input.principalLookupResponse ?? new Response(null, { status: 404 });
            }

            authorityPaths.push(pathname);
            forwardedAuthorization = readRequestAuthorizationContext(request);
            await input.onAuthorityFetch?.(request);
            return input.authorityResponse ?? new Response("ok");
          },
        };
      },
    },
  } satisfies Parameters<typeof worker.fetch>[1];

  return {
    assetPaths,
    authorityPaths,
    bearerLookupPaths,
    env,
    principalLookupPaths,
    readForwardedAuthorization() {
      return forwardedAuthorization;
    },
  };
}

describe("web worker route forwarding", () => {
  it("mounts /api/auth/* on the Better Auth handler without falling through to assets or the graph authority", async () => {
    const { assetPaths, authorityPaths, env } = createWorkerEnv();

    const response = await worker.fetch(new Request("https://web.local/api/auth/unknown"), env);

    expect(response.status).toBe(404);
    expect(assetPaths).toEqual([]);
    expect(authorityPaths).toEqual([]);
  });

  it("forwards the canonical web-owned /api/commands proof to the graph authority durable object", async () => {
    const { authorityPaths, env } = createWorkerEnv();
    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        return null;
      },
    });

    const response = await handler.fetch(
      new Request("https://web.local/api/commands", {
        method: "POST",
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(authorityPaths).toEqual(["/api/commands"]);
  });

  it("forwards authenticated workflow reads over the first web transport route", async () => {
    const { authorityPaths, env, principalLookupPaths, readForwardedAuthorization } =
      createWorkerEnv({
        principalLookupResponse: Response.json({
          principalId: "principal:user-better-auth",
          principalKind: "human",
          roleKeys: ["graph:member"],
          capabilityGrantIds: ["grant-1"],
          capabilityVersion: 4,
        }),
      });
    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        return {
          session: { id: "session-better-auth" },
          user: { id: "user-better-auth" },
        };
      },
    });

    const response = await handler.fetch(
      new Request(`https://web.local${webWorkflowReadPath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "project-branch-scope",
          query: {
            projectId: "project:io",
          },
        }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(authorityPaths).toEqual([webWorkflowReadPath]);
    expect(principalLookupPaths).toEqual([webGraphAuthoritySessionPrincipalLookupPath]);
    expect(readForwardedAuthorization()).toEqual({
      graphId: "graph:global",
      principalId: "principal:user-better-auth",
      principalKind: "human",
      sessionId: "session-better-auth",
      roleKeys: ["graph:member"],
      capabilityGrantIds: ["grant-1"],
      capabilityVersion: 4,
      policyVersion: 0,
    });
  });

  it("forwards bearer share sync requests with anonymous shared-read authorization", async () => {
    const issued = await issueBearerShareToken();
    const {
      authorityPaths,
      bearerLookupPaths,
      env,
      principalLookupPaths,
      readForwardedAuthorization,
    } = createWorkerEnv({
      bearerLookupResponse: Response.json({
        capabilityGrantIds: ["grant:bearer-share"],
      }),
      async onAuthorityFetch(request) {
        expect(request.headers.get("authorization")).toBeNull();
        expect(request.headers.get("cookie")).toBeNull();
      },
      async onBearerLookup(request) {
        expect(await request.json()).toEqual({
          graphId: "graph:global",
          tokenHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        });
      },
    });
    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        throw new Error("Better Auth session lookup should not run for bearer share sync");
      },
    });

    const response = await handler.fetch(
      new Request("https://web.local/api/sync", {
        headers: {
          authorization: `Bearer ${issued.token}`,
        },
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(authorityPaths).toEqual(["/api/sync"]);
    expect(bearerLookupPaths).toEqual([webGraphAuthorityBearerShareLookupPath]);
    expect(principalLookupPaths).toEqual([]);
    expect(readForwardedAuthorization()).toEqual({
      graphId: "graph:global",
      principalId: null,
      principalKind: "anonymous",
      sessionId: null,
      roleKeys: [],
      capabilityGrantIds: ["grant:bearer-share"],
      capabilityVersion: 0,
      policyVersion: 0,
    });
  });

  it("rejects malformed bearer share tokens before forwarding sync requests", async () => {
    const { authorityPaths, bearerLookupPaths, env } = createWorkerEnv();
    const handler = createWorkerFetchHandler();

    const response = await handler.fetch(
      new Request("https://web.local/api/sync", {
        headers: {
          authorization: "Bearer not-a-valid-share-token",
        },
      }),
      env,
    );

    expect(response.status).toBe(400);
    expect(authorityPaths).toEqual([]);
    expect(bearerLookupPaths).toEqual([]);
    expect(await response.json()).toMatchObject({
      code: "grant.invalid",
    });
  });

  it("rejects bearer share tokens on non-sync graph routes", async () => {
    const issued = await issueBearerShareToken();
    const { authorityPaths, bearerLookupPaths, env } = createWorkerEnv();
    const handler = createWorkerFetchHandler();

    const response = await handler.fetch(
      new Request("https://web.local/api/commands", {
        method: "POST",
        headers: {
          authorization: `Bearer ${issued.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "workflow-mutation",
          input: {
            action: "noop",
          },
        }),
      }),
      env,
    );

    expect(response.status).toBe(405);
    expect(authorityPaths).toEqual([]);
    expect(bearerLookupPaths).toEqual([]);
    expect(await response.json()).toMatchObject({
      code: "grant.invalid",
    });
  });

  it("rejects bearer share tokens on graph transaction routes used by MCP writes", async () => {
    const issued = await issueBearerShareToken();
    const { authorityPaths, bearerLookupPaths, env } = createWorkerEnv();
    const handler = createWorkerFetchHandler();

    const response = await handler.fetch(
      new Request("https://web.local/api/tx", {
        method: "POST",
        headers: {
          authorization: `Bearer ${issued.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: "tx:mcp-bearer-write",
          ops: [],
        }),
      }),
      env,
    );

    expect(response.status).toBe(405);
    expect(authorityPaths).toEqual([]);
    expect(bearerLookupPaths).toEqual([]);
    expect(await response.json()).toMatchObject({
      code: "grant.invalid",
      error: 'Bearer share tokens only support "GET /api/sync" requests in the current proof.',
    });
  });

  it("fails closed when the authority rejects a bearer share lookup", async () => {
    const issued = await issueBearerShareToken();
    const { authorityPaths, bearerLookupPaths, env } = createWorkerEnv({
      bearerLookupResponse: Response.json(
        {
          error: "Bearer share token has been revoked.",
          code: "grant.invalid",
        },
        {
          status: 403,
        },
      ),
    });
    const handler = createWorkerFetchHandler();

    const response = await handler.fetch(
      new Request("https://web.local/api/sync", {
        headers: {
          authorization: `Bearer ${issued.token}`,
        },
      }),
      env,
    );

    expect(response.status).toBe(403);
    expect(authorityPaths).toEqual([]);
    expect(bearerLookupPaths).toEqual([webGraphAuthorityBearerShareLookupPath]);
    expect(await response.json()).toMatchObject({
      code: "grant.invalid",
    });
  });

  it("forwards authenticated workflow live registrations over the first web transport route", async () => {
    const { authorityPaths, env, principalLookupPaths, readForwardedAuthorization } =
      createWorkerEnv({
        principalLookupResponse: Response.json({
          principalId: "principal:user-better-auth",
          principalKind: "human",
          roleKeys: ["graph:member"],
          capabilityGrantIds: ["grant-1"],
          capabilityVersion: 4,
        }),
      });
    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        return {
          session: { id: "session-better-auth" },
          user: { id: "user-better-auth" },
        };
      },
    });

    const response = await handler.fetch(
      new Request(`https://web.local${webWorkflowLivePath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "workflow-review-register",
          cursor:
            "scope:kind=module&moduleId=ops%2Fworkflow&scopeId=scope%3Aops%2Fworkflow%3Areview&definitionHash=scope-def%3Aops%2Fworkflow%3Areview%3Av1&policyFilterVersion=policy%3A0&cursor=web-authority%3A1",
        }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(authorityPaths).toEqual([webWorkflowLivePath]);
    expect(principalLookupPaths).toEqual([webGraphAuthoritySessionPrincipalLookupPath]);
    expect(readForwardedAuthorization()).toEqual({
      graphId: "graph:global",
      principalId: "principal:user-better-auth",
      principalKind: "human",
      sessionId: "session-better-auth",
      roleKeys: ["graph:member"],
      capabilityGrantIds: ["grant-1"],
      capabilityVersion: 4,
      policyVersion: 0,
    });
  });
  it("forwards unauthenticated graph writes with an anonymous authorization context", async () => {
    const { env, readForwardedAuthorization } = createWorkerEnv();
    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        return null;
      },
    });

    const response = await handler.fetch(
      new Request("https://web.local/api/tx", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: "tx:web:1",
          ops: [],
        }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(readForwardedAuthorization()).toEqual({
      graphId: "graph:global",
      principalId: null,
      principalKind: null,
      sessionId: null,
      roleKeys: [],
      capabilityGrantIds: [],
      capabilityVersion: 0,
      policyVersion: 0,
    });
  });

  it("forwards authenticated graph writes with a session-derived authorization context", async () => {
    const { env, principalLookupPaths, readForwardedAuthorization } = createWorkerEnv({
      principalLookupResponse: Response.json({
        principalId: "principal:user-better-auth",
        principalKind: "human",
        roleKeys: ["graph:member"],
        capabilityGrantIds: ["grant-1"],
        capabilityVersion: 4,
      }),
      async onPrincipalLookup(request) {
        expect(await request.json()).toEqual({
          graphId: "graph:global",
          email: "operator@example.com",
          subject: {
            issuer: "better-auth",
            provider: "user",
            providerAccountId: "user-better-auth",
            authUserId: "user-better-auth",
          },
        });
      },
    });
    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        return {
          session: { id: "session-better-auth" },
          user: { id: "user-better-auth", email: "operator@example.com" },
        };
      },
    });

    const response = await handler.fetch(
      new Request("https://web.local/api/tx", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: "tx:web:2",
          ops: [],
        }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(principalLookupPaths).toEqual([webGraphAuthoritySessionPrincipalLookupPath]);
    expect(readForwardedAuthorization()).toEqual({
      graphId: "graph:global",
      principalId: "principal:user-better-auth",
      principalKind: "human",
      sessionId: "session-better-auth",
      roleKeys: ["graph:member"],
      capabilityGrantIds: ["grant-1"],
      capabilityVersion: 4,
      policyVersion: 0,
    });
  });

  it("fails closed when an authenticated request has no graph principal projection", async () => {
    const { authorityPaths, env, principalLookupPaths } = createWorkerEnv();
    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        return {
          session: { id: "session-better-auth" },
          user: { id: "user-better-auth" },
        };
      },
    });

    const response = await handler.fetch(
      new Request("https://web.local/api/tx", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: "tx:web:3",
          ops: [],
        }),
      }),
      env,
    );

    expect(response.status).toBe(403);
    expect(authorityPaths).toEqual([]);
    expect(principalLookupPaths).toEqual([webGraphAuthoritySessionPrincipalLookupPath]);
    expect(await response.json()).toMatchObject({
      code: "auth.principal_missing",
    });
  });

  it("surfaces conflicting authority-owned principal lookups without forwarding the graph request", async () => {
    const { authorityPaths, env, principalLookupPaths } = createWorkerEnv({
      principalLookupResponse: Response.json(
        {
          error:
            'Multiple active graph principals are linked to Better Auth user "user-better-auth".',
          code: "auth.principal_missing",
        },
        {
          status: 409,
        },
      ),
    });
    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        return {
          session: { id: "session-better-auth" },
          user: { id: "user-better-auth" },
        };
      },
    });

    const response = await handler.fetch(
      new Request("https://web.local/api/tx", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: "tx:web:3b",
          ops: [],
        }),
      }),
      env,
    );

    expect(response.status).toBe(409);
    expect(authorityPaths).toEqual([]);
    expect(principalLookupPaths).toEqual([webGraphAuthoritySessionPrincipalLookupPath]);
    expect(await response.json()).toMatchObject({
      code: "auth.principal_missing",
    });
  });

  it("treats revoked Better Auth session cookies as anonymous graph requests", async () => {
    const { env, readForwardedAuthorization } = createWorkerEnv();
    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        return null;
      },
    });

    const response = await handler.fetch(
      new Request("https://web.local/api/tx", {
        method: "POST",
        headers: {
          cookie: "better-auth.session_token=revoked",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: "tx:web:4",
          ops: [],
        }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(readForwardedAuthorization()).toMatchObject({
      principalId: null,
      principalKind: null,
      sessionId: null,
    });
  });

  it("fails closed when Better Auth returns a malformed session payload", async () => {
    const { authorityPaths, env } = createWorkerEnv();
    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        return {
          session: { id: "" },
          user: { id: "user-better-auth" },
        } as never;
      },
    });

    const response = await handler.fetch(
      new Request("https://web.local/api/tx", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: "tx:web:5",
          ops: [],
        }),
      }),
      env,
    );

    expect(response.status).toBe(503);
    expect(authorityPaths).toEqual([]);
    expect(await response.json()).toMatchObject({
      code: "auth.session_invalid",
    });
  });

  it("returns 503 when session verification fails for a request carrying Better Auth cookies", async () => {
    const { authorityPaths, env } = createWorkerEnv();
    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        throw new BetterAuthSessionVerificationError(new Error("AUTH_DB unavailable"));
      },
    });

    const response = await handler.fetch(
      new Request("https://web.local/api/tx", {
        method: "POST",
        headers: {
          cookie: "better-auth.session_token=present",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: "tx:web:6",
          ops: [],
        }),
      }),
      env,
    );

    expect(response.status).toBe(503);
    expect(authorityPaths).toEqual([]);
    expect(await response.json()).toMatchObject({
      code: "auth.session_unavailable",
    });
  });

  it("does not forward removed /api/secret-fields requests to the graph authority durable object", async () => {
    const { assetPaths, authorityPaths, env } = createWorkerEnv({
      assetResponse: new Response("missing", { status: 404 }),
    });

    const response = await worker.fetch(
      new Request("https://web.local/api/secret-fields", {
        method: "POST",
      }),
      env,
    );

    expect(response.status).toBe(404);
    expect(assetPaths).toEqual(["/api/secret-fields"]);
    expect(authorityPaths).toEqual([]);
  });
});

describe("web worker admission flows", () => {
  it("bootstraps the first operator end to end through the worker command and lookup paths without binding roles", async () => {
    const { durableObject, env } = createEndToEndWorkerEnv();
    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        return {
          session: { id: "session-bootstrap" },
          user: { id: "user-bootstrap", email: "operator@example.com" },
        };
      },
    });

    const bootstrapResponse = await handler.fetch(
      new Request("https://web.local/api/commands", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "bootstrap-operator-access",
          input: {
            email: "operator@example.com",
            graphId: "graph:global",
          },
        }),
      }),
      env,
    );
    const txResponse = await handler.fetch(new Request("https://web.local/api/sync"), env);
    const authority = await getDurableAuthority(durableObject);
    const graph = readCoreGraph(authority);

    expect(bootstrapResponse.status).toBe(201);
    expect(await bootstrapResponse.json()).toMatchObject({
      created: true,
      email: "operator@example.com",
      graphId: "graph:global",
      roleKeys: ["graph:authority", "graph:owner"],
    });
    expect(txResponse.status).toBe(200);
    expect(graph.principal.list()).toHaveLength(1);
    expect(graph.principalRoleBinding.list()).toHaveLength(0);
  });

  it("admits explicit allowlist approvals end to end even when self-signup remains closed", async () => {
    const { durableObject, env } = createEndToEndWorkerEnv();
    const authority = await getDurableAuthority(durableObject);

    await authority.executeCommand(
      {
        kind: "bootstrap-operator-access",
        input: {
          email: "operator@example.com",
          graphId: "graph:global",
        },
      },
      {
        authorization: createAnonymousAuthorizationContext({
          graphId: "graph:global",
          policyVersion: 0,
        }),
      },
    );
    await authority.executeCommand(
      {
        kind: "set-admission-approval",
        input: {
          email: "approved@example.com",
          graphId: "graph:global",
          roleKeys: ["graph:member"],
        },
      },
      { authorization: authorityAuthorization },
    );

    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        return {
          session: { id: "session-allow" },
          user: { id: "user-allow", email: "approved@example.com" },
        };
      },
    });
    const response = await handler.fetch(new Request("https://web.local/api/sync"), env);
    const graph = readCoreGraph(authority);

    expect(response.status).toBe(200);
    expect(graph.principal.list()).toHaveLength(1);
    expect(graph.authSubjectProjection.list()).toHaveLength(1);
    expect(graph.principalRoleBinding.list()).toHaveLength(0);
  });

  it("admits domain-gated open signup end to end through the worker lookup path without binding roles", async () => {
    const { durableObject, env } = createEndToEndWorkerEnv();
    const authority = await getDurableAuthority(durableObject);

    await writeAdmissionPolicy(authority, {
      allowedEmailDomain: ["allowed.example"],
      bootstrapMode: core.admissionBootstrapMode.values.manual.id,
      signupPolicy: core.admissionSignupPolicy.values.open.id,
      signupRoleKey: ["graph:member"],
    });

    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        return {
          session: { id: "session-domain-allow" },
          user: { id: "user-domain-allow", email: "operator@allowed.example" },
        };
      },
    });
    const response = await handler.fetch(new Request("https://web.local/api/sync"), env);
    const graph = readCoreGraph(authority);

    expect(response.status).toBe(200);
    expect(graph.principal.list()).toHaveLength(1);
    expect(graph.principalRoleBinding.list()).toHaveLength(0);
  });

  it("fails closed end to end when the domain gate denies first authenticated use", async () => {
    const { durableObject, env } = createEndToEndWorkerEnv();
    const authority = await getDurableAuthority(durableObject);

    await writeAdmissionPolicy(authority, {
      allowedEmailDomain: ["allowed.example"],
      bootstrapMode: core.admissionBootstrapMode.values.manual.id,
      signupPolicy: core.admissionSignupPolicy.values.open.id,
      signupRoleKey: ["graph:member"],
    });

    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        return {
          session: { id: "session-domain-deny" },
          user: { id: "user-domain-deny", email: "operator@blocked.example" },
        };
      },
    });
    const response = await handler.fetch(new Request("https://web.local/api/sync"), env);
    const graph = readCoreGraph(authority);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "auth.principal_missing",
      error: expect.stringContaining("Admission policy denied first authenticated use"),
    });
    expect(graph.principal.list()).toHaveLength(0);
    expect(graph.authSubjectProjection.list()).toHaveLength(0);
    expect(graph.principalRoleBinding.list()).toHaveLength(0);
  });

  it("keeps admitted-but-unbound principals unbound until access activation", async () => {
    const { durableObject, env } = createEndToEndWorkerEnv();
    const authority = await getDurableAuthority(durableObject);

    await createProjectedPrincipalWithoutBindings(authority, {
      email: "approved@example.com",
      userId: "user-repair",
    });
    await authority.executeCommand(
      {
        kind: "set-admission-approval",
        input: {
          email: "approved@example.com",
          graphId: "graph:global",
          roleKeys: ["graph:member"],
        },
      },
      { authorization: authorityAuthorization },
    );

    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        return {
          session: { id: "session-repair" },
          user: { id: "user-repair", email: "approved@example.com" },
        };
      },
    });
    const response = await handler.fetch(new Request("https://web.local/api/sync"), env);
    const graph = readCoreGraph(authority);

    expect(response.status).toBe(200);
    expect(graph.principal.list()).toHaveLength(1);
    expect(graph.authSubjectProjection.list()).toHaveLength(1);
    expect(graph.principalRoleBinding.list()).toHaveLength(0);
  });

  it("binds member access explicitly end to end for admitted principals", async () => {
    const { durableObject, env } = createEndToEndWorkerEnv();
    const authority = await getDurableAuthority(durableObject);

    await authority.executeCommand(
      {
        kind: "set-admission-approval",
        input: {
          email: "approved@example.com",
          graphId: "graph:global",
          roleKeys: ["graph:member"],
        },
      },
      { authorization: authorityAuthorization },
    );

    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        return {
          session: { id: "session-bind-member" },
          user: { id: "user-bind-member", email: "approved@example.com" },
        };
      },
    });

    await handler.fetch(new Request("https://web.local/api/sync"), env);
    const activation = await handler.fetch(
      new Request("https://web.local/api/access/activate", {
        method: "POST",
      }),
      env,
    );
    const graph = readCoreGraph(authority);

    expect(activation.status).toBe(200);
    expect(await activation.json()).toMatchObject({
      roleKeys: ["graph:member"],
      capabilityVersion: 1,
    });
    expect(graph.principalRoleBinding.list()).toEqual(
      expect.arrayContaining([expect.objectContaining({ roleKey: "graph:member" })]),
    );
  });

  it("binds operator access explicitly end to end after bootstrap admission", async () => {
    const { durableObject, env } = createEndToEndWorkerEnv();
    const authority = await getDurableAuthority(durableObject);

    await authority.executeCommand(
      {
        kind: "bootstrap-operator-access",
        input: {
          email: "operator@example.com",
          graphId: "graph:global",
        },
      },
      {
        authorization: createAnonymousAuthorizationContext({
          graphId: "graph:global",
          policyVersion: 0,
        }),
      },
    );

    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        return {
          session: { id: "session-bind-operator" },
          user: { id: "user-bind-operator", email: "operator@example.com" },
        };
      },
    });

    await handler.fetch(new Request("https://web.local/api/sync"), env);
    const activation = await handler.fetch(
      new Request("https://web.local/api/access/activate", {
        method: "POST",
      }),
      env,
    );
    const graph = readCoreGraph(authority);

    expect(activation.status).toBe(200);
    expect(await activation.json()).toMatchObject({
      roleKeys: ["graph:authority", "graph:owner"],
      capabilityVersion: 1,
    });
    expect(graph.principalRoleBinding.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roleKey: "graph:authority" }),
        expect.objectContaining({ roleKey: "graph:owner" }),
      ]),
    );
  });
});
