import { createBootstrappedSnapshot } from "@dpeek/graphle-bootstrap";
import { createGraphStore } from "@dpeek/graphle-kernel";
import { minimalCore } from "@dpeek/graphle-module-core";
import {
  parseSitePath,
  parseSitePublicRoute,
  parseSitePublicationStatus,
  parseSiteSlug,
  site,
  siteStatusForId,
  siteStatusIdFor,
  type SitePublicationStatus,
} from "@dpeek/graphle-module-site";
import {
  createGraphleSqlitePersistedAuthoritativeGraph,
  type GraphleSqliteHandle,
} from "@dpeek/graphle-sqlite";

export const graphleLocalSiteAuthorityId = "site";

const localSiteGraphDefinitions = { ...minimalCore, ...site } as const;

export type LocalSiteStartupDiagnostics = {
  readonly recovery: "none" | "repair" | "reset-baseline";
  readonly repairReasons: readonly string[];
  readonly resetReasons: readonly string[];
};

export type LocalSitePage = {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly body: string;
  readonly status: SitePublicationStatus;
  readonly updatedAt: string;
};

export type LocalSitePost = {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly body: string;
  readonly excerpt: string;
  readonly publishedAt?: string;
  readonly status: SitePublicationStatus;
  readonly updatedAt: string;
};

type LocalSiteRawPage = {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly body: string;
  readonly status: string;
  readonly updatedAt?: Date | string;
};

type LocalSiteRawPost = {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly body: string;
  readonly excerpt: string;
  readonly publishedAt?: Date | string;
  readonly status: string;
  readonly updatedAt?: Date | string;
};

type LocalSiteRawPageCreate = {
  readonly title: string;
  readonly path: string;
  readonly body: string;
  readonly status: string;
  readonly updatedAt: Date;
};

type LocalSiteRawPostCreate = {
  readonly title: string;
  readonly slug: string;
  readonly body: string;
  readonly excerpt: string;
  readonly publishedAt?: Date;
  readonly status: string;
  readonly updatedAt: Date;
};

type LocalSiteRawPagePatch = {
  title?: string;
  path?: string;
  body?: string;
  status?: string;
  updatedAt?: Date;
};

type LocalSiteRawPostPatch = {
  title?: string;
  slug?: string;
  body?: string;
  excerpt?: string;
  publishedAt?: Date;
  status?: string;
  updatedAt?: Date;
};

export type LocalSiteRouteResult =
  | {
      readonly kind: "page";
      readonly path: string;
      readonly page: LocalSitePage;
    }
  | {
      readonly kind: "post";
      readonly path: string;
      readonly post: LocalSitePost;
    }
  | {
      readonly kind: "not-found";
      readonly path: string;
      readonly message: string;
    };

export interface LocalSiteValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export class LocalSiteValidationError extends Error {
  readonly issues: readonly LocalSiteValidationIssue[];

  constructor(issues: readonly LocalSiteValidationIssue[]) {
    super(issues[0]?.message ?? "Invalid site input.");
    this.name = "LocalSiteValidationError";
    this.issues = issues;
  }
}

export class LocalSiteNotFoundError extends Error {
  readonly code = "site.record_not_found";

  constructor(kind: "page" | "post", id: string) {
    super(`Site ${kind} "${id}" was not found.`);
    this.name = "LocalSiteNotFoundError";
  }
}

export interface LocalSiteAuthority {
  readonly startupDiagnostics: LocalSiteStartupDiagnostics;
  readonly graph: {
    readonly page: {
      create(input: LocalSiteRawPageCreate): string;
      update(id: string, patch: LocalSiteRawPagePatch): LocalSiteRawPage;
      list(): readonly LocalSiteRawPage[];
    };
    readonly post: {
      create(input: LocalSiteRawPostCreate): string;
      update(id: string, patch: LocalSiteRawPostPatch): LocalSiteRawPost;
      list(): readonly LocalSiteRawPost[];
    };
  };
  persist(): Promise<void>;
}

export interface OpenLocalSiteAuthorityOptions {
  readonly sqlite: GraphleSqliteHandle;
  readonly now?: () => Date;
}

export interface LocalSiteHomePage {
  readonly title: string;
  readonly body: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function validationIssue(
  path: string,
  message: string,
  code = "site.input_invalid",
): LocalSiteValidationIssue {
  return { path, message, code };
}

function requireInputObject(input: unknown): Record<string, unknown> {
  if (isRecord(input)) return input;
  throw new LocalSiteValidationError([
    validationIssue("body", "Request body must be a JSON object.", "site.body_invalid"),
  ]);
}

function readStringField(
  input: Record<string, unknown>,
  path: string,
  options: { readonly required: boolean; readonly nonBlank?: boolean },
): string | undefined {
  if (!hasOwn(input, path)) {
    if (options.required) {
      throw new LocalSiteValidationError([
        validationIssue(path, `${path} is required.`, "site.field_required"),
      ]);
    }
    return undefined;
  }

  const value = input[path];
  if (typeof value !== "string") {
    throw new LocalSiteValidationError([
      validationIssue(path, `${path} must be a string.`, "site.field_type"),
    ]);
  }
  if (options.nonBlank && value.trim().length === 0) {
    throw new LocalSiteValidationError([
      validationIssue(path, `${path} must not be blank.`, "site.field_blank"),
    ]);
  }

  return value;
}

function readStatusField(
  input: Record<string, unknown>,
  fallback: SitePublicationStatus,
): SitePublicationStatus {
  if (!hasOwn(input, "status")) return fallback;
  try {
    return parseSitePublicationStatus(input.status);
  } catch (error) {
    throw new LocalSiteValidationError([
      validationIssue(
        "status",
        error instanceof Error ? error.message : "status is invalid.",
        "site.status_invalid",
      ),
    ]);
  }
}

function readPathField(input: Record<string, unknown>, options: { readonly required: boolean }) {
  const raw = readStringField(input, "path", { required: options.required, nonBlank: true });
  if (raw === undefined) return undefined;
  try {
    return parseSitePath(raw);
  } catch (error) {
    throw new LocalSiteValidationError([
      validationIssue(
        "path",
        error instanceof Error ? error.message : "path is invalid.",
        "site.path_invalid",
      ),
    ]);
  }
}

function readSlugField(input: Record<string, unknown>, options: { readonly required: boolean }) {
  const raw = readStringField(input, "slug", { required: options.required, nonBlank: true });
  if (raw === undefined) return undefined;
  try {
    return parseSiteSlug(raw);
  } catch (error) {
    throw new LocalSiteValidationError([
      validationIssue(
        "slug",
        error instanceof Error ? error.message : "slug is invalid.",
        "site.slug_invalid",
      ),
    ]);
  }
}

function formatDate(value: Date | string | undefined): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return undefined;
}

function requireDate(value: Date | string | undefined): string {
  return formatDate(value) ?? new Date(0).toISOString();
}

function serializeStatus(statusId: string): SitePublicationStatus {
  return siteStatusForId(statusId) ?? "draft";
}

function serializePage(page: LocalSiteRawPage): LocalSitePage {
  return {
    id: page.id,
    title: page.title,
    path: page.path,
    body: page.body,
    status: serializeStatus(page.status),
    updatedAt: requireDate(page.updatedAt),
  };
}

function serializePost(post: LocalSiteRawPost): LocalSitePost {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    body: post.body,
    excerpt: post.excerpt,
    ...(post.publishedAt ? { publishedAt: formatDate(post.publishedAt) } : {}),
    status: serializeStatus(post.status),
    updatedAt: requireDate(post.updatedAt),
  };
}

function sortPages(left: LocalSitePage, right: LocalSitePage): number {
  if (left.path === "/" && right.path !== "/") return -1;
  if (right.path === "/" && left.path !== "/") return 1;
  return left.path.localeCompare(right.path) || left.title.localeCompare(right.title);
}

function sortPosts(left: LocalSitePost, right: LocalSitePost): number {
  const rightPublishedAt = right.publishedAt ?? "";
  const leftPublishedAt = left.publishedAt ?? "";
  return (
    rightPublishedAt.localeCompare(leftPublishedAt) ||
    left.title.localeCompare(right.title) ||
    left.slug.localeCompare(right.slug)
  );
}

function ensureUniquePagePath(
  authority: LocalSiteAuthority,
  path: string,
  exceptId?: string,
): void {
  const existing = authority.graph.page
    .list()
    .find((page) => page.path === path && page.id !== exceptId);
  if (!existing) return;
  throw new LocalSiteValidationError([
    validationIssue("path", `A page already exists at "${path}".`, "site.path_duplicate"),
  ]);
}

function ensureUniquePostSlug(
  authority: LocalSiteAuthority,
  slug: string,
  exceptId?: string,
): void {
  const existing = authority.graph.post
    .list()
    .find((post) => post.slug === slug && post.id !== exceptId);
  if (!existing) return;
  throw new LocalSiteValidationError([
    validationIssue("slug", `A post already exists at "${slug}".`, "site.slug_duplicate"),
  ]);
}

function findRawPage(authority: LocalSiteAuthority, id: string): LocalSiteRawPage {
  const page = authority.graph.page.list().find((candidate) => candidate.id === id);
  if (!page) throw new LocalSiteNotFoundError("page", id);
  return page;
}

function findRawPost(authority: LocalSiteAuthority, id: string): LocalSiteRawPost {
  const post = authority.graph.post.list().find((candidate) => candidate.id === id);
  if (!post) throw new LocalSiteNotFoundError("post", id);
  return post;
}

function isVisible(status: SitePublicationStatus, includeDrafts: boolean): boolean {
  return includeDrafts || status === "published";
}

function createLocalSiteStore() {
  return createGraphStore(
    createBootstrappedSnapshot(localSiteGraphDefinitions, {
      availableDefinitions: localSiteGraphDefinitions,
      coreSchema: minimalCore,
    }),
  );
}

export async function openLocalSiteAuthority({
  sqlite,
  now = () => new Date(),
}: OpenLocalSiteAuthorityOptions): Promise<LocalSiteAuthority> {
  return createGraphleSqlitePersistedAuthoritativeGraph(createLocalSiteStore(), site, {
    handle: sqlite,
    authorityId: graphleLocalSiteAuthorityId,
    definitions: localSiteGraphDefinitions,
    seed(graph) {
      const timestamp = now();
      const publishedStatus = siteStatusIdFor("published");

      graph.page.create({
        title: "Home",
        path: "/",
        body: "Welcome to your new Graphle site.",
        status: publishedStatus,
        updatedAt: timestamp,
      });
      graph.post.create({
        title: "Example post",
        slug: "example-post",
        body: "This is the first durable post in your local site graph.",
        excerpt: "A short example post seeded into the local graph.",
        publishedAt: timestamp,
        status: publishedStatus,
        updatedAt: timestamp,
      });
    },
  });
}

export function listLocalSitePages(
  authority: LocalSiteAuthority | undefined,
): readonly LocalSitePage[] {
  return authority ? authority.graph.page.list().map(serializePage).sort(sortPages) : [];
}

export function listLocalSitePosts(
  authority: LocalSiteAuthority | undefined,
): readonly LocalSitePost[] {
  return authority ? authority.graph.post.list().map(serializePost).sort(sortPosts) : [];
}

export function resolveLocalSiteRoute(
  authority: LocalSiteAuthority | undefined,
  path: string,
  options: { readonly includeDrafts?: boolean } = {},
): LocalSiteRouteResult {
  const includeDrafts = options.includeDrafts === true;
  let routePath = path;
  let route;
  try {
    route = parseSitePublicRoute(path);
    routePath = route.kind === "page" ? route.path : `/posts/${route.slug}`;
  } catch {
    return {
      kind: "not-found",
      path,
      message: `No site route exists at ${path}.`,
    };
  }

  if (!authority) {
    return {
      kind: "not-found",
      path: routePath,
      message: `No site route exists at ${routePath}.`,
    };
  }

  if (route.kind === "post") {
    const post = listLocalSitePosts(authority).find(
      (candidate) => candidate.slug === route.slug && isVisible(candidate.status, includeDrafts),
    );
    return post
      ? {
          kind: "post",
          path: routePath,
          post,
        }
      : {
          kind: "not-found",
          path: routePath,
          message: `No published post exists at ${routePath}.`,
        };
  }

  const page = listLocalSitePages(authority).find(
    (candidate) => candidate.path === route.path && isVisible(candidate.status, includeDrafts),
  );
  return page
    ? {
        kind: "page",
        path: route.path,
        page,
      }
    : {
        kind: "not-found",
        path: route.path,
        message: `No published page exists at ${route.path}.`,
      };
}

export async function createLocalSitePage(
  authority: LocalSiteAuthority,
  input: unknown,
  options: { readonly now?: () => Date } = {},
): Promise<LocalSitePage> {
  const value = requireInputObject(input);
  const now = options.now ?? (() => new Date());
  const title = readStringField(value, "title", { required: true, nonBlank: true })!;
  const path = readPathField(value, { required: true })!;
  const body = readStringField(value, "body", { required: true })!;
  const status = readStatusField(value, "draft");

  ensureUniquePagePath(authority, path);
  const id = authority.graph.page.create({
    title,
    path,
    body,
    status: siteStatusIdFor(status),
    updatedAt: now(),
  });
  await authority.persist();
  return serializePage(findRawPage(authority, id));
}

export async function updateLocalSitePage(
  authority: LocalSiteAuthority,
  id: string,
  input: unknown,
): Promise<LocalSitePage> {
  const existing = findRawPage(authority, id);
  const value = requireInputObject(input);
  const patch: LocalSiteRawPagePatch = {};
  const title = readStringField(value, "title", { required: false, nonBlank: true });
  const path = readPathField(value, { required: false });
  const body = readStringField(value, "body", { required: false });

  if (title !== undefined) patch.title = title;
  if (path !== undefined) {
    ensureUniquePagePath(authority, path, id);
    patch.path = path;
  }
  if (body !== undefined) patch.body = body;
  if (hasOwn(value, "status")) patch.status = siteStatusIdFor(readStatusField(value, "draft"));

  if (Object.keys(patch).length === 0) return serializePage(existing);
  const updated = authority.graph.page.update(id, patch);
  await authority.persist();
  return serializePage(updated);
}

export async function createLocalSitePost(
  authority: LocalSiteAuthority,
  input: unknown,
  options: { readonly now?: () => Date } = {},
): Promise<LocalSitePost> {
  const value = requireInputObject(input);
  const now = options.now ?? (() => new Date());
  const title = readStringField(value, "title", { required: true, nonBlank: true })!;
  const slug = readSlugField(value, { required: true })!;
  const body = readStringField(value, "body", { required: true })!;
  const excerpt = readStringField(value, "excerpt", { required: true, nonBlank: true })!;
  const status = readStatusField(value, "draft");

  ensureUniquePostSlug(authority, slug);
  const timestamp = now();
  const id = authority.graph.post.create({
    title,
    slug,
    body,
    excerpt,
    ...(status === "published" ? { publishedAt: timestamp } : {}),
    status: siteStatusIdFor(status),
    updatedAt: timestamp,
  });
  await authority.persist();
  return serializePost(findRawPost(authority, id));
}

export async function updateLocalSitePost(
  authority: LocalSiteAuthority,
  id: string,
  input: unknown,
  options: { readonly now?: () => Date } = {},
): Promise<LocalSitePost> {
  const existing = findRawPost(authority, id);
  const existingStatus = serializeStatus(existing.status);
  const value = requireInputObject(input);
  const now = options.now ?? (() => new Date());
  const patch: LocalSiteRawPostPatch = {};
  const title = readStringField(value, "title", { required: false, nonBlank: true });
  const slug = readSlugField(value, { required: false });
  const body = readStringField(value, "body", { required: false });
  const excerpt = readStringField(value, "excerpt", { required: false, nonBlank: true });

  if (title !== undefined) patch.title = title;
  if (slug !== undefined) {
    ensureUniquePostSlug(authority, slug, id);
    patch.slug = slug;
  }
  if (body !== undefined) patch.body = body;
  if (excerpt !== undefined) patch.excerpt = excerpt;
  if (hasOwn(value, "status")) {
    const status = readStatusField(value, existingStatus);
    patch.status = siteStatusIdFor(status);
    if (status === "published" && existingStatus !== "published") {
      patch.publishedAt = now();
    }
    if (status === "draft") {
      patch.publishedAt = undefined;
    }
  }

  if (Object.keys(patch).length === 0) return serializePost(existing);
  const updated = authority.graph.post.update(id, patch);
  await authority.persist();
  return serializePost(updated);
}

export function readLocalSiteHomePage(
  authority: LocalSiteAuthority | undefined,
): LocalSiteHomePage | undefined {
  const home = listLocalSitePages(authority).find(
    (page) => page.path === "/" && page.status === "published",
  );
  if (!home) return undefined;

  return {
    title: home.title,
    body: home.body,
  };
}

export function readLocalSiteAuthorityHealth(authority: LocalSiteAuthority | undefined) {
  if (!authority) {
    return {
      status: "unavailable" as const,
    };
  }

  return {
    status: "ok" as const,
    startupDiagnostics: authority.startupDiagnostics,
    records: {
      pages: listLocalSitePages(authority).length,
      posts: listLocalSitePosts(authority).length,
    },
  };
}
