import { readFileSync } from "node:fs";

import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { parseSetCookieHeader } from "better-auth/cookies";

import type { AuthorizationContext, WebPrincipalSummary } from "@io/graph-authority";
import { createGraphClient } from "@io/graph-client";
import { createGraphStore, type GraphStoreSnapshot } from "@io/graph-kernel";
import { type GraphWriteTransaction } from "@io/graph-kernel";
import { core } from "@io/graph-module-core";
import { workflow } from "@io/graph-module-workflow";

import { createAnonymousAuthorizationContext, issueBearerShareToken } from "../lib/auth-bridge.js";
import {
  completeLocalhostOnboarding,
  redeemLocalhostBootstrapCredential,
  startLocalhostBootstrapSession,
  WebAuthRequestError,
  webGraphAccessActivationPath,
  webGraphCommandsPath,
  webPrincipalBootstrapPath,
} from "../lib/auth-client.js";
import { createTestWebAppAuthority } from "../lib/authority-test-helpers.js";
import type { WebAppAuthority } from "../lib/authority.js";
import type { BetterAuthWorkerEnv } from "../lib/better-auth.js";
import {
  WebGraphAuthorityDurableObject,
  webGraphAuthorityBearerShareLookupPath,
  webGraphAuthorityPolicyVersionPath,
  webGraphAuthoritySessionPrincipalLookupPath,
} from "../lib/graph-authority-do.js";
import {
  createLocalhostSyntheticEmail,
  defineLocalhostBootstrapCredential,
  localhostBootstrapIssuePath,
  localhostBootstrapRedeemPath,
  type LocalhostBootstrapCredential,
} from "../lib/local-bootstrap.js";
import { webSerializedQueryPath } from "../lib/query-transport.js";
import { readRequestAuthorizationContext } from "../lib/server-routes.js";
import { webWorkflowLivePath } from "../lib/workflow-live-transport.js";
import { webWorkflowReadPath } from "../lib/workflow-transport.js";
import {
  BetterAuthSessionVerificationError,
  createWorkerFetchHandler,
  webAppBootstrapPath,
} from "./index.js";
import worker from "./index.js";

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

const betterAuthSchemaSql = readFileSync(
  new URL("../../../migrations/auth-store/0001_better_auth.sql", import.meta.url),
  "utf8",
);

function createSessionPrincipalProjectionResponse(
  overrides: Partial<WebPrincipalSummary> = {},
): Record<string, unknown> {
  const summary: WebPrincipalSummary = {
    graphId: "graph:global",
    principalId: "principal:user-better-auth",
    principalKind: "human",
    roleKeys: ["graph:member"],
    capabilityGrantIds: ["grant-1"],
    access: {
      authority: false,
      graphMember: true,
      sharedRead: false,
    },
    capabilityVersion: 4,
    policyVersion: 0,
    ...overrides,
  };

  return {
    summary,
    principalId: summary.principalId,
    principalKind: summary.principalKind,
    roleKeys: summary.roleKeys,
    capabilityGrantIds: summary.capabilityGrantIds,
    capabilityVersion: summary.capabilityVersion,
  };
}

function createBetterAuthEnv(
  overrides: Partial<Omit<BetterAuthWorkerEnv, "AUTH_DB">> & {
    readonly AUTH_DB?: Database;
  } = {},
): BetterAuthWorkerEnv {
  return {
    AUTH_DB: overrides.AUTH_DB ?? new Database(":memory:"),
    BETTER_AUTH_SECRET:
      overrides.BETTER_AUTH_SECRET ?? "L5tH1pQ8xJ2mR9vN4sC7kW3yF6uB0dE!ZaG1oP5qT8xV2",
    ...(overrides.BETTER_AUTH_TRUSTED_ORIGINS
      ? { BETTER_AUTH_TRUSTED_ORIGINS: overrides.BETTER_AUTH_TRUSTED_ORIGINS }
      : {}),
    BETTER_AUTH_URL: overrides.BETTER_AUTH_URL ?? "https://web.local",
  };
}

function applyBetterAuthSchema(env: BetterAuthWorkerEnv): void {
  if (!(env.AUTH_DB instanceof Database)) {
    throw new Error("Worker tests expect a Bun sqlite AUTH_DB binding.");
  }

  env.AUTH_DB.exec(betterAuthSchemaSql);
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

function createMutationStore(snapshot: GraphStoreSnapshot) {
  const mutationStore = createGraphStore(snapshot);
  return {
    mutationGraph: createGraphClient(mutationStore, core),
    mutationStore,
  };
}

function buildGraphWriteTransaction(
  before: GraphStoreSnapshot,
  after: GraphStoreSnapshot,
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
  return createGraphClient(createGraphStore(authority.readSnapshot({ authorization })), core);
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

function createEndToEndWorkerEnv(
  input: {
    readonly betterAuthEnv?: BetterAuthWorkerEnv;
  } = {},
) {
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
    ...(input.betterAuthEnv ?? createBetterAuthEnv()),
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
    readonly betterAuthEnv?: BetterAuthWorkerEnv;
    readonly policyVersionLookupResponse?: Response;
    readonly resolvePolicyVersionLookupResponse?: (
      request: Request,
    ) => Response | Promise<Response>;
    readonly principalLookupResponse?: Response;
    readonly onAuthorityFetch?: (request: Request) => Promise<void> | void;
    readonly onBearerLookup?: (request: Request) => Promise<void> | void;
    readonly onPolicyVersionLookup?: (request: Request) => Promise<void> | void;
    readonly onPrincipalLookup?: (request: Request) => Promise<void> | void;
  } = {},
) {
  const assetPaths: string[] = [];
  const authorityPaths: string[] = [];
  const bearerLookupPaths: string[] = [];
  const policyVersionLookupPaths: string[] = [];
  const principalLookupPaths: string[] = [];
  const forwardedAuthorizations: AuthorizationContext[] = [];
  let forwardedAuthorization: AuthorizationContext | null = null;

  const env = {
    ...(input.betterAuthEnv ?? createBetterAuthEnv()),
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
              return input.bearerLookupResponse?.clone() ?? new Response(null, { status: 404 });
            }

            if (pathname === webGraphAuthorityPolicyVersionPath) {
              policyVersionLookupPaths.push(pathname);
              await input.onPolicyVersionLookup?.(request);
              if (input.resolvePolicyVersionLookupResponse) {
                return input.resolvePolicyVersionLookupResponse(request);
              }
              return (
                input.policyVersionLookupResponse?.clone() ??
                Response.json({
                  policyVersion: 17,
                })
              );
            }

            if (pathname === webGraphAuthoritySessionPrincipalLookupPath) {
              principalLookupPaths.push(pathname);
              await input.onPrincipalLookup?.(request);
              return input.principalLookupResponse?.clone() ?? new Response(null, { status: 404 });
            }

            authorityPaths.push(pathname);
            forwardedAuthorization = readRequestAuthorizationContext(request);
            forwardedAuthorizations.push(forwardedAuthorization);
            await input.onAuthorityFetch?.(request);
            return input.authorityResponse?.clone() ?? new Response("ok");
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
    policyVersionLookupPaths,
    principalLookupPaths,
    readForwardedAuthorization() {
      return forwardedAuthorization;
    },
    readForwardedAuthorizations() {
      return [...forwardedAuthorizations];
    },
  };
}

function readSessionCookieHeader(setCookieHeader: string): string {
  const sessionCookie = parseSetCookieHeader(setCookieHeader).get("better-auth.session_token");
  if (!sessionCookie) {
    throw new Error("Expected the Better Auth session cookie to be present.");
  }

  return `better-auth.session_token=${encodeURIComponent(sessionCookie.value)}`;
}

function expireStoredLocalhostBootstrapCredential(database: Database): void {
  const stored = database.query('select "id", "value" from "verification"').get() as {
    readonly id: string;
    readonly value: string;
  } | null;

  if (!stored) {
    throw new Error("Expected an issued localhost bootstrap credential in the auth store.");
  }

  const now = Date.now();
  const expiredCredential = defineLocalhostBootstrapCredential({
    ...(JSON.parse(stored.value) as LocalhostBootstrapCredential),
    issuedAt: new Date(now - 2 * 60 * 1000).toISOString(),
    expiresAt: new Date(now - 60 * 1000).toISOString(),
  });
  database
    .query('update "verification" set "value" = ?, "expiresAt" = ?, "updatedAt" = ? where "id" = ?')
    .run(
      JSON.stringify(expiredCredential),
      expiredCredential.expiresAt,
      expiredCredential.issuedAt,
      stored.id,
    );
}

function readStoredAuthUser(database: Database): {
  readonly email: string;
  readonly id: string;
} {
  const user = database.query('select "id", "email" from "user"').get() as {
    readonly email: string;
    readonly id: string;
  } | null;

  if (!user) {
    throw new Error("Expected a Better Auth user to exist for the local browser session.");
  }

  return user;
}

function createBrowserWorkerSession(input: {
  readonly env: Parameters<typeof worker.fetch>[1];
  readonly handler: ReturnType<typeof createWorkerFetchHandler>;
  readonly origin: string;
  readonly onResponse?: (context: {
    readonly path: string;
    readonly request: Request;
    readonly response: Response;
  }) => Promise<void> | void;
}) {
  let cookieHeader: string | null = null;
  const paths: string[] = [];

  return {
    async fetcher(path: string, init?: RequestInit): Promise<Response> {
      const requestUrl = new URL(path, input.origin);
      const headers = new Headers(init?.headers);
      const method = init?.method ?? "GET";

      if (cookieHeader && init?.credentials !== "omit") {
        headers.set("cookie", cookieHeader);
      }
      if (method !== "GET" && method !== "HEAD" && !headers.has("origin")) {
        headers.set("origin", input.origin);
      }

      const request = new Request(requestUrl, {
        ...init,
        headers,
      });
      paths.push(requestUrl.pathname);

      const response = await input.handler.fetch(request, input.env);
      const setCookieHeader = response.headers.get("set-cookie");
      if (setCookieHeader) {
        cookieHeader = readSessionCookieHeader(setCookieHeader);
      }
      await input.onResponse?.({
        path: requestUrl.pathname,
        request,
        response,
      });
      return response;
    },
    readCookieHeader(): string | null {
      return cookieHeader;
    },
    readPaths(): readonly string[] {
      return [...paths];
    },
  };
}

describe("web worker route forwarding", () => {
  it("returns the explicit signed-out bootstrap payload for anonymous callers", async () => {
    const { authorityPaths, env, principalLookupPaths } = createWorkerEnv();
    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        return null;
      },
    });

    const response = await handler.fetch(
      new Request(`https://web.local${webAppBootstrapPath}`),
      env,
    );

    expect(response.status).toBe(200);
    expect(authorityPaths).toEqual([]);
    expect(principalLookupPaths).toEqual([]);
    expect(await response.json()).toEqual({
      session: {
        authState: "signed-out",
        sessionId: null,
        principalId: null,
        capabilityVersion: null,
      },
      principal: null,
    });
  });

  it("returns the authenticated principal-summary bootstrap payload", async () => {
    const { authorityPaths, env, principalLookupPaths } = createWorkerEnv({
      principalLookupResponse: Response.json(createSessionPrincipalProjectionResponse()),
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
      new Request(`https://web.local${webAppBootstrapPath}`),
      env,
    );

    expect(response.status).toBe(200);
    expect(authorityPaths).toEqual([]);
    expect(principalLookupPaths).toEqual([webGraphAuthoritySessionPrincipalLookupPath]);
    expect(await response.json()).toEqual({
      session: {
        authState: "ready",
        sessionId: "session-better-auth",
        principalId: "principal:user-better-auth",
        capabilityVersion: 4,
        displayName: "operator@example.com",
      },
      principal: {
        graphId: "graph:global",
        principalId: "principal:user-better-auth",
        principalKind: "human",
        roleKeys: ["graph:member"],
        capabilityGrantIds: ["grant-1"],
        access: {
          authority: false,
          graphMember: true,
          sharedRead: false,
        },
        capabilityVersion: 4,
        policyVersion: 0,
      },
    });
  });

  it("reports stale auth cookies as an explicit expired bootstrap state", async () => {
    const { authorityPaths, env, principalLookupPaths } = createWorkerEnv();
    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        return null;
      },
    });

    const response = await handler.fetch(
      new Request(`https://web.local${webAppBootstrapPath}`, {
        headers: {
          cookie: "better-auth.session_token=revoked",
        },
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(authorityPaths).toEqual([]);
    expect(principalLookupPaths).toEqual([]);
    expect(await response.json()).toEqual({
      session: {
        authState: "expired",
        sessionId: null,
        principalId: null,
        capabilityVersion: null,
      },
      principal: null,
    });
  });

  it("fails closed when bootstrap cannot resolve an authenticated principal projection", async () => {
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
      new Request(`https://web.local${webAppBootstrapPath}`),
      env,
    );

    expect(response.status).toBe(403);
    expect(authorityPaths).toEqual([]);
    expect(principalLookupPaths).toEqual([webGraphAuthoritySessionPrincipalLookupPath]);
    expect(await response.json()).toMatchObject({
      code: "auth.principal_missing",
    });
  });

  it("returns 503 for bootstrap reads when Better Auth session verification is unavailable", async () => {
    const { authorityPaths, env, principalLookupPaths } = createWorkerEnv();
    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        throw new BetterAuthSessionVerificationError(new Error("AUTH_DB unavailable"));
      },
    });

    const response = await handler.fetch(
      new Request(`https://web.local${webAppBootstrapPath}`, {
        headers: {
          cookie: "better-auth.session_token=present",
        },
      }),
      env,
    );

    expect(response.status).toBe(503);
    expect(authorityPaths).toEqual([]);
    expect(principalLookupPaths).toEqual([]);
    expect(await response.json()).toMatchObject({
      code: "auth.session_unavailable",
    });
  });

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
    const {
      authorityPaths,
      env,
      policyVersionLookupPaths,
      principalLookupPaths,
      readForwardedAuthorization,
    } = createWorkerEnv({
      principalLookupResponse: Response.json(createSessionPrincipalProjectionResponse()),
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
    expect(policyVersionLookupPaths).toEqual([webGraphAuthorityPolicyVersionPath]);
    expect(principalLookupPaths).toEqual([webGraphAuthoritySessionPrincipalLookupPath]);
    expect(readForwardedAuthorization()).toEqual({
      graphId: "graph:global",
      principalId: "principal:user-better-auth",
      principalKind: "human",
      sessionId: "session-better-auth",
      roleKeys: ["graph:member"],
      capabilityGrantIds: ["grant-1"],
      capabilityVersion: 4,
      policyVersion: 17,
    });
  });

  it("forwards authenticated generic serialized queries over the shared query route", async () => {
    const {
      authorityPaths,
      env,
      policyVersionLookupPaths,
      principalLookupPaths,
      readForwardedAuthorization,
    } = createWorkerEnv({
      principalLookupResponse: Response.json(createSessionPrincipalProjectionResponse()),
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
      new Request(`https://web.local${webSerializedQueryPath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          version: 1,
          query: {
            kind: "entity",
            entityId: "entity:test",
          },
        }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(authorityPaths).toEqual([webSerializedQueryPath]);
    expect(policyVersionLookupPaths).toEqual([webGraphAuthorityPolicyVersionPath]);
    expect(principalLookupPaths).toEqual([webGraphAuthoritySessionPrincipalLookupPath]);
    expect(readForwardedAuthorization()).toEqual({
      graphId: "graph:global",
      principalId: "principal:user-better-auth",
      principalKind: "human",
      sessionId: "session-better-auth",
      roleKeys: ["graph:member"],
      capabilityGrantIds: ["grant-1"],
      capabilityVersion: 4,
      policyVersion: 17,
    });
  });

  it("forwards bearer share sync requests with anonymous shared-read authorization", async () => {
    const issued = await issueBearerShareToken();
    const {
      authorityPaths,
      bearerLookupPaths,
      env,
      policyVersionLookupPaths,
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
    expect(policyVersionLookupPaths).toEqual([webGraphAuthorityPolicyVersionPath]);
    expect(principalLookupPaths).toEqual([]);
    expect(readForwardedAuthorization()).toEqual({
      graphId: "graph:global",
      principalId: null,
      principalKind: "anonymous",
      sessionId: null,
      roleKeys: [],
      capabilityGrantIds: ["grant:bearer-share"],
      capabilityVersion: 0,
      policyVersion: 17,
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

  it("fails closed when the authority cannot resolve the current policy version", async () => {
    const { authorityPaths, env, policyVersionLookupPaths, principalLookupPaths } = createWorkerEnv(
      {
        policyVersionLookupResponse: Response.json(
          {
            error: "Policy version unavailable during authority restart.",
            code: "policy.unavailable",
          },
          {
            status: 503,
          },
        ),
      },
    );
    const handler = createWorkerFetchHandler();

    const response = await handler.fetch(
      new Request("https://web.local/api/tx", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: "tx:web:policy-version-failure",
          ops: [],
        }),
      }),
      env,
    );

    expect(response.status).toBe(503);
    expect(authorityPaths).toEqual([]);
    expect(policyVersionLookupPaths).toEqual([webGraphAuthorityPolicyVersionPath]);
    expect(principalLookupPaths).toEqual([]);
    expect(await response.json()).toMatchObject({
      code: "policy.unavailable",
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
    const {
      authorityPaths,
      env,
      policyVersionLookupPaths,
      principalLookupPaths,
      readForwardedAuthorization,
    } = createWorkerEnv({
      principalLookupResponse: Response.json(createSessionPrincipalProjectionResponse()),
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
            "scope:kind=module&moduleId=workflow&scopeId=scope%3Aworkflow%3Areview&definitionHash=scope-def%3Aworkflow%3Areview%3Av1&policyFilterVersion=policy%3A0&cursor=web-authority%3A1",
        }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(authorityPaths).toEqual([webWorkflowLivePath]);
    expect(policyVersionLookupPaths).toEqual([webGraphAuthorityPolicyVersionPath]);
    expect(principalLookupPaths).toEqual([webGraphAuthoritySessionPrincipalLookupPath]);
    expect(readForwardedAuthorization()).toEqual({
      graphId: "graph:global",
      principalId: "principal:user-better-auth",
      principalKind: "human",
      sessionId: "session-better-auth",
      roleKeys: ["graph:member"],
      capabilityGrantIds: ["grant-1"],
      capabilityVersion: 4,
      policyVersion: 17,
    });
  });
  it("forwards unauthenticated graph writes with an anonymous authorization context", async () => {
    const { env, policyVersionLookupPaths, readForwardedAuthorization } = createWorkerEnv();
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
    expect(policyVersionLookupPaths).toEqual([webGraphAuthorityPolicyVersionPath]);
    expect(readForwardedAuthorization()).toEqual({
      graphId: "graph:global",
      principalId: null,
      principalKind: null,
      sessionId: null,
      roleKeys: [],
      capabilityGrantIds: [],
      capabilityVersion: 0,
      policyVersion: 17,
    });
  });

  it("forwards authenticated graph writes with a session-derived authorization context", async () => {
    const { env, policyVersionLookupPaths, principalLookupPaths, readForwardedAuthorization } =
      createWorkerEnv({
        principalLookupResponse: Response.json(createSessionPrincipalProjectionResponse()),
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
    expect(policyVersionLookupPaths).toEqual([webGraphAuthorityPolicyVersionPath]);
    expect(principalLookupPaths).toEqual([webGraphAuthoritySessionPrincipalLookupPath]);
    expect(readForwardedAuthorization()).toEqual({
      graphId: "graph:global",
      principalId: "principal:user-better-auth",
      principalKind: "human",
      sessionId: "session-better-auth",
      roleKeys: ["graph:member"],
      capabilityGrantIds: ["grant-1"],
      capabilityVersion: 4,
      policyVersion: 17,
    });
  });

  it("refreshes the forwarded authorization context when the authority policy version changes between requests", async () => {
    let policyVersionLookupCount = 0;
    const { env, policyVersionLookupPaths, principalLookupPaths, readForwardedAuthorizations } =
      createWorkerEnv({
        principalLookupResponse: Response.json(createSessionPrincipalProjectionResponse()),
        resolvePolicyVersionLookupResponse() {
          policyVersionLookupCount += 1;
          return Response.json({
            policyVersion: policyVersionLookupCount === 1 ? 17 : 18,
          });
        },
      });
    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        return {
          session: { id: "session-better-auth" },
          user: { id: "user-better-auth" },
        };
      },
    });

    const firstResponse = await handler.fetch(
      new Request("https://web.local/api/tx", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: "tx:web:policy-v17",
          ops: [],
        }),
      }),
      env,
    );
    const secondResponse = await handler.fetch(
      new Request("https://web.local/api/tx", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: "tx:web:policy-v18",
          ops: [],
        }),
      }),
      env,
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(policyVersionLookupPaths).toEqual([
      webGraphAuthorityPolicyVersionPath,
      webGraphAuthorityPolicyVersionPath,
    ]);
    expect(principalLookupPaths).toEqual([
      webGraphAuthoritySessionPrincipalLookupPath,
      webGraphAuthoritySessionPrincipalLookupPath,
    ]);
    expect(readForwardedAuthorizations()).toEqual([
      expect.objectContaining({
        principalId: "principal:user-better-auth",
        policyVersion: 17,
      }),
      expect.objectContaining({
        principalId: "principal:user-better-auth",
        policyVersion: 18,
      }),
    ]);
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

describe("web worker localhost bootstrap routes", () => {
  it("issues a localhost-only bootstrap credential for the configured local origin", async () => {
    const localAuthEnv = createBetterAuthEnv({
      BETTER_AUTH_URL: "http://io.localhost:8787",
    });
    applyBetterAuthSchema(localAuthEnv);
    const { authorityPaths, env, principalLookupPaths } = createWorkerEnv({
      betterAuthEnv: localAuthEnv,
    });
    const handler = createWorkerFetchHandler();

    const response = await handler.fetch(
      new Request(`http://io.localhost:8787${localhostBootstrapIssuePath}`, {
        method: "POST",
      }),
      env,
    );

    expect(response.status).toBe(201);
    expect(authorityPaths).toEqual([]);
    expect(principalLookupPaths).toEqual([]);
    expect(
      defineLocalhostBootstrapCredential((await response.json()) as LocalhostBootstrapCredential),
    ).toMatchObject({
      redeemOrigin: "http://io.localhost:8787",
      syntheticIdentity: {
        email: createLocalhostSyntheticEmail("local:default"),
      },
    });
  });

  it("redeems a localhost bootstrap credential into a real Better Auth session cookie", async () => {
    const localAuthEnv = createBetterAuthEnv({
      BETTER_AUTH_URL: "http://io.localhost:8787",
    });
    applyBetterAuthSchema(localAuthEnv);

    const { authorityPaths, env, principalLookupPaths } = createWorkerEnv({
      betterAuthEnv: localAuthEnv,
      principalLookupResponse: Response.json(createSessionPrincipalProjectionResponse()),
      async onPrincipalLookup(request) {
        expect(await request.json()).toMatchObject({
          graphId: "graph:global",
          email: createLocalhostSyntheticEmail("local:default"),
          subject: {
            issuer: "better-auth",
            provider: "user",
            providerAccountId: expect.any(String),
            authUserId: expect.any(String),
          },
        });
      },
    });
    const handler = createWorkerFetchHandler();

    const issueResponse = await handler.fetch(
      new Request(`http://io.localhost:8787${localhostBootstrapIssuePath}`, {
        method: "POST",
      }),
      env,
    );
    const credential = defineLocalhostBootstrapCredential(
      (await issueResponse.json()) as LocalhostBootstrapCredential,
    );

    const redeemResponse = await handler.fetch(
      new Request(`http://io.localhost:8787${localhostBootstrapRedeemPath}`, {
        method: "POST",
        headers: {
          origin: "http://io.localhost:8787",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          token: credential.token,
        }),
      }),
      env,
    );

    expect(redeemResponse.status).toBe(204);
    const setCookieHeader = redeemResponse.headers.get("set-cookie");
    expect(setCookieHeader).toBeTruthy();

    const bootstrapResponse = await handler.fetch(
      new Request(`http://io.localhost:8787${webAppBootstrapPath}`, {
        headers: {
          cookie: readSessionCookieHeader(setCookieHeader!),
        },
      }),
      env,
    );

    expect(authorityPaths).toEqual([]);
    expect(principalLookupPaths).toEqual([webGraphAuthoritySessionPrincipalLookupPath]);
    expect(bootstrapResponse.status).toBe(200);
    expect(await bootstrapResponse.json()).toMatchObject({
      session: {
        authState: "ready",
      },
      principal: expect.objectContaining({
        principalId: "principal:user-better-auth",
      }),
    });
  });

  it("rejects replayed localhost bootstrap credentials", async () => {
    const localAuthEnv = createBetterAuthEnv({
      BETTER_AUTH_URL: "http://io.localhost:8787",
    });
    applyBetterAuthSchema(localAuthEnv);

    const { env } = createWorkerEnv({
      betterAuthEnv: localAuthEnv,
    });
    const handler = createWorkerFetchHandler();

    const issueResponse = await handler.fetch(
      new Request(`http://io.localhost:8787${localhostBootstrapIssuePath}`, {
        method: "POST",
      }),
      env,
    );
    const credential = defineLocalhostBootstrapCredential(
      (await issueResponse.json()) as LocalhostBootstrapCredential,
    );

    const firstRedeem = await handler.fetch(
      new Request(`http://io.localhost:8787${localhostBootstrapRedeemPath}`, {
        method: "POST",
        headers: {
          origin: "http://io.localhost:8787",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          token: credential.token,
        }),
      }),
      env,
    );
    const secondRedeem = await handler.fetch(
      new Request(`http://io.localhost:8787${localhostBootstrapRedeemPath}`, {
        method: "POST",
        headers: {
          origin: "http://io.localhost:8787",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          token: credential.token,
        }),
      }),
      env,
    );

    expect(firstRedeem.status).toBe(204);
    expect(secondRedeem.status).toBe(401);
    expect(await secondRedeem.json()).toMatchObject({
      code: "auth.local_bootstrap_invalid",
    });
  });

  it("rejects expired localhost bootstrap credentials", async () => {
    const localAuthEnv = createBetterAuthEnv({
      BETTER_AUTH_URL: "http://io.localhost:8787",
    });
    applyBetterAuthSchema(localAuthEnv);
    const { env } = createWorkerEnv({
      betterAuthEnv: localAuthEnv,
    });
    const handler = createWorkerFetchHandler();

    const issueResponse = await handler.fetch(
      new Request(`http://io.localhost:8787${localhostBootstrapIssuePath}`, {
        method: "POST",
      }),
      env,
    );
    const issuedCredential = defineLocalhostBootstrapCredential(
      (await issueResponse.json()) as LocalhostBootstrapCredential,
    );

    const stored = localAuthEnv.AUTH_DB.query('select "id", "value" from "verification"').get() as {
      readonly id: string;
      readonly value: string;
    };
    const now = Date.now();
    const expiredCredential = defineLocalhostBootstrapCredential({
      ...(JSON.parse(stored.value) as LocalhostBootstrapCredential),
      issuedAt: new Date(now - 2 * 60 * 1000).toISOString(),
      expiresAt: new Date(now - 60 * 1000).toISOString(),
    });
    localAuthEnv.AUTH_DB.query(
      'update "verification" set "value" = ?, "expiresAt" = ?, "updatedAt" = ? where "id" = ?',
    ).run(
      JSON.stringify(expiredCredential),
      expiredCredential.expiresAt,
      expiredCredential.issuedAt,
      stored.id,
    );

    const redeemResponse = await handler.fetch(
      new Request(`http://io.localhost:8787${localhostBootstrapRedeemPath}`, {
        method: "POST",
        headers: {
          origin: "http://io.localhost:8787",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          token: issuedCredential.token,
        }),
      }),
      env,
    );

    expect(redeemResponse.status).toBe(410);
    expect(await redeemResponse.json()).toMatchObject({
      code: "auth.local_bootstrap_expired",
    });
  });

  it("denies localhost bootstrap routes for non-local worker origins", async () => {
    const { env } = createWorkerEnv();
    const handler = createWorkerFetchHandler();

    const issueResponse = await handler.fetch(
      new Request(`https://web.local${localhostBootstrapIssuePath}`, {
        method: "POST",
      }),
      env,
    );
    const redeemResponse = await handler.fetch(
      new Request(`https://web.local${localhostBootstrapRedeemPath}`, {
        method: "POST",
        headers: {
          origin: "https://web.local",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          token:
            "io_local_bootstrap_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        }),
      }),
      env,
    );

    expect(issueResponse.status).toBe(404);
    expect(redeemResponse.status).toBe(404);
    expect(await redeemResponse.json()).toMatchObject({
      code: "auth.local_bootstrap_unavailable",
    });
  });
});

describe("web worker localhost instant onboarding end to end", () => {
  it("turns one localhost click into a writable graph session", async () => {
    const localAuthEnv = createBetterAuthEnv({
      BETTER_AUTH_URL: "http://io.localhost:8787",
    });
    applyBetterAuthSchema(localAuthEnv);

    const { durableObject, env } = createEndToEndWorkerEnv({
      betterAuthEnv: localAuthEnv,
    });
    const authority = await getDurableAuthority(durableObject);
    const handler = createWorkerFetchHandler();
    const browser = createBrowserWorkerSession({
      handler,
      env,
      origin: "http://io.localhost:8787",
    });

    const payload = await completeLocalhostOnboarding({
      fetcher: browser.fetcher,
      origin: "http://io.localhost:8787",
    });

    expect(browser.readCookieHeader()).toBeTruthy();
    expect(browser.readPaths()).toEqual([
      localhostBootstrapIssuePath,
      localhostBootstrapRedeemPath,
      webPrincipalBootstrapPath,
      webGraphAccessActivationPath,
      webGraphCommandsPath,
      webGraphAccessActivationPath,
      webPrincipalBootstrapPath,
    ]);
    expect(payload).toMatchObject({
      session: {
        authState: "ready",
        displayName: createLocalhostSyntheticEmail("local:default"),
      },
      principal: {
        access: {
          authority: true,
          graphMember: true,
        },
      },
    });
    expect(payload.principal?.roleKeys).toEqual(
      expect.arrayContaining(["graph:authority", "graph:owner"]),
    );

    const mutationStore = createGraphStore(
      authority.readSnapshot({ authorization: authorityAuthorization }),
    );
    const workerGraph = { ...core, ...workflow } as const;
    const mutationGraph = createGraphClient(mutationStore, workerGraph);
    const beforeCreate = mutationStore.snapshot();
    const envVarId = mutationGraph.envVar.create({
      description: "Created through localhost instant onboarding",
      name: "LOCAL_ONBOARDING_TEST",
    });
    const transaction = buildGraphWriteTransaction(
      beforeCreate,
      mutationStore.snapshot(),
      "tx:localhost-onboarding-create-env-var",
    );

    const txResponse = await browser.fetcher("/api/tx", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(transaction),
    });

    expect(txResponse.status).toBe(200);
    expect(await txResponse.json()).toMatchObject({
      txId: "tx:localhost-onboarding-create-env-var",
      writeScope: "client-tx",
    });
    expect(
      createGraphClient(
        createGraphStore(authority.readSnapshot({ authorization: authorityAuthorization })),
        workerGraph,
      ).envVar.get(envVarId)?.description,
    ).toBe("Created through localhost instant onboarding");
  });

  it("fails clearly when the issued localhost credential expires before redemption", async () => {
    const localAuthEnv = createBetterAuthEnv({
      BETTER_AUTH_URL: "http://io.localhost:8787",
    });
    applyBetterAuthSchema(localAuthEnv);

    const { env } = createEndToEndWorkerEnv({
      betterAuthEnv: localAuthEnv,
    });
    const handler = createWorkerFetchHandler();
    const browser = createBrowserWorkerSession({
      handler,
      env,
      origin: "http://io.localhost:8787",
      onResponse({ path, response }) {
        if (path === localhostBootstrapIssuePath && response.ok) {
          expireStoredLocalhostBootstrapCredential(localAuthEnv.AUTH_DB);
        }
      },
    });

    let error: unknown;
    try {
      await completeLocalhostOnboarding({
        fetcher: browser.fetcher,
        origin: "http://io.localhost:8787",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(WebAuthRequestError);
    expect(error).toMatchObject({
      code: "auth.local_bootstrap_expired",
      status: 410,
    });
    expect(browser.readPaths()).toEqual([
      localhostBootstrapIssuePath,
      localhostBootstrapRedeemPath,
    ]);
  });

  it("rejects replayed localhost bootstrap redemptions through the real worker", async () => {
    const localAuthEnv = createBetterAuthEnv({
      BETTER_AUTH_URL: "http://io.localhost:8787",
    });
    applyBetterAuthSchema(localAuthEnv);

    const { env } = createEndToEndWorkerEnv({
      betterAuthEnv: localAuthEnv,
    });
    const handler = createWorkerFetchHandler();
    const browser = createBrowserWorkerSession({
      handler,
      env,
      origin: "http://io.localhost:8787",
    });

    const credential = await startLocalhostBootstrapSession({
      fetcher: browser.fetcher,
    });

    let error: unknown;
    try {
      await redeemLocalhostBootstrapCredential({
        fetcher: browser.fetcher,
        token: credential.token,
      });
    } catch (caught) {
      error = caught;
    }

    expect(browser.readCookieHeader()).toBeTruthy();
    expect(error).toBeInstanceOf(WebAuthRequestError);
    expect(error).toMatchObject({
      code: "auth.local_bootstrap_invalid",
      status: 401,
    });
    expect(browser.readPaths()).toEqual([
      localhostBootstrapIssuePath,
      localhostBootstrapRedeemPath,
      localhostBootstrapRedeemPath,
    ]);
  });

  it("denies localhost instant onboarding before any worker call when the browser origin is not local", async () => {
    const { env } = createEndToEndWorkerEnv();
    const handler = createWorkerFetchHandler();
    const browser = createBrowserWorkerSession({
      handler,
      env,
      origin: "https://web.local",
    });

    let error: unknown;
    try {
      await completeLocalhostOnboarding({
        fetcher: browser.fetcher,
        origin: "https://web.local",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Localhost instant onboarding is only available on localhost origins.",
    );
    expect(browser.readPaths()).toEqual([]);
  });

  it("fails clearly when localhost onboarding reaches an ambiguous local admission state", async () => {
    const localAuthEnv = createBetterAuthEnv({
      BETTER_AUTH_URL: "http://io.localhost:8787",
    });
    applyBetterAuthSchema(localAuthEnv);

    const { durableObject, env } = createEndToEndWorkerEnv({
      betterAuthEnv: localAuthEnv,
    });
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

    const handler = createWorkerFetchHandler();
    const browser = createBrowserWorkerSession({
      handler,
      env,
      origin: "http://io.localhost:8787",
      async onResponse({ path, response }) {
        if (path !== localhostBootstrapRedeemPath || !response.ok) {
          return;
        }

        const localUser = readStoredAuthUser(localAuthEnv.AUTH_DB);
        await createProjectedPrincipalWithoutBindings(authority, {
          email: localUser.email,
          userId: localUser.id,
        });
      },
    });

    let error: unknown;
    try {
      await completeLocalhostOnboarding({
        fetcher: browser.fetcher,
        origin: "http://io.localhost:8787",
      });
    } catch (caught) {
      error = caught;
    }

    expect(browser.readCookieHeader()).toBeTruthy();
    expect(error).toBeInstanceOf(WebAuthRequestError);
    expect((error as WebAuthRequestError).status).toBe(403);
    expect((error as Error).message).toContain("Initial role binding denied");
    expect(browser.readPaths()).toEqual([
      localhostBootstrapIssuePath,
      localhostBootstrapRedeemPath,
      webPrincipalBootstrapPath,
      webGraphAccessActivationPath,
    ]);
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

  it("accepts graph-member updates after session access activation", async () => {
    const { durableObject, env } = createEndToEndWorkerEnv();
    const authority = await getDurableAuthority(durableObject);
    const workerGraph = { ...core, ...workflow } as const;

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

    const seedStore = createGraphStore(
      authority.readSnapshot({ authorization: authorityAuthorization }),
    );
    const seedGraph = createGraphClient(seedStore, workerGraph);
    const beforeCreate = seedStore.snapshot();
    const envVarId = seedGraph.envVar.create({
      description: "Original description",
      name: "OPENAI_API_KEY",
    });
    await authority.applyTransaction(
      buildGraphWriteTransaction(beforeCreate, seedStore.snapshot(), "tx:create-env-var"),
      {
        authorization: authorityAuthorization,
        writeScope: "authority-only",
      },
    );

    const handler = createWorkerFetchHandler({
      async getBetterAuthSession() {
        return {
          session: { id: "session-activated-member" },
          user: { id: "user-activated-member", email: "approved@example.com" },
        };
      },
    });

    const activation = await handler.fetch(
      new Request("https://web.local/api/access/activate", {
        method: "POST",
      }),
      env,
    );
    expect(activation.status).toBe(200);
    expect(await activation.json()).toMatchObject({
      roleKeys: ["graph:member"],
      capabilityVersion: 1,
    });

    const mutationStore = createGraphStore(
      authority.readSnapshot({ authorization: authorityAuthorization }),
    );
    const mutationGraph = createGraphClient(mutationStore, workerGraph);
    const beforeUpdate = mutationStore.snapshot();
    mutationGraph.envVar.update(envVarId, {
      description: "Updated by activated graph member",
    });
    const transaction = buildGraphWriteTransaction(
      beforeUpdate,
      mutationStore.snapshot(),
      "tx:update-env-var",
    );

    const response = await handler.fetch(
      new Request("https://web.local/api/tx", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(transaction),
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      txId: "tx:update-env-var",
      writeScope: "client-tx",
    });
    expect(
      createGraphClient(
        createGraphStore(authority.readSnapshot({ authorization: authorityAuthorization })),
        workerGraph,
      ).envVar.get(envVarId)?.description,
    ).toBe("Updated by activated graph member");
  });
});
