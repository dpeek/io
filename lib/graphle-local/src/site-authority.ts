import { createBootstrappedSnapshot } from "@dpeek/graphle-bootstrap";
import type { PersistedAuthoritativeGraph } from "@dpeek/graphle-authority";
import { createGraphStore } from "@dpeek/graphle-kernel";
import { colorType, minimalCore, tag } from "@dpeek/graphle-module-core";
import {
  compareSiteItems,
  parseSiteAbsoluteUrl,
  parseSiteIconPreset,
  parseSitePath,
  parseSitePublicRoute,
  parseSiteVisibility,
  site,
  siteIconPresetForId,
  siteIconPresetIdFor,
  siteItemMatchesSearch,
  siteVisibilityForId,
  siteVisibilityIdFor,
  type SiteIconPreset,
  type SiteVisibility,
} from "@dpeek/graphle-module-site";
import {
  createGraphleSqlitePersistedAuthoritativeGraph,
  type GraphleSqliteHandle,
} from "@dpeek/graphle-sqlite";

export const graphleLocalSiteAuthorityId = "site";

export type LocalSiteGraphNamespace = typeof site & {
  readonly tag: typeof tag;
};
export type LocalSiteGraphDefinitions = typeof minimalCore & {
  readonly color: typeof colorType;
  readonly tag: typeof tag;
} & typeof site;

const localSiteGraphNamespace: LocalSiteGraphNamespace = { ...site, tag };
const localSiteGraphDefinitions: LocalSiteGraphDefinitions = {
  ...minimalCore,
  color: colorType,
  tag,
  ...site,
};
const defaultTagColor = "#2563eb";

export type LocalSiteStartupDiagnostics = {
  readonly recovery: "none" | "repair" | "reset-baseline";
  readonly repairReasons: readonly string[];
  readonly resetReasons: readonly string[];
};

export interface LocalSiteTag {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly color: string;
}

export interface LocalSiteItem {
  readonly id: string;
  readonly title: string;
  readonly path?: string;
  readonly url?: string;
  readonly body?: string;
  readonly excerpt?: string;
  readonly visibility: SiteVisibility;
  readonly icon?: SiteIconPreset;
  readonly tags: readonly LocalSiteTag[];
  readonly pinned: boolean;
  readonly sortOrder?: number;
  readonly publishedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type LocalSiteRouteResult =
  | {
      readonly kind: "item";
      readonly path: string;
      readonly item: LocalSiteItem;
    }
  | {
      readonly kind: "not-found";
      readonly path: string;
      readonly message: string;
    };

export interface LocalSiteRoutePayload {
  readonly route: LocalSiteRouteResult;
  readonly items: readonly LocalSiteItem[];
}

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

  constructor(id: string) {
    super(`Site item "${id}" was not found.`);
    this.name = "LocalSiteNotFoundError";
  }
}

export type LocalSiteAuthority = PersistedAuthoritativeGraph<
  LocalSiteGraphNamespace,
  LocalSiteGraphDefinitions
>;

type LocalSiteRawTag = ReturnType<LocalSiteAuthority["graph"]["tag"]["list"]>[number];
type LocalSiteRawItem = ReturnType<LocalSiteAuthority["graph"]["item"]["list"]>[number];
type LocalSiteRawItemPatch = Parameters<LocalSiteAuthority["graph"]["item"]["update"]>[1];

export interface OpenLocalSiteAuthorityOptions {
  readonly sqlite: GraphleSqliteHandle;
  readonly now?: () => Date;
}

export interface LocalSiteHomePage {
  readonly title: string;
  readonly body: string;
}

interface NormalizedTagInput {
  readonly key: string;
  readonly name: string;
  readonly color?: string;
}

interface NormalizedItemInput {
  readonly title?: string;
  readonly path?: string;
  readonly url?: URL;
  readonly body?: string;
  readonly excerpt?: string;
  readonly visibility?: SiteVisibility;
  readonly icon?: SiteIconPreset;
  readonly tags?: readonly NormalizedTagInput[];
  readonly pinned?: boolean;
  readonly sortOrder?: number;
  readonly publishedAt?: Date;
}

interface NormalizedReorderItemInput {
  readonly id: string;
  readonly sortOrder: number;
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

function throwIssue(path: string, message: string, code?: string): never {
  throw new LocalSiteValidationError([validationIssue(path, message, code)]);
}

function requireInputObject(input: unknown): Record<string, unknown> {
  if (isRecord(input)) return input;
  throwIssue("body", "Request body must be a JSON object.", "site.body_invalid");
}

function readStringField(
  input: Record<string, unknown>,
  path: string,
  options: {
    readonly required: boolean;
    readonly nonBlank?: boolean;
    readonly emptyAsUndefined?: boolean;
  },
): string | undefined {
  if (!hasOwn(input, path)) {
    if (options.required) throwIssue(path, `${path} is required.`, "site.field_required");
    return undefined;
  }

  const value = input[path];
  if (value === null && !options.required) return undefined;
  if (typeof value !== "string") {
    throwIssue(path, `${path} must be a string.`, "site.field_type");
  }

  const trimmed = value.trim();
  if (options.emptyAsUndefined && trimmed.length === 0) return undefined;
  if (options.nonBlank && trimmed.length === 0) {
    throwIssue(path, `${path} must not be blank.`, "site.field_blank");
  }

  return value;
}

function readBooleanField(input: Record<string, unknown>, path: string): boolean | undefined {
  if (!hasOwn(input, path)) return undefined;
  const value = input[path];
  if (typeof value !== "boolean") {
    throwIssue(path, `${path} must be a boolean.`, "site.field_type");
  }
  return value;
}

function readNumberField(input: Record<string, unknown>, path: string): number | undefined {
  if (!hasOwn(input, path)) return undefined;
  const value = input[path];
  if (value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throwIssue(path, `${path} must be a finite number.`, "site.field_type");
  }
  return value;
}

function readPathField(input: Record<string, unknown>): string | undefined {
  const raw = readStringField(input, "path", {
    required: false,
    nonBlank: false,
    emptyAsUndefined: true,
  });
  if (raw === undefined) return undefined;
  try {
    return parseSitePath(raw);
  } catch (error) {
    throwIssue(
      "path",
      error instanceof Error ? error.message : "path is invalid.",
      "site.path_invalid",
    );
  }
}

function readUrlField(input: Record<string, unknown>): URL | undefined {
  const raw = readStringField(input, "url", {
    required: false,
    nonBlank: false,
    emptyAsUndefined: true,
  });
  if (raw === undefined) return undefined;
  try {
    return new URL(parseSiteAbsoluteUrl(raw));
  } catch (error) {
    throwIssue(
      "url",
      error instanceof Error ? error.message : "url is invalid.",
      "site.url_invalid",
    );
  }
}

function readVisibilityField(input: Record<string, unknown>): SiteVisibility | undefined {
  if (!hasOwn(input, "visibility")) return undefined;
  try {
    return parseSiteVisibility(input.visibility);
  } catch (error) {
    throwIssue(
      "visibility",
      error instanceof Error ? error.message : "visibility is invalid.",
      "site.visibility_invalid",
    );
  }
}

function readIconField(input: Record<string, unknown>): SiteIconPreset | undefined {
  if (!hasOwn(input, "icon")) return undefined;
  const value = input.icon;
  if (value === null || value === "") return undefined;
  try {
    return parseSiteIconPreset(value);
  } catch (error) {
    throwIssue(
      "icon",
      error instanceof Error ? error.message : "icon is invalid.",
      "site.icon_invalid",
    );
  }
}

function readDateField(input: Record<string, unknown>, path: string): Date | undefined {
  if (!hasOwn(input, path)) return undefined;
  const value = input[path];
  if (value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throwIssue(path, `${path} must be an ISO date string.`, "site.field_type");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throwIssue(path, `${path} must be a valid ISO date string.`, "site.date_invalid");
  }
  return date;
}

function normalizeTagKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function slugifyPathSegment(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "untitled";
}

function allocateUniqueSitePath(authority: LocalSiteAuthority, title: string): string {
  const base = `/${slugifyPathSegment(title)}`;
  const existingPaths = new Set(
    authority.graph.item
      .list()
      .map((item) => item.path)
      .filter((path): path is string => typeof path === "string" && path.length > 0),
  );

  if (!existingPaths.has(base)) return base;

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!existingPaths.has(candidate)) return candidate;
  }
}

function titleFromTagKey(key: string): string {
  return key
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function readTagsField(input: Record<string, unknown>): readonly NormalizedTagInput[] | undefined {
  if (!hasOwn(input, "tags")) return undefined;
  const value = input.tags;
  if (value === null) return [];
  if (!Array.isArray(value)) {
    throwIssue("tags", "tags must be an array.", "site.field_type");
  }

  const tags = new Map<string, NormalizedTagInput>();
  value.forEach((rawTag, index) => {
    let rawKey: string | undefined;
    let rawName: string | undefined;
    let rawColor: string | undefined;

    if (typeof rawTag === "string") {
      rawKey = rawTag;
      rawName = rawTag;
    } else if (isRecord(rawTag)) {
      if (typeof rawTag.key === "string") rawKey = rawTag.key;
      if (typeof rawTag.name === "string") rawName = rawTag.name;
      if (typeof rawTag.color === "string") rawColor = rawTag.color;
      rawKey ??= rawName;
    } else {
      throwIssue(`tags.${index}`, "tag entries must be strings or objects.", "site.field_type");
    }

    const key = normalizeTagKey(rawKey ?? "");
    if (key.length === 0) {
      throwIssue(`tags.${index}`, "tag key must not be blank.", "site.tag_blank");
    }
    tags.set(key, {
      key,
      name: rawName?.trim() || titleFromTagKey(key),
      ...(rawColor ? { color: rawColor } : {}),
    });
  });

  return [...tags.values()];
}

function formatDate(value: Date | string | undefined): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return undefined;
}

function requireDate(value: Date | string | undefined): string {
  return formatDate(value) ?? new Date(0).toISOString();
}

function formatUrl(value: URL | string | undefined): string | undefined {
  if (value instanceof URL) return value.toString();
  if (typeof value === "string") return value;
  return undefined;
}

function serializeVisibility(visibilityId: string): SiteVisibility {
  return siteVisibilityForId(visibilityId) ?? "private";
}

function serializeIcon(iconId: string | undefined): SiteIconPreset | undefined {
  return iconId ? siteIconPresetForId(iconId) : undefined;
}

function serializeTag(tagRecord: LocalSiteRawTag): LocalSiteTag {
  return {
    id: tagRecord.id,
    key: tagRecord.key,
    name: tagRecord.name,
    color: tagRecord.color,
  };
}

function serializeItem(authority: LocalSiteAuthority, item: LocalSiteRawItem): LocalSiteItem {
  const tagById = new Map(authority.graph.tag.list().map((tagRecord) => [tagRecord.id, tagRecord]));
  const tags = (item.tags ?? [])
    .map((id) => tagById.get(id))
    .filter((tagRecord): tagRecord is LocalSiteRawTag => Boolean(tagRecord))
    .map(serializeTag);

  return {
    id: item.id,
    title: item.title,
    ...(item.path ? { path: item.path } : {}),
    ...(item.url ? { url: formatUrl(item.url) } : {}),
    ...(item.body ? { body: item.body } : {}),
    ...(item.excerpt ? { excerpt: item.excerpt } : {}),
    visibility: serializeVisibility(item.visibility),
    ...(serializeIcon(item.icon) ? { icon: serializeIcon(item.icon) } : {}),
    tags,
    pinned: item.pinned ?? false,
    ...(typeof item.sortOrder === "number" ? { sortOrder: item.sortOrder } : {}),
    ...(item.publishedAt ? { publishedAt: formatDate(item.publishedAt) } : {}),
    createdAt: requireDate(item.createdAt),
    updatedAt: requireDate(item.updatedAt),
  };
}

function findRawItem(authority: LocalSiteAuthority, id: string): LocalSiteRawItem {
  const item = authority.graph.item.list().find((candidate) => candidate.id === id);
  if (!item) throw new LocalSiteNotFoundError(id);
  return item;
}

function ensureUniqueItemPath(
  authority: LocalSiteAuthority,
  path: string | undefined,
  exceptId?: string,
): void {
  if (!path) return;
  const existing = authority.graph.item
    .list()
    .find((item) => item.path === path && item.id !== exceptId);
  if (!existing) return;
  throw new LocalSiteValidationError([
    validationIssue("path", `An item already exists at "${path}".`, "site.path_duplicate"),
  ]);
}

function hasPublicSurface(input: {
  readonly path?: string;
  readonly url?: URL | string;
  readonly body?: string;
}): boolean {
  return Boolean(input.path || input.url || input.body?.trim());
}

function ensurePublicSurface(input: {
  readonly visibility: SiteVisibility;
  readonly path?: string;
  readonly url?: URL | string;
  readonly body?: string;
}): void {
  if (input.visibility === "private" || hasPublicSurface(input)) return;
  throw new LocalSiteValidationError([
    validationIssue(
      "visibility",
      "Public items need at least a path, URL, or body.",
      "site.public_item_empty",
    ),
  ]);
}

function createOrReuseTags(
  authority: LocalSiteAuthority,
  tags: readonly NormalizedTagInput[] | undefined,
): string[] | undefined {
  if (tags === undefined) return undefined;

  const ids: string[] = [];
  for (const input of tags) {
    const existing = authority.graph.tag.list().find((candidate) => candidate.key === input.key);
    if (existing) {
      ids.push(existing.id);
      continue;
    }

    ids.push(
      authority.graph.tag.create({
        name: input.name,
        key: input.key,
        color: input.color ?? defaultTagColor,
      }),
    );
  }
  return ids;
}

function normalizeItemInput(input: unknown): NormalizedItemInput {
  const value = requireInputObject(input);
  return {
    title: readStringField(value, "title", { required: false, nonBlank: true }),
    path: readPathField(value),
    url: readUrlField(value),
    body: readStringField(value, "body", {
      required: false,
      emptyAsUndefined: true,
    }),
    excerpt: readStringField(value, "excerpt", {
      required: false,
      emptyAsUndefined: true,
    }),
    visibility: readVisibilityField(value),
    icon: readIconField(value),
    tags: readTagsField(value),
    pinned: readBooleanField(value, "pinned"),
    sortOrder: readNumberField(value, "sortOrder"),
    publishedAt: readDateField(value, "publishedAt"),
  };
}

function normalizeCreateItemInput(
  authority: LocalSiteAuthority,
  input: unknown,
): NormalizedItemInput {
  const value = requireInputObject(input);
  if (!hasOwn(value, "intent")) return normalizeItemInput(value);

  if (value.intent !== "blank") {
    throwIssue("intent", 'intent must be "blank" when provided.', "site.intent_invalid");
  }

  return {
    title: "Untitled",
    path: allocateUniqueSitePath(authority, "Untitled"),
    visibility: "private",
    tags: [],
    pinned: false,
  };
}

function normalizeReorderInput(input: unknown): readonly NormalizedReorderItemInput[] {
  const value = requireInputObject(input);
  const rawItems = value.items;
  if (!Array.isArray(rawItems)) {
    throwIssue("items", "items must be an array.", "site.field_type");
  }

  const seenIds = new Set<string>();
  return rawItems.map((rawItem, index) => {
    if (!isRecord(rawItem)) {
      throwIssue(`items.${index}`, "order entries must be objects.", "site.field_type");
    }
    const id = readStringField(rawItem, "id", { required: true, nonBlank: true });
    const sortOrder = readNumberField(rawItem, "sortOrder");
    if (id === undefined) {
      throwIssue(`items.${index}.id`, "id is required.", "site.field_required");
    }
    if (sortOrder === undefined) {
      throwIssue(`items.${index}.sortOrder`, "sortOrder is required.", "site.field_required");
    }
    if (seenIds.has(id)) {
      throwIssue(`items.${index}.id`, `Duplicate item id "${id}".`, "site.item_duplicate");
    }
    seenIds.add(id);
    return { id, sortOrder };
  });
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
  return createGraphleSqlitePersistedAuthoritativeGraph(
    createLocalSiteStore(),
    localSiteGraphNamespace,
    {
      handle: sqlite,
      authorityId: graphleLocalSiteAuthorityId,
      definitions: localSiteGraphDefinitions,
      seed(graph) {
        const timestamp = now();
        const publicVisibility = siteVisibilityIdFor("public");
        const privateVisibility = siteVisibilityIdFor("private");
        const graphleTag = graph.tag.create({
          name: "Graphle",
          key: "graphle",
          color: defaultTagColor,
        });

        graph.item.create({
          title: "Home",
          path: "/",
          body: "# Home\n\nWelcome to your new Graphle site.",
          excerpt: "Welcome to your new Graphle site.",
          visibility: publicVisibility,
          icon: siteIconPresetIdFor("website"),
          tags: [graphleTag],
          pinned: true,
          sortOrder: 0,
          publishedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        graph.item.create({
          title: "Example note",
          path: "/notes/example",
          body: "# Example note\n\nThis path-backed item is stored in the local site graph.",
          excerpt: "A path-backed markdown item seeded into the local graph.",
          visibility: publicVisibility,
          icon: siteIconPresetIdFor("note"),
          tags: [graphleTag],
          publishedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        graph.item.create({
          title: "GitHub",
          url: new URL("https://github.com/dpeek"),
          excerpt: "Public URL-only link.",
          visibility: publicVisibility,
          icon: siteIconPresetIdFor("github"),
          tags: [graphleTag],
          pinned: true,
          sortOrder: 10,
          publishedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        graph.item.create({
          title: "X",
          url: new URL("https://x.com/dpeekdotcom"),
          excerpt: "Public URL-only link.",
          visibility: publicVisibility,
          icon: siteIconPresetIdFor("x"),
          tags: [graphleTag],
          pinned: true,
          sortOrder: 10,
          publishedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        graph.item.create({
          title: "LinkedIn",
          url: new URL("https://www.linkedin.com/in/dpeekdotcom/"),
          excerpt: "Public URL-only link.",
          visibility: publicVisibility,
          icon: siteIconPresetIdFor("linkedin"),
          tags: [graphleTag],
          pinned: true,
          sortOrder: 10,
          publishedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        graph.item.create({
          title: "Private",
          url: new URL("https://www.linkedin.com/in/dpeekdotcom/"),
          excerpt: "Public URL-only link.",
          visibility: privateVisibility,
          icon: siteIconPresetIdFor("link"),
          tags: [graphleTag],
          pinned: true,
          sortOrder: 10,
          publishedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      },
    },
  );
}

export function listLocalSiteItems(
  authority: LocalSiteAuthority | undefined,
): readonly LocalSiteItem[] {
  return authority
    ? authority.graph.item
        .list()
        .map((item) => serializeItem(authority, item))
        .sort(compareSiteItems)
    : [];
}

export function listPublicLocalSiteItems(
  authority: LocalSiteAuthority | undefined,
): readonly LocalSiteItem[] {
  return listLocalSiteItems(authority).filter((item) => item.visibility === "public");
}

export function searchLocalSiteItems(
  authority: LocalSiteAuthority | undefined,
  query: string,
  options: { readonly includePrivate?: boolean } = {},
): readonly LocalSiteItem[] {
  const items = options.includePrivate
    ? listLocalSiteItems(authority)
    : listPublicLocalSiteItems(authority);
  return items.filter((item) => siteItemMatchesSearch(item, query));
}

export function resolveLocalSiteRoute(
  authority: LocalSiteAuthority | undefined,
  path: string,
  options: { readonly includePrivate?: boolean } = {},
): LocalSiteRouteResult {
  let routePath = path;
  try {
    routePath = parseSitePublicRoute(path).path;
  } catch {
    return {
      kind: "not-found",
      path,
      message: `No site route exists at ${path}.`,
    };
  }

  const item = (
    options.includePrivate ? listLocalSiteItems(authority) : listPublicLocalSiteItems(authority)
  ).find((candidate) => candidate.path === routePath);

  return item
    ? {
        kind: "item",
        path: routePath,
        item,
      }
    : {
        kind: "not-found",
        path: routePath,
        message: `No visible item exists at ${routePath}.`,
      };
}

export function readLocalSiteRoutePayload(
  authority: LocalSiteAuthority | undefined,
  path: string,
  options: { readonly includePrivate?: boolean } = {},
): LocalSiteRoutePayload {
  return {
    route: resolveLocalSiteRoute(authority, path, options),
    items: options.includePrivate
      ? listLocalSiteItems(authority)
      : listPublicLocalSiteItems(authority),
  };
}

export async function createLocalSiteItem(
  authority: LocalSiteAuthority,
  input: unknown,
  options: { readonly now?: () => Date } = {},
): Promise<LocalSiteItem> {
  const now = options.now ?? (() => new Date());
  const value = normalizeCreateItemInput(authority, input);
  if (!value.title) {
    throw new LocalSiteValidationError([
      validationIssue("title", "title is required.", "site.field_required"),
    ]);
  }

  const timestamp = now();
  const visibility = value.visibility ?? "private";
  ensureUniqueItemPath(authority, value.path);
  ensurePublicSurface({
    visibility,
    path: value.path,
    url: value.url,
    body: value.body,
  });
  const tagIds = createOrReuseTags(authority, value.tags);
  const id = authority.graph.item.create({
    title: value.title,
    ...(value.path ? { path: value.path } : {}),
    ...(value.url ? { url: value.url } : {}),
    ...(value.body ? { body: value.body } : {}),
    ...(value.excerpt ? { excerpt: value.excerpt } : {}),
    visibility: siteVisibilityIdFor(visibility),
    ...(value.icon ? { icon: siteIconPresetIdFor(value.icon) } : {}),
    ...(tagIds ? { tags: tagIds } : {}),
    ...(value.pinned !== undefined ? { pinned: value.pinned } : {}),
    ...(value.sortOrder !== undefined ? { sortOrder: value.sortOrder } : {}),
    ...(value.publishedAt
      ? { publishedAt: value.publishedAt }
      : visibility === "public"
        ? { publishedAt: timestamp }
        : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await authority.persist();
  return serializeItem(authority, findRawItem(authority, id));
}

export async function deleteLocalSiteItem(
  authority: LocalSiteAuthority,
  id: string,
): Promise<void> {
  findRawItem(authority, id);
  authority.graph.item.delete(id);
  await authority.persist();
}

export async function reorderLocalSiteItems(
  authority: LocalSiteAuthority,
  input: unknown,
  options: { readonly now?: () => Date } = {},
): Promise<readonly LocalSiteItem[]> {
  const now = options.now ?? (() => new Date());
  const items = normalizeReorderInput(input);
  const rawItemsById = new Map(authority.graph.item.list().map((item) => [item.id, item]));
  const missing = items.find((item) => !rawItemsById.has(item.id));
  if (missing) throw new LocalSiteNotFoundError(missing.id);

  const timestamp = now();
  for (const item of items) {
    authority.graph.item.update(item.id, {
      sortOrder: item.sortOrder,
      updatedAt: timestamp,
    });
  }
  await authority.persist();
  return listLocalSiteItems(authority);
}

export async function updateLocalSiteItem(
  authority: LocalSiteAuthority,
  id: string,
  input: unknown,
  options: { readonly now?: () => Date } = {},
): Promise<LocalSiteItem> {
  const now = options.now ?? (() => new Date());
  const existing = findRawItem(authority, id);
  const value = normalizeItemInput(input);
  const current = serializeItem(authority, existing);
  const next = {
    title: value.title ?? current.title,
    path: hasOwn(requireInputObject(input), "path") ? value.path : current.path,
    url: hasOwn(requireInputObject(input), "url") ? value.url : existing.url,
    body: hasOwn(requireInputObject(input), "body") ? value.body : current.body,
    visibility: value.visibility ?? current.visibility,
  };

  ensureUniqueItemPath(authority, next.path, id);
  ensurePublicSurface(next);

  const patch: LocalSiteRawItemPatch = {};
  const inputObject = requireInputObject(input);
  if (value.title !== undefined) patch.title = value.title;
  if (hasOwn(inputObject, "path")) patch.path = value.path;
  if (hasOwn(inputObject, "url")) patch.url = value.url;
  if (hasOwn(inputObject, "body")) patch.body = value.body;
  if (hasOwn(inputObject, "excerpt")) patch.excerpt = value.excerpt;
  if (value.visibility !== undefined) patch.visibility = siteVisibilityIdFor(value.visibility);
  if (hasOwn(inputObject, "icon")) {
    patch.icon = value.icon ? siteIconPresetIdFor(value.icon) : undefined;
  }
  const tagIds = createOrReuseTags(authority, value.tags);
  if (tagIds !== undefined) patch.tags = tagIds;
  if (value.pinned !== undefined) patch.pinned = value.pinned;
  if (hasOwn(inputObject, "sortOrder")) patch.sortOrder = value.sortOrder;
  if (hasOwn(inputObject, "publishedAt")) patch.publishedAt = value.publishedAt;

  const nextVisibility = value.visibility ?? current.visibility;
  if (
    nextVisibility === "public" &&
    current.publishedAt === undefined &&
    patch.publishedAt === undefined
  ) {
    patch.publishedAt = now();
  }

  if (Object.keys(patch).length === 0) return serializeItem(authority, existing);
  patch.updatedAt = now();
  const updated = authority.graph.item.update(id, patch);
  await authority.persist();
  return serializeItem(authority, updated);
}

export function readLocalSiteHomePage(
  authority: LocalSiteAuthority | undefined,
): LocalSiteHomePage | undefined {
  const home = listPublicLocalSiteItems(authority).find((item) => item.path === "/");
  if (!home) return undefined;

  return {
    title: home.title,
    body: home.body ?? "",
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
      items: listLocalSiteItems(authority).length,
      tags: authority.graph.tag.list().length,
    },
  };
}
