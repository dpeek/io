import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import type { AuthorizationContext } from "@io/core/graph";

import type { BetterAuthWorkerEnv } from "../lib/better-auth.js";
import { webGraphAuthoritySessionPrincipalLookupPath } from "../lib/graph-authority-do.js";
import { readRequestAuthorizationContext } from "../lib/server-routes.js";
import worker, { BetterAuthSessionVerificationError, createWorkerFetchHandler } from "./index.js";

function createBetterAuthEnv(): BetterAuthWorkerEnv {
  return {
    AUTH_DB: new Database(":memory:"),
    BETTER_AUTH_SECRET: "L5tH1pQ8xJ2mR9vN4sC7kW3yF6uB0dE!ZaG1oP5qT8xV2",
    BETTER_AUTH_URL: "https://web.local",
  };
}

function createWorkerEnv(
  input: {
    readonly assetResponse?: Response;
    readonly authorityResponse?: Response;
    readonly principalLookupResponse?: Response;
    readonly onAuthorityFetch?: (request: Request) => Promise<void> | void;
    readonly onPrincipalLookup?: (request: Request) => Promise<void> | void;
  } = {},
) {
  const assetPaths: string[] = [];
  const authorityPaths: string[] = [];
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
