import {
  BetterAuthSessionReductionError,
  createWorkerAuthorizationContext,
  type BetterAuthSessionResult,
  type SessionPrincipalLookupInput,
  type SessionPrincipalProjection,
  SessionPrincipalProjectionError,
} from "../lib/auth-bridge.js";
import { betterAuthBasePath, getBetterAuth, type BetterAuthWorkerEnv } from "../lib/better-auth.js";
import {
  WebGraphAuthorityDurableObject,
  webGraphAuthoritySessionPrincipalLookupPath,
} from "../lib/graph-authority-do.js";
import {
  encodeRequestAuthorizationContext,
  webAppAuthorizationContextHeader,
} from "../lib/server-routes.js";

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
const webAppPolicyVersion = 0;
const betterAuthCookieMarker = "better-auth";

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

export type WorkerFetchDependencies = {
  readonly getBetterAuthSession?: WorkerBetterAuthSessionLookup;
  readonly lookupPrincipal?: WorkerPrincipalLookup;
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

function isBetterAuthRequest(url: URL): boolean {
  return url.pathname === betterAuthBasePath || url.pathname.startsWith(`${betterAuthBasePath}/`);
}

function isGraphApiRequest(url: URL): boolean {
  return (
    url.pathname === "/api/sync" || url.pathname === "/api/tx" || url.pathname === "/api/commands"
  );
}

function isHtmlNavigationRequest(request: Request): boolean {
  return request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
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

export async function createRequestAuthorizationContext(
  request: Request,
  env: Env,
  dependencies: WorkerFetchDependencies = {},
) {
  return createWorkerAuthorizationContext({
    graphId: webAppGraphId,
    policyVersion: webAppPolicyVersion,
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

function createGraphAuthorizationErrorResponse(error: unknown): Response | null {
  if (
    !(error instanceof BetterAuthSessionVerificationError) &&
    !(error instanceof BetterAuthSessionReductionError) &&
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
      status: errorStatus(error) ?? (error instanceof SessionPrincipalProjectionError ? 403 : 503),
      headers: {
        "cache-control": "no-store",
      },
    },
  );
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

      return serveSpaAsset(request, env);
    },
  };
}

const worker = createWorkerFetchHandler();

export default worker;
