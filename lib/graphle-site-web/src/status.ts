export interface GraphleSiteHealth {
  readonly ok?: boolean;
  readonly service?: {
    readonly name?: string;
    readonly status?: string;
    readonly startedAt?: string;
  };
  readonly project?: {
    readonly id?: string;
  };
  readonly database?: {
    readonly opened?: boolean;
    readonly metaTableReady?: boolean;
    readonly schemaVersion?: number;
  };
  readonly graph?: {
    readonly status?: string;
    readonly records?: {
      readonly pages?: number;
      readonly posts?: number;
    };
    readonly startupDiagnostics?: {
      readonly recovery?: string;
    };
  };
}

export interface GraphleSiteSession {
  readonly authenticated: boolean;
  readonly session: {
    readonly projectId?: string;
    readonly subject?: string;
  } | null;
}

export type GraphleSitePublicationStatus = "draft" | "published";

export interface GraphleSitePage {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly body: string;
  readonly status: GraphleSitePublicationStatus;
  readonly updatedAt: string;
}

export interface GraphleSitePost {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly body: string;
  readonly excerpt: string;
  readonly publishedAt?: string;
  readonly status: GraphleSitePublicationStatus;
  readonly updatedAt: string;
}

export type GraphleSiteRoute =
  | {
      readonly kind: "page";
      readonly path: string;
      readonly page: GraphleSitePage;
    }
  | {
      readonly kind: "post";
      readonly path: string;
      readonly post: GraphleSitePost;
    }
  | {
      readonly kind: "not-found";
      readonly path: string;
      readonly message: string;
    };

export interface GraphleSiteStatusSnapshot {
  readonly loadedAt: string;
  readonly health: GraphleSiteHealth;
  readonly session: GraphleSiteSession;
  readonly route: GraphleSiteRoute;
  readonly pages: readonly GraphleSitePage[];
  readonly posts: readonly GraphleSitePost[];
}

export type GraphleSiteStatusFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

async function readJson<T>(fetcher: GraphleSiteStatusFetcher, path: string): Promise<T> {
  const response = await fetcher(path, {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

async function writeJson<T>(
  fetcher: GraphleSiteStatusFetcher,
  path: string,
  method: "POST" | "PATCH",
  body: unknown,
): Promise<T> {
  const response = await fetcher(path, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => ({}))) as { readonly error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `${path} returned HTTP ${response.status}`);
  }

  return payload as T;
}

function routePath(path: string): string {
  const params = new URLSearchParams();
  params.set("path", path);
  return `/api/site/route?${params.toString()}`;
}

async function loadAuthoringLists(
  fetcher: GraphleSiteStatusFetcher,
  session: GraphleSiteSession,
): Promise<{
  readonly pages: readonly GraphleSitePage[];
  readonly posts: readonly GraphleSitePost[];
}> {
  if (!session.authenticated) {
    return {
      pages: [],
      posts: [],
    };
  }

  const [pagePayload, postPayload] = await Promise.all([
    readJson<{ readonly pages: readonly GraphleSitePage[] }>(fetcher, "/api/site/pages"),
    readJson<{ readonly posts: readonly GraphleSitePost[] }>(fetcher, "/api/site/posts"),
  ]);

  return {
    pages: pagePayload.pages,
    posts: postPayload.posts,
  };
}

export async function loadGraphleSiteStatus({
  fetcher = fetch,
  now = () => new Date(),
  path = "/",
}: {
  readonly fetcher?: GraphleSiteStatusFetcher;
  readonly now?: () => Date;
  readonly path?: string;
} = {}): Promise<GraphleSiteStatusSnapshot> {
  const [health, session, route] = await Promise.all([
    readJson<GraphleSiteHealth>(fetcher, "/api/health"),
    readJson<GraphleSiteSession>(fetcher, "/api/session"),
    readJson<GraphleSiteRoute>(fetcher, routePath(path)),
  ]);
  const { pages, posts } = await loadAuthoringLists(fetcher, session);

  return {
    loadedAt: now().toISOString(),
    health,
    session,
    route,
    pages,
    posts,
  };
}

export interface GraphleSitePageInput {
  readonly title: string;
  readonly path: string;
  readonly body: string;
  readonly status: GraphleSitePublicationStatus;
}

export interface GraphleSitePostInput {
  readonly title: string;
  readonly slug: string;
  readonly body: string;
  readonly excerpt: string;
  readonly status: GraphleSitePublicationStatus;
}

export async function createGraphleSitePage(
  input: GraphleSitePageInput,
  fetcher: GraphleSiteStatusFetcher = fetch,
): Promise<GraphleSitePage> {
  const payload = await writeJson<{ readonly page: GraphleSitePage }>(
    fetcher,
    "/api/site/pages",
    "POST",
    input,
  );
  return payload.page;
}

export async function updateGraphleSitePage(
  id: string,
  input: GraphleSitePageInput,
  fetcher: GraphleSiteStatusFetcher = fetch,
): Promise<GraphleSitePage> {
  const payload = await writeJson<{ readonly page: GraphleSitePage }>(
    fetcher,
    `/api/site/pages/${encodeURIComponent(id)}`,
    "PATCH",
    input,
  );
  return payload.page;
}

export async function createGraphleSitePost(
  input: GraphleSitePostInput,
  fetcher: GraphleSiteStatusFetcher = fetch,
): Promise<GraphleSitePost> {
  const payload = await writeJson<{ readonly post: GraphleSitePost }>(
    fetcher,
    "/api/site/posts",
    "POST",
    input,
  );
  return payload.post;
}

export async function updateGraphleSitePost(
  id: string,
  input: GraphleSitePostInput,
  fetcher: GraphleSiteStatusFetcher = fetch,
): Promise<GraphleSitePost> {
  const payload = await writeJson<{ readonly post: GraphleSitePost }>(
    fetcher,
    `/api/site/posts/${encodeURIComponent(id)}`,
    "PATCH",
    input,
  );
  return payload.post;
}
