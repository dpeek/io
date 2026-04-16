import { defineGraphModuleManifest } from "@dpeek/graphle-module";
import {
  defineDefaultEnumTypeModule,
  defineEnum,
  defineType,
  defineValidatedStringTypeModule,
  type TypeModuleFilter,
} from "@dpeek/graphle-module";
import { applyGraphIdMap, type ResolvedGraphNamespace } from "@dpeek/graphle-kernel";
import {
  dateTypeModule,
  markdownTypeModule,
  slugTypeModule,
  stringTypeModule,
} from "@dpeek/graphle-module-core";

import siteIds from "./site.json";

export const siteModuleId = "site";

export const sitePathPattern = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/;
export const siteSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const sitePublicationStatuses = ["draft", "published"] as const;

export function parseSitePath(raw: string): string {
  const value = raw.trim();
  if (!sitePathPattern.test(value)) {
    throw new Error(`Invalid site path "${raw}"`);
  }
  return value;
}

function normalizeSiteSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-");
}

export function parseSiteSlug(raw: string): string {
  const value = normalizeSiteSlug(raw);
  if (!siteSlugPattern.test(value)) {
    throw new Error(`Invalid site slug "${raw}"`);
  }
  return value;
}

function parseSitePathPrefix(raw: string): string {
  const value = raw.trim();
  if (value === "/" || /^\/[a-z0-9/-]*$/.test(value)) return value;
  throw new Error(`Invalid site path prefix "${raw}"`);
}

function requiredString(label: string, value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? undefined
    : {
        code: "site.string.blank",
        message: `${label} must not be blank.`,
      };
}

function enumOptionId(option: { readonly key: string; readonly id?: string }): string {
  return option.id ?? option.key;
}

function shouldTouchUpdatedAt(changedPredicateKeys: ReadonlySet<string>): boolean {
  return [...changedPredicateKeys].some((key) => !key.endsWith(":updatedAt"));
}

const sitePathFilter = {
  defaultOperator: "equals",
  operators: {
    equals: {
      label: "Equals",
      operand: {
        kind: "string",
        placeholder: "/about",
      },
      parse: parseSitePath,
      format: (operand: string) => operand,
      test: (value: string, operand: string) => value === operand,
    },
    prefix: {
      label: "Starts with",
      operand: {
        kind: "string",
        placeholder: "/work",
      },
      parse: parseSitePathPrefix,
      format: (operand: string) => operand,
      test: (value: string, operand: string) => value.startsWith(operand),
    },
  },
} satisfies TypeModuleFilter<string>;

export const sitePathTypeModule = defineValidatedStringTypeModule({
  values: { key: "site:path", name: "Site Path" },
  parse: parseSitePath,
  filter: sitePathFilter,
  placeholder: "/about",
});

export const sitePath = sitePathTypeModule.type;

export const siteStatus = defineEnum({
  values: { key: "site:status", name: "Site Status" },
  options: {
    draft: {
      name: "Draft",
    },
    published: {
      name: "Published",
    },
  },
});

export const siteStatusTypeModule = defineDefaultEnumTypeModule(siteStatus);

function titleField(label: string) {
  return stringTypeModule.field({
    cardinality: "one",
    validate: ({ value }) => requiredString(label, value),
    meta: {
      label,
    },
    filter: {
      operators: ["contains", "equals"] as const,
      defaultOperator: "contains",
    },
  });
}

function bodyField(label: string) {
  return markdownTypeModule.field({
    cardinality: "one",
    meta: {
      label,
      editor: {
        kind: "markdown",
        multiline: true,
      },
    },
    filter: {
      operators: ["contains", "equals"] as const,
      defaultOperator: "contains",
    },
  });
}

function statusField(label: string) {
  return {
    ...siteStatusTypeModule.field({
      cardinality: "one",
      onCreate: ({ incoming }) => incoming ?? enumOptionId(siteStatus.values.draft),
      meta: {
        label,
        display: {
          kind: "badge",
        },
      },
      filter: {
        operators: ["is", "oneOf"] as const,
        defaultOperator: "is",
      },
    }),
    createOptional: true as const,
  };
}

function updatedAtField() {
  return {
    ...dateTypeModule.field({
      cardinality: "one",
      onCreate: ({ incoming, now }) => incoming ?? now,
      onUpdate: ({ now, changedPredicateKeys }) =>
        shouldTouchUpdatedAt(changedPredicateKeys) ? now : undefined,
      meta: {
        label: "Updated at",
      },
    }),
    createOptional: true as const,
  };
}

export const sitePage = defineGraphPageType();

export const sitePost = defineGraphPostType();

function defineGraphPageType() {
  return defineType({
    values: { key: "site:page", name: "Page" },
    fields: {
      title: titleField("Title"),
      path: sitePathTypeModule.field({
        cardinality: "one",
        meta: {
          label: "Path",
        },
        filter: {
          operators: ["equals", "prefix"] as const,
          defaultOperator: "equals",
        },
      }),
      body: bodyField("Body"),
      status: statusField("Status"),
      updatedAt: updatedAtField(),
    },
  });
}

function defineGraphPostType() {
  return defineType({
    values: { key: "site:post", name: "Post" },
    fields: {
      title: titleField("Title"),
      slug: slugTypeModule.field({
        cardinality: "one",
        meta: {
          label: "Slug",
        },
        filter: {
          operators: ["equals", "prefix"] as const,
          defaultOperator: "equals",
        },
      }),
      body: bodyField("Body"),
      excerpt: stringTypeModule.field({
        cardinality: "one",
        validate: ({ value }) => requiredString("Excerpt", value),
        meta: {
          label: "Excerpt",
          editor: {
            kind: "textarea",
            multiline: true,
          },
        },
        filter: {
          operators: ["contains", "equals"] as const,
          defaultOperator: "contains",
        },
      }),
      publishedAt: dateTypeModule.field({
        cardinality: "one?",
        meta: {
          label: "Published at",
        },
      }),
      status: statusField("Status"),
      updatedAt: updatedAtField(),
    },
  });
}

const siteSchemaInput = {
  path: sitePath,
  status: siteStatus,
  page: sitePage,
  post: sitePost,
};

export type SiteNamespace = ResolvedGraphNamespace<typeof siteSchemaInput>;

export const site: SiteNamespace = applyGraphIdMap(siteIds, siteSchemaInput);

export type SitePublicationStatus = (typeof sitePublicationStatuses)[number];

export interface SitePublicPageRoute {
  readonly kind: "page";
  readonly path: string;
}

export interface SitePublicPostRoute {
  readonly kind: "post";
  readonly slug: string;
}

export type SitePublicRoute = SitePublicPageRoute | SitePublicPostRoute;

export type SiteRouteResultKind = "page" | "post" | "not-found";

export interface SiteRoutePageResult {
  readonly kind: "page";
  readonly path: string;
}

export interface SiteRoutePostResult {
  readonly kind: "post";
  readonly path: string;
  readonly slug: string;
}

export interface SiteRouteNotFoundResult {
  readonly kind: "not-found";
  readonly path: string;
}

export type SiteRouteResult = SiteRoutePageResult | SiteRoutePostResult | SiteRouteNotFoundResult;

export function parseSitePublicationStatus(raw: unknown): SitePublicationStatus {
  if (raw === "draft" || raw === "published") return raw;
  throw new Error(`Invalid site status "${String(raw)}"`);
}

export function siteStatusIdFor(status: SitePublicationStatus): string {
  return site.status.values[status].id;
}

export function siteStatusForId(id: string): SitePublicationStatus | undefined {
  if (id === site.status.values.draft.id) return "draft";
  if (id === site.status.values.published.id) return "published";
  return undefined;
}

export function parseSitePublicRoute(path: string): SitePublicRoute {
  const value = parseSitePath(path);
  const postMatch = /^\/posts\/([^/]+)$/.exec(value);
  if (postMatch?.[1]) {
    return {
      kind: "post",
      slug: parseSiteSlug(postMatch[1]),
    };
  }

  return {
    kind: "page",
    path: value,
  };
}

export const siteManifest = defineGraphModuleManifest({
  moduleId: siteModuleId,
  version: "0.0.1",
  source: {
    kind: "built-in",
    specifier: "@dpeek/graphle-module-site",
    exportName: "siteManifest",
  },
  compatibility: {
    graph: "graph-schema:v1",
    runtime: "graph-runtime:v1",
  },
  runtime: {
    schemas: [
      {
        key: "site",
        namespace: site,
      },
    ],
  },
});
