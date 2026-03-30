import { defineWebPrincipalBootstrapPayload } from "@io/graph-authority";

import {
  BearerShareTokenProjectionError,
  type BearerShareLookupInput,
  type BearerShareProjection,
  BetterAuthSessionReductionError,
  createWorkerAuthorizationContext,
  isBearerShareToken,
  projectBearerShareToken,
  reduceBetterAuthSession,
  type BetterAuthSessionResult,
  type SessionPrincipalLookupInput,
  type SessionPrincipalProjection,
  SessionPrincipalProjectionError,
} from "../lib/auth-bridge.js";
import { betterAuthBasePath, getBetterAuth, type BetterAuthWorkerEnv } from "../lib/better-auth.js";
import {
  WebGraphAuthorityDurableObject,
  webGraphAuthorityBearerShareLookupPath,
  webGraphAuthorityPolicyVersionPath,
  webGraphAuthoritySessionPrincipalActivatePath,
  webGraphAuthoritySessionPrincipalLookupPath,
} from "../lib/graph-authority-do.js";
import { webSerializedQueryPath } from "../lib/query-transport.js";
import {
  encodeRequestAuthorizationContext,
  webAppAuthorizationContextHeader,
} from "../lib/server-routes.js";
import {
  createDefaultLocalhostSyntheticIdentity,
  createLocalhostBootstrapToken,
  defineLocalhostBootstrapCredential,
  isLocalhostBootstrapToken,
  isLocalhostOrigin,
  localhostBootstrapCredentialMaxTtlMs,
  localhostBootstrapIssuePath,
  localhostBootstrapRedeemPath,
  type LocalhostBootstrapCredential,
} from "../lib/local-bootstrap.js";
import { webWorkflowLivePath } from "../lib/workflow-live-transport.js";
import { webWorkflowReadPath } from "../lib/workflow-transport.js";

type Fetcher = {
  fetch(request: Request): Promise<Response>;
};

type DurableObjectNamespaceLike = {
  idFromName(name: string): unknown;
  get(id: unknown): Fetcher;
};

interface Env extends BetterAuthWorkerEnv {
  ASSETS: Fetcher;
  GRAPH_AUTHORITY: DurableObjectNamespaceLike;
}

export { WebGraphAuthorityDurableObject };

const webAppGraphId = "graph:global";
const betterAuthCookieMarker = "better-auth";
const webAppActivateAccessPath = "/api/access/activate";
export const webAppBootstrapPath = "/api/bootstrap";
const localhostBootstrapVerificationNamespace = "localhost-bootstrap";
const localhostBootstrapPasswordNamespace = "localhost-bootstrap-password";
const textEncoder = new TextEncoder();

export type WorkerBetterAuthSessionLookup = (
  request: Request,
  env: Env,
) => Promise<BetterAuthSessionResult | null>;

export type WorkerPrincipalLookup = (
  input: SessionPrincipalLookupInput,
  context: {
    readonly env: Env;
    readonly request: Request;
  },
) => Promise<SessionPrincipalProjection | null>;

export type WorkerBearerShareLookup = (
  input: BearerShareLookupInput,
  context: {
    readonly env: Env;
    readonly request: Request;
  },
) => Promise<BearerShareProjection | null>;

export type WorkerPolicyVersionLookup = (context: {
  readonly env: Env;
  readonly request: Request;
}) => Promise<number>;

export type WorkerFetchDependencies = {
  readonly getBetterAuthSession?: WorkerBetterAuthSessionLookup;
  readonly lookupPrincipal?: WorkerPrincipalLookup;
  readonly lookupBearerShare?: WorkerBearerShareLookup;
  readonly lookupPolicyVersion?: WorkerPolicyVersionLookup;
};

export class BetterAuthSessionVerificationError extends Error {
  readonly code = "auth.session_unavailable" as const;
  readonly status = 503;

  constructor(cause: unknown) {
    super("Unable to verify the Better Auth session for this graph API request.");
    this.name = "BetterAuthSessionVerificationError";
    this.cause = cause;
  }
}

export class GraphPrincipalLookupError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "GraphPrincipalLookupError";
    this.status = status;
    this.code = code;
  }
}

export class GraphBearerShareLookupError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "GraphBearerShareLookupError";
    this.status = status;
    this.code = code;
  }
}

export class GraphPolicyVersionLookupError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "GraphPolicyVersionLookupError";
    this.status = status;
    this.code = code;
  }
}

export class BearerShareTokenRequestError extends Error {
  readonly code = "grant.invalid" as const;
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "BearerShareTokenRequestError";
    this.status = status;
  }
}

export class SessionActivationRequestError extends Error {
  readonly code = "auth.unauthenticated" as const;
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SessionActivationRequestError";
    this.status = status;
  }
}

export class LocalhostBootstrapRequestError extends Error {
  readonly code:
    | "auth.local_bootstrap_expired"
    | "auth.local_bootstrap_invalid"
    | "auth.local_bootstrap_unavailable";
  readonly status: number;

  constructor(
    message: string,
    input: {
      readonly code:
        | "auth.local_bootstrap_expired"
        | "auth.local_bootstrap_invalid"
        | "auth.local_bootstrap_unavailable";
      readonly status: number;
    },
  ) {
    super(message);
    this.name = "LocalhostBootstrapRequestError";
    this.code = input.code;
    this.status = input.status;
  }
}

type SqliteStatementLike = {
  get(...bindings: unknown[]): Record<string, unknown> | null | undefined;
  run(...bindings: unknown[]): unknown;
};

type SqliteDatabaseLike = {
  query(sql: string): SqliteStatementLike;
};

type D1PreparedStatementLike = {
  bind(...bindings: unknown[]): {
    first<T extends Record<string, unknown>>(): Promise<T | null>;
    run(): Promise<unknown>;
  };
};

type D1DatabaseLike = {
  prepare(sql: string): D1PreparedStatementLike;
};

function isBetterAuthRequest(url: URL): boolean {
  return url.pathname === betterAuthBasePath || url.pathname.startsWith(`${betterAuthBasePath}/`);
}

function isGraphApiRequest(url: URL): boolean {
  return (
    url.pathname === "/api/sync" ||
    url.pathname === "/api/tx" ||
    url.pathname === "/api/commands" ||
    url.pathname === webSerializedQueryPath ||
    url.pathname === webWorkflowLivePath ||
    url.pathname === webWorkflowReadPath
  );
}

function isSessionActivationRequest(url: URL): boolean {
  return url.pathname === webAppActivateAccessPath;
}

function isBootstrapRequest(url: URL): boolean {
  return url.pathname === webAppBootstrapPath;
}

function isLocalhostBootstrapIssueRequest(url: URL): boolean {
  return url.pathname === localhostBootstrapIssuePath;
}

function isLocalhostBootstrapRedeemRequest(url: URL): boolean {
  return url.pathname === localhostBootstrapRedeemPath;
}

function isHtmlNavigationRequest(request: Request): boolean {
  return request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
}

function isSqliteDatabaseLike(database: unknown): database is SqliteDatabaseLike {
  return typeof (database as SqliteDatabaseLike | null)?.query === "function";
}

function isD1DatabaseLike(database: unknown): database is D1DatabaseLike {
  return typeof (database as D1DatabaseLike | null)?.prepare === "function";
}

function encodeHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(input));
  return encodeHex(new Uint8Array(digest));
}

async function buildLocalhostBootstrapVerificationIdentifier(
  token: string,
  redeemOrigin: string,
): Promise<string> {
  return `${localhostBootstrapVerificationNamespace}:${redeemOrigin}:${await sha256Hex(token)}`;
}

function resolveConfiguredRequestOrigin(request: Request, env: Env): string | null {
  const requestOrigin = new URL(request.url).origin;

  let configuredOrigin: string;
  try {
    configuredOrigin = new URL(env.BETTER_AUTH_URL).origin;
  } catch {
    return null;
  }

  if (
    !isLocalhostOrigin(requestOrigin) ||
    !isLocalhostOrigin(configuredOrigin) ||
    requestOrigin !== configuredOrigin
  ) {
    return null;
  }

  return requestOrigin;
}

function requireLocalhostBootstrapOrigin(request: Request, env: Env): string {
  const origin = resolveConfiguredRequestOrigin(request, env);
  if (!origin) {
    throw new LocalhostBootstrapRequestError(
      "Localhost bootstrap routes are unavailable for this origin.",
      {
        code: "auth.local_bootstrap_unavailable",
        status: 404,
      },
    );
  }

  return origin;
}

function requireSameOriginLocalhostBootstrapRequest(request: Request, redeemOrigin: string): void {
  if (request.headers.get("origin") !== redeemOrigin) {
    throw new LocalhostBootstrapRequestError(
      "Localhost bootstrap redemption requires a same-origin browser request.",
      {
        code: "auth.local_bootstrap_unavailable",
        status: 403,
      },
    );
  }
}

async function readLocalhostBootstrapRedeemToken(request: Request): Promise<string> {
  let decoded: unknown;
  try {
    decoded = await request.json();
  } catch {
    throw new LocalhostBootstrapRequestError(
      "Localhost bootstrap redemption requests must be valid JSON.",
      {
        code: "auth.local_bootstrap_invalid",
        status: 400,
      },
    );
  }

  if (typeof decoded !== "object" || decoded === null) {
    throw new LocalhostBootstrapRequestError(
      "Localhost bootstrap redemption requests must be JSON objects.",
      {
        code: "auth.local_bootstrap_invalid",
        status: 400,
      },
    );
  }

  const token = (decoded as { readonly token?: unknown }).token;
  if (typeof token !== "string" || !isLocalhostBootstrapToken(token)) {
    throw new LocalhostBootstrapRequestError(
      "Localhost bootstrap redemption requires an issued bootstrap token.",
      {
        code: "auth.local_bootstrap_invalid",
        status: 400,
      },
    );
  }

  return token;
}

async function runAuthDbStatement(
  database: Env["AUTH_DB"],
  sql: string,
  bindings: readonly unknown[],
): Promise<void> {
  if (isSqliteDatabaseLike(database)) {
    database.query(sql).run(...bindings);
    return;
  }

  if (isD1DatabaseLike(database)) {
    await database
      .prepare(sql)
      .bind(...bindings)
      .run();
    return;
  }

  throw new Error("Localhost bootstrap requires a sqlite or D1 auth database binding.");
}

async function readAuthDbRow<T extends Record<string, unknown>>(
  database: Env["AUTH_DB"],
  sql: string,
  bindings: readonly unknown[],
): Promise<T | null> {
  if (isSqliteDatabaseLike(database)) {
    return ((database.query(sql).get(...bindings) as T | null | undefined) ?? null) as T | null;
  }

  if (isD1DatabaseLike(database)) {
    return database
      .prepare(sql)
      .bind(...bindings)
      .first<T>();
  }

  throw new Error("Localhost bootstrap requires a sqlite or D1 auth database binding.");
}

async function persistLocalhostBootstrapCredential(
  database: Env["AUTH_DB"],
  credential: LocalhostBootstrapCredential,
): Promise<void> {
  const identifier = await buildLocalhostBootstrapVerificationIdentifier(
    credential.token,
    credential.redeemOrigin,
  );
  await runAuthDbStatement(
    database,
    [
      'insert into "verification"',
      '("id", "identifier", "value", "expiresAt", "createdAt", "updatedAt")',
      "values (?, ?, ?, ?, ?, ?)",
    ].join(" "),
    [
      crypto.randomUUID(),
      identifier,
      JSON.stringify(credential),
      credential.expiresAt,
      credential.issuedAt,
      credential.issuedAt,
    ],
  );
}

async function consumeLocalhostBootstrapCredential(
  database: Env["AUTH_DB"],
  input: {
    readonly redeemOrigin: string;
    readonly token: string;
  },
): Promise<LocalhostBootstrapCredential | null> {
  const identifier = await buildLocalhostBootstrapVerificationIdentifier(
    input.token,
    input.redeemOrigin,
  );
  const row = await readAuthDbRow<{ value?: unknown }>(
    database,
    'delete from "verification" where "identifier" = ? returning "value"',
    [identifier],
  );
  if (typeof row?.value !== "string") {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    throw new LocalhostBootstrapRequestError(
      "Stored localhost bootstrap credential data is invalid.",
      {
        code: "auth.local_bootstrap_invalid",
        status: 503,
      },
    );
  }

  return defineLocalhostBootstrapCredential(parsed as LocalhostBootstrapCredential);
}

async function createLocalhostBootstrapPassword(
  env: Env,
  credential: LocalhostBootstrapCredential,
): Promise<string> {
  return `${localhostBootstrapPasswordNamespace}:${await sha256Hex(
    `${env.BETTER_AUTH_SECRET}:${credential.syntheticIdentity.localIdentityId}`,
  )}`;
}

async function serveSpaAsset(request: Request, env: Env): Promise<Response> {
  const assetResponse = await env.ASSETS.fetch(request);
  if (assetResponse.status !== 404 || !isHtmlNavigationRequest(request)) {
    return assetResponse;
  }

  const indexRequest = new Request(new URL("/", request.url), request);
  return env.ASSETS.fetch(indexRequest);
}

function getGraphAuthorityFetcher(env: Env): Fetcher {
  const durableObjectId = env.GRAPH_AUTHORITY.idFromName("global");
  return env.GRAPH_AUTHORITY.get(durableObjectId);
}

function requestCarriesBetterAuthSession(request: Request): boolean {
  return (request.headers.get("cookie") ?? "").toLowerCase().includes(betterAuthCookieMarker);
}

async function getRequestBetterAuthSession(
  request: Request,
  env: Env,
): Promise<BetterAuthSessionResult | null> {
  try {
    return await getBetterAuth(env).api.getSession({
      headers: request.headers,
      query: {
        disableCookieCache: true,
      },
    });
  } catch (error) {
    if (!requestCarriesBetterAuthSession(request)) {
      return null;
    }

    throw new BetterAuthSessionVerificationError(error);
  }
}

async function readLookupPrincipalResponse(response: Response): Promise<{
  readonly code?: string;
  readonly error?: string;
}> {
  try {
    const decoded = (await response.json()) as {
      readonly code?: unknown;
      readonly error?: unknown;
    };

    return {
      code: typeof decoded.code === "string" ? decoded.code : undefined,
      error: typeof decoded.error === "string" ? decoded.error : undefined,
    };
  } catch {
    return {};
  }
}

async function readWorkerErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const decoded = (await response.json()) as {
      readonly error?: unknown;
      readonly message?: unknown;
    };
    if (typeof decoded.error === "string" && decoded.error.trim().length > 0) {
      return decoded.error;
    }
    if (typeof decoded.message === "string" && decoded.message.trim().length > 0) {
      return decoded.message;
    }
  } catch {
    // Fall through to the generic fallback.
  }

  return fallback;
}

async function establishLocalhostBetterAuthSession(
  request: Request,
  env: Env,
  credential: LocalhostBootstrapCredential,
): Promise<Response> {
  const auth = getBetterAuth(env);
  const headers = new Headers(request.headers);
  headers.set("origin", credential.redeemOrigin);

  const password = await createLocalhostBootstrapPassword(env, credential);
  const signInBody = {
    email: credential.syntheticIdentity.email,
    password,
    rememberMe: true,
  } as const;

  const signInResponse = await auth.api.signInEmail({
    body: signInBody,
    headers,
    asResponse: true,
  });
  if (signInResponse.ok) {
    return signInResponse;
  }

  if (signInResponse.status !== 401) {
    return signInResponse;
  }

  const signUpResponse = await auth.api.signUpEmail({
    body: {
      ...signInBody,
      name: credential.syntheticIdentity.displayName,
    },
    headers,
    asResponse: true,
  });
  if (signUpResponse.ok) {
    return signUpResponse;
  }

  if (signUpResponse.status === 409 || signUpResponse.status === 422) {
    const retrySignInResponse = await auth.api.signInEmail({
      body: signInBody,
      headers,
      asResponse: true,
    });
    if (retrySignInResponse.ok) {
      return retrySignInResponse;
    }
  }

  return signUpResponse;
}

async function lookupGraphPrincipal(
  input: SessionPrincipalLookupInput,
  context: {
    readonly env: Env;
    readonly request: Request;
  },
): Promise<SessionPrincipalProjection | null> {
  const response = await getGraphAuthorityFetcher(context.env).fetch(
    new Request(new URL(webGraphAuthoritySessionPrincipalLookupPath, context.request.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    }),
  );
  if (response.ok) {
    return (await response.json()) as SessionPrincipalProjection;
  }

  const payload = await readLookupPrincipalResponse(response);
  if (response.status === 404) {
    return null;
  }

  throw new GraphPrincipalLookupError(
    payload.error ?? "Unable to resolve the graph principal for this authenticated request.",
    response.status,
    payload.code,
  );
}

async function activateGraphPrincipalRoleBindings(
  input: SessionPrincipalLookupInput,
  context: {
    readonly env: Env;
    readonly request: Request;
  },
): Promise<SessionPrincipalProjection> {
  const response = await getGraphAuthorityFetcher(context.env).fetch(
    new Request(new URL(webGraphAuthoritySessionPrincipalActivatePath, context.request.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    }),
  );
  if (response.ok) {
    return (await response.json()) as SessionPrincipalProjection;
  }

  const payload = await readLookupPrincipalResponse(response);
  throw new GraphPrincipalLookupError(
    payload.error ?? "Unable to activate initial graph access for this authenticated request.",
    response.status,
    payload.code,
  );
}

async function lookupGraphBearerShare(
  input: BearerShareLookupInput,
  context: {
    readonly env: Env;
    readonly request: Request;
  },
): Promise<BearerShareProjection | null> {
  const response = await getGraphAuthorityFetcher(context.env).fetch(
    new Request(new URL(webGraphAuthorityBearerShareLookupPath, context.request.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    }),
  );
  if (response.ok) {
    return (await response.json()) as BearerShareProjection;
  }

  const payload = await readLookupPrincipalResponse(response);
  if (response.status === 404) {
    return null;
  }

  throw new GraphBearerShareLookupError(
    payload.error ?? "Unable to resolve the bearer share grant for this graph API request.",
    response.status,
    payload.code,
  );
}

async function lookupGraphPolicyVersion(context: {
  readonly env: Env;
  readonly request: Request;
}): Promise<number> {
  const response = await getGraphAuthorityFetcher(context.env).fetch(
    new Request(new URL(webGraphAuthorityPolicyVersionPath, context.request.url)),
  );
  if (response.ok) {
    const payload = (await response.json()) as {
      readonly policyVersion?: unknown;
    };
    if (typeof payload.policyVersion === "number" && Number.isInteger(payload.policyVersion)) {
      return payload.policyVersion;
    }

    throw new GraphPolicyVersionLookupError(
      "Graph authority returned an invalid policy-version payload.",
      503,
      "policy.invalid",
    );
  }

  const payload = await readLookupPrincipalResponse(response);
  throw new GraphPolicyVersionLookupError(
    payload.error ?? "Unable to resolve the current graph policy version for this request.",
    response.status,
    payload.code,
  );
}

function readRequestBearerShareToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) {
    return undefined;
  }

  const token = match[1]?.trim() ?? "";
  if (!isBearerShareToken(token)) {
    throw new BearerShareTokenRequestError(
      "Bearer share tokens must use the issued io_share_<64 lowercase hex chars> format.",
    );
  }

  return token;
}

export async function createRequestAuthorizationContext(
  request: Request,
  env: Env,
  dependencies: WorkerFetchDependencies = {},
) {
  const policyVersion = await (dependencies.lookupPolicyVersion ?? lookupGraphPolicyVersion)({
    env,
    request,
  });
  const bearerShareToken = readRequestBearerShareToken(request);
  if (bearerShareToken) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/sync" || request.method !== "GET") {
      throw new BearerShareTokenRequestError(
        'Bearer share tokens only support "GET /api/sync" requests in the current proof.',
        405,
      );
    }

    return projectBearerShareToken({
      graphId: webAppGraphId,
      policyVersion,
      token: bearerShareToken,
      lookupBearerShare(input) {
        return (dependencies.lookupBearerShare ?? lookupGraphBearerShare)(input, {
          env,
          request,
        });
      },
    });
  }

  return createWorkerAuthorizationContext({
    graphId: webAppGraphId,
    policyVersion,
    betterAuthSession: await (dependencies.getBetterAuthSession ?? getRequestBetterAuthSession)(
      request,
      env,
    ),
    lookupPrincipal(input) {
      return (dependencies.lookupPrincipal ?? lookupGraphPrincipal)(input, { env, request });
    },
  });
}

async function createAuthorizedGraphAuthorityRequest(
  request: Request,
  env: Env,
  dependencies: WorkerFetchDependencies = {},
): Promise<Request> {
  const authorization = await createRequestAuthorizationContext(request, env, dependencies);
  const headers = new Headers(request.headers);

  headers.delete("authorization");
  headers.delete("cookie");
  headers.set(webAppAuthorizationContextHeader, encodeRequestAuthorizationContext(authorization));
  return new Request(request, { headers });
}

function errorStatus(error: unknown): number | null {
  return typeof (error as { status?: unknown })?.status === "number"
    ? (error as { status: number }).status
    : null;
}

function errorCode(error: unknown): string | undefined {
  return typeof (error as { code?: unknown })?.code === "string"
    ? (error as { code: string }).code
    : undefined;
}

function createNoStoreErrorResponse(
  error: string,
  input: {
    readonly code?: string;
    readonly status: number;
  },
): Response {
  return Response.json(
    {
      error,
      ...(input.code ? { code: input.code } : {}),
    },
    {
      status: input.status,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}

function createGraphAuthorizationErrorResponse(error: unknown): Response | null {
  if (
    !(error instanceof SessionActivationRequestError) &&
    !(error instanceof BearerShareTokenRequestError) &&
    !(error instanceof BearerShareTokenProjectionError) &&
    !(error instanceof BetterAuthSessionVerificationError) &&
    !(error instanceof BetterAuthSessionReductionError) &&
    !(error instanceof GraphBearerShareLookupError) &&
    !(error instanceof GraphPolicyVersionLookupError) &&
    !(error instanceof GraphPrincipalLookupError) &&
    !(error instanceof SessionPrincipalProjectionError)
  ) {
    return null;
  }

  return Response.json(
    {
      error: error.message,
      code: errorCode(error),
    },
    {
      status:
        errorStatus(error) ??
        (error instanceof SessionPrincipalProjectionError ||
        error instanceof BearerShareTokenProjectionError
          ? 403
          : 503),
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}

function createLocalhostBootstrapErrorResponse(error: unknown): Response | null {
  if (!(error instanceof LocalhostBootstrapRequestError)) {
    return null;
  }

  return createNoStoreErrorResponse(error.message, {
    code: error.code,
    status: error.status,
  });
}

async function handleGraphApiRequest(
  request: Request,
  env: Env,
  dependencies: WorkerFetchDependencies,
): Promise<Response> {
  try {
    return getGraphAuthorityFetcher(env).fetch(
      await createAuthorizedGraphAuthorityRequest(request, env, dependencies),
    );
  } catch (error) {
    const authErrorResponse = createGraphAuthorizationErrorResponse(error);
    if (authErrorResponse) {
      return authErrorResponse;
    }

    throw error;
  }
}

async function handleSessionActivationRequest(
  request: Request,
  env: Env,
  dependencies: WorkerFetchDependencies,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "POST" },
    });
  }

  try {
    const betterAuthSession = await (
      dependencies.getBetterAuthSession ?? getRequestBetterAuthSession
    )(request, env);
    if (!betterAuthSession) {
      throw new SessionActivationRequestError(
        "An authenticated Better Auth session is required to activate graph access.",
        401,
      );
    }

    const reducedSession = reduceBetterAuthSession(betterAuthSession);
    if (!reducedSession) {
      throw new BetterAuthSessionReductionError(
        "Unable to reduce the Better Auth session into the shared authenticated-session shape.",
      );
    }

    const projection = await activateGraphPrincipalRoleBindings(
      {
        graphId: webAppGraphId,
        subject: reducedSession.subject,
        email: reducedSession.email,
      },
      { env, request },
    );

    return Response.json(projection, {
      headers: {
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const authErrorResponse = createGraphAuthorizationErrorResponse(error);
    if (authErrorResponse) {
      return authErrorResponse;
    }

    throw error;
  }
}

async function handleBootstrapRequest(
  request: Request,
  env: Env,
  dependencies: WorkerFetchDependencies,
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET" },
    });
  }

  try {
    const betterAuthSession = await (
      dependencies.getBetterAuthSession ?? getRequestBetterAuthSession
    )(request, env);

    if (!betterAuthSession) {
      const authState = requestCarriesBetterAuthSession(request) ? "expired" : "signed-out";
      return Response.json(
        defineWebPrincipalBootstrapPayload({
          session: {
            authState,
            sessionId: null,
            principalId: null,
            capabilityVersion: null,
          },
          principal: null,
        }),
        {
          headers: {
            "cache-control": "no-store",
          },
        },
      );
    }

    const reducedSession = reduceBetterAuthSession(betterAuthSession);
    if (!reducedSession) {
      throw new BetterAuthSessionReductionError(
        "Unable to reduce the Better Auth session into the shared authenticated-session shape.",
      );
    }

    const projection = await (dependencies.lookupPrincipal ?? lookupGraphPrincipal)(
      {
        graphId: webAppGraphId,
        subject: reducedSession.subject,
        email: reducedSession.email,
      },
      { env, request },
    );
    if (!projection) {
      throw new SessionPrincipalProjectionError({
        graphId: webAppGraphId,
        subject: reducedSession.subject,
        email: reducedSession.email,
      });
    }

    return Response.json(
      defineWebPrincipalBootstrapPayload({
        session: {
          authState: "ready",
          sessionId: reducedSession.sessionId,
          principalId: projection.summary.principalId,
          capabilityVersion: projection.summary.capabilityVersion,
          ...(reducedSession.email ? { displayName: reducedSession.email } : {}),
        },
        principal: projection.summary,
      }),
      {
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    const authErrorResponse = createGraphAuthorizationErrorResponse(error);
    if (authErrorResponse) {
      return authErrorResponse;
    }

    throw error;
  }
}

async function handleLocalhostBootstrapIssueRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "POST" },
    });
  }

  try {
    const redeemOrigin = requireLocalhostBootstrapOrigin(request, env);
    const issuedAt = new Date();
    const credential = defineLocalhostBootstrapCredential({
      kind: "localhost-bootstrap",
      availability: "localhost-only",
      token: createLocalhostBootstrapToken(),
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + localhostBootstrapCredentialMaxTtlMs).toISOString(),
      redeemOrigin,
      oneTimeUse: true,
      syntheticIdentity: createDefaultLocalhostSyntheticIdentity(),
    });

    await persistLocalhostBootstrapCredential(env.AUTH_DB, credential);

    return Response.json(credential, {
      status: 201,
      headers: {
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const errorResponse = createLocalhostBootstrapErrorResponse(error);
    if (errorResponse) {
      return errorResponse;
    }

    throw error;
  }
}

async function handleLocalhostBootstrapRedeemRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "POST" },
    });
  }

  try {
    const redeemOrigin = requireLocalhostBootstrapOrigin(request, env);
    requireSameOriginLocalhostBootstrapRequest(request, redeemOrigin);

    const token = await readLocalhostBootstrapRedeemToken(request);
    const credential = await consumeLocalhostBootstrapCredential(env.AUTH_DB, {
      redeemOrigin,
      token,
    });
    if (!credential) {
      throw new LocalhostBootstrapRequestError(
        "Localhost bootstrap credential is invalid or has already been redeemed.",
        {
          code: "auth.local_bootstrap_invalid",
          status: 401,
        },
      );
    }

    if (credential.token !== token || credential.redeemOrigin !== redeemOrigin) {
      throw new LocalhostBootstrapRequestError(
        "Localhost bootstrap credential is invalid for this origin.",
        {
          code: "auth.local_bootstrap_invalid",
          status: 401,
        },
      );
    }

    if (Date.parse(credential.expiresAt) <= Date.now()) {
      throw new LocalhostBootstrapRequestError("Localhost bootstrap credential has expired.", {
        code: "auth.local_bootstrap_expired",
        status: 410,
      });
    }

    const authResponse = await establishLocalhostBetterAuthSession(request, env, credential);
    if (!authResponse.ok) {
      return createNoStoreErrorResponse(
        await readWorkerErrorMessage(
          authResponse,
          "Unable to establish the local browser session.",
        ),
        {
          code:
            authResponse.status >= 500
              ? "auth.local_bootstrap_unavailable"
              : "auth.local_bootstrap_invalid",
          status: authResponse.status,
        },
      );
    }

    const setCookie = authResponse.headers.get("set-cookie");
    if (!setCookie) {
      return createNoStoreErrorResponse(
        "Localhost bootstrap did not produce a browser session cookie.",
        {
          code: "auth.local_bootstrap_unavailable",
          status: 503,
        },
      );
    }

    const headers = new Headers({
      "cache-control": "no-store",
    });
    headers.set("set-cookie", setCookie);
    return new Response(null, {
      status: 204,
      headers,
    });
  } catch (error) {
    const errorResponse = createLocalhostBootstrapErrorResponse(error);
    if (errorResponse) {
      return errorResponse;
    }

    throw error;
  }
}

export function createWorkerFetchHandler(dependencies: WorkerFetchDependencies = {}) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);

      if (isBetterAuthRequest(url)) {
        return getBetterAuth(env).handler(request);
      }

      if (isGraphApiRequest(url)) {
        return handleGraphApiRequest(request, env, dependencies);
      }

      if (isSessionActivationRequest(url)) {
        return handleSessionActivationRequest(request, env, dependencies);
      }

      if (isBootstrapRequest(url)) {
        return handleBootstrapRequest(request, env, dependencies);
      }

      if (isLocalhostBootstrapIssueRequest(url)) {
        return handleLocalhostBootstrapIssueRequest(request, env);
      }

      if (isLocalhostBootstrapRedeemRequest(url)) {
        return handleLocalhostBootstrapRedeemRequest(request, env);
      }

      return serveSpaAsset(request, env);
    },
  };
}

const worker = createWorkerFetchHandler();

export default worker;
