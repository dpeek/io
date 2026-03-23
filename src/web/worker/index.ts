import { projectSessionToPrincipal } from "../lib/auth-bridge.js";
import { WebGraphAuthorityDurableObject } from "../lib/graph-authority-do.js";
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

interface Env {
  ASSETS: Fetcher;
  GRAPH_AUTHORITY: DurableObjectNamespaceLike;
}

export { WebGraphAuthorityDurableObject };

const webAppGraphId = "graph:global";
const webAppPolicyVersion = 0;

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

async function createRequestAuthorizationContext(request: Request) {
  void request;

  // The worker already owns the request-to-session boundary. Until Better Auth
  // session parsing lands here, route all requests through the shared
  // projection seam as anonymous.
  return projectSessionToPrincipal({
    graphId: webAppGraphId,
    policyVersion: webAppPolicyVersion,
    session: null,
    lookupPrincipal() {
      throw new Error("lookupPrincipal should not run without an authenticated session.");
    },
  });
}

async function createAuthorizedGraphAuthorityRequest(request: Request): Promise<Request> {
  const authorization = await createRequestAuthorizationContext(request);
  const headers = new Headers(request.headers);

  headers.set(webAppAuthorizationContextHeader, encodeRequestAuthorizationContext(authorization));
  return new Request(request, { headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/sync") {
      return getGraphAuthorityFetcher(env).fetch(
        await createAuthorizedGraphAuthorityRequest(request),
      );
    }

    if (url.pathname === "/api/tx") {
      return getGraphAuthorityFetcher(env).fetch(
        await createAuthorizedGraphAuthorityRequest(request),
      );
    }

    if (url.pathname === "/api/commands") {
      return getGraphAuthorityFetcher(env).fetch(
        await createAuthorizedGraphAuthorityRequest(request),
      );
    }

    return serveSpaAsset(request, env);
  },
};
