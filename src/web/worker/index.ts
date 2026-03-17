import { WebGraphAuthorityDurableObject } from "../lib/graph-authority-do.js";

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/sync") {
      return getGraphAuthorityFetcher(env).fetch(request);
    }

    if (url.pathname === "/api/tx") {
      return getGraphAuthorityFetcher(env).fetch(request);
    }

    if (url.pathname === "/api/secret-fields") {
      return getGraphAuthorityFetcher(env).fetch(request);
    }

    return serveSpaAsset(request, env);
  },
};
