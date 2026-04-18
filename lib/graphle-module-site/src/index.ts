import { defineGraphModuleManifest, type RecordSurfaceSpec } from "@dpeek/graphle-module";
import {
  defineDefaultEnumTypeModule,
  defineEnum,
  defineType,
  defineValidatedStringTypeModule,
  existingEntityReferenceField,
  type TypeModuleFilter,
} from "@dpeek/graphle-module";
import { applyGraphIdMap, type ResolvedGraphNamespace } from "@dpeek/graphle-kernel";
import {
  dateTypeModule,
  markdownTypeModule,
  numberTypeModule,
  stringTypeModule,
  tag,
  urlTypeModule,
} from "@dpeek/graphle-module-core";

import siteIds from "./site.json";

export const siteModuleId = "site";

export const sitePathPattern = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/;
export const siteVisibilities = ["private", "public"] as const;
export const siteIconPresets = [
  "link",
  "website",
  "github",
  "x",
  "linkedin",
  "rss",
  "email",
  "book",
  "note",
] as const;

export type SiteVisibility = (typeof siteVisibilities)[number];
export type SiteIconPreset = (typeof siteIconPresets)[number];

export interface SiteItemSearchTag {
  readonly key?: string;
  readonly name?: string;
}

export interface SiteItemSearchTarget {
  readonly title: string;
  readonly path?: string;
  readonly url?: string;
  readonly body?: string;
  readonly visibility?: SiteVisibility;
  readonly icon?: SiteIconPreset;
  readonly tags?: readonly SiteItemSearchTag[];
  readonly sortOrder?: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export function parseSitePath(raw: string): string {
  const value = raw.trim();
  if (!sitePathPattern.test(value)) {
    throw new Error(`Invalid site path "${raw}"`);
  }
  return value;
}

function parseSitePathPrefix(raw: string): string {
  const value = raw.trim();
  if (value === "/" || /^\/[a-z0-9/-]*$/.test(value)) return value;
  throw new Error(`Invalid site path prefix "${raw}"`);
}

export function parseSiteAbsoluteUrl(raw: string): string {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid site URL "${raw}"`);
  }
  if (url.protocol.length === 0) {
    throw new Error(`Invalid site URL "${raw}"`);
  }
  return url.toString();
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
  return [...changedPredicateKeys].some(
    (key) => !key.endsWith(":createdAt") && !key.endsWith(":updatedAt"),
  );
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

export const siteVisibility = defineEnum({
  values: { key: "site:visibility", name: "Site Visibility" },
  options: {
    private: {
      name: "Private",
    },
    public: {
      name: "Public",
    },
  },
});

export const siteVisibilityTypeModule = defineDefaultEnumTypeModule(siteVisibility);

export const siteIconPreset = defineEnum({
  values: { key: "site:icon", name: "Site Icon Preset" },
  options: Object.fromEntries(
    siteIconPresets.map((preset) => [
      preset,
      {
        name: preset,
      },
    ]),
  ) as Record<SiteIconPreset, { name: string }>,
});

export const siteIconPresetTypeModule = defineDefaultEnumTypeModule(siteIconPreset);

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

function optionalBodyField(label: string) {
  return markdownTypeModule.field({
    cardinality: "one?",
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

function visibilityField(label: string) {
  return {
    ...siteVisibilityTypeModule.field({
      cardinality: "one",
      onCreate: ({ incoming }) => incoming ?? enumOptionId(siteVisibility.values.private),
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

const siteItemDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

function formatSiteItemDate(value: Date): string {
  return siteItemDateFormatter.format(value);
}

function createdAtField() {
  return {
    ...dateTypeModule.field({
      cardinality: "one",
      onCreate: ({ incoming, now }) => incoming ?? now,
      meta: {
        label: "Created at",
        display: {
          format: formatSiteItemDate,
        },
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

export const siteItem = defineType({
  values: { key: "site:item", name: "Item" },
  fields: {
    title: titleField("Title"),
    path: sitePathTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Path",
      },
      filter: {
        operators: ["equals", "prefix"] as const,
        defaultOperator: "equals",
      },
    }),
    url: urlTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "URL",
      },
      filter: {
        operators: ["equals", "host"] as const,
        defaultOperator: "equals",
      },
    }),
    body: optionalBodyField("Body"),
    visibility: visibilityField("Visibility"),
    icon: siteIconPresetTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Icon",
        display: {
          kind: "badge",
        },
      },
      filter: {
        operators: ["is", "oneOf"] as const,
        defaultOperator: "is",
      },
    }),
    tags: existingEntityReferenceField(tag, {
      cardinality: "many",
      collection: "ordered",
      create: true,
      editorKind: "entity-reference-combobox",
      label: "Tags",
    }),
    sortOrder: numberTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Sort order",
      },
      filter: {
        operators: ["equals", "lt", "gt"] as const,
        defaultOperator: "equals",
      },
    }),
    createdAt: createdAtField(),
    updatedAt: updatedAtField(),
  },
});

const siteSchemaInput = {
  path: sitePath,
  visibility: siteVisibility,
  iconPreset: siteIconPreset,
  item: siteItem,
};

export type SiteNamespace = ResolvedGraphNamespace<typeof siteSchemaInput>;

export const site: SiteNamespace = applyGraphIdMap(siteIds, siteSchemaInput);

export const siteItemSurface = {
  key: "site:item:surface",
  subject: site.item.values.key,
  titleField: "title",
  sections: [
    {
      key: "content",
      title: "Content",
      fields: [
        { path: "icon", label: "Icon" },
        { path: "title", label: "Title" },
        { path: "body", label: "Body" },
        { path: "url", label: "URL" },
        { path: "tags", label: "Tags" },
      ],
    },
    {
      key: "route",
      title: "Route",
      fields: [
        { path: "path", label: "Path" },
        { path: "visibility", label: "Visibility" },
      ],
    },
    {
      key: "metadata",
      title: "Metadata",
      fields: [
        { path: "createdAt", label: "Created at" },
        { path: "updatedAt", label: "Updated at" },
      ],
    },
  ],
} as const satisfies RecordSurfaceSpec;

export const siteItemViewSurface = {
  key: "site:item:view-surface",
  subject: site.item.values.key,
  titleField: "title",
  sections: [
    {
      key: "content",
      title: "Content",
      fields: [
        { path: "title", label: "Title" },
        { path: "createdAt", label: "Created at" },
        { path: "tags", label: "Tags" },
        { path: "body", label: "Body" },
      ],
    },
  ],
} as const satisfies RecordSurfaceSpec;

export interface SiteItemRoute {
  readonly kind: "item";
  readonly path: string;
}

export interface SiteRouteNotFoundResult {
  readonly kind: "not-found";
  readonly path: string;
}

export type SiteRouteResult = SiteItemRoute | SiteRouteNotFoundResult;

export function parseSiteVisibility(raw: unknown): SiteVisibility {
  if (raw === "private" || raw === "public") return raw;
  throw new Error(`Invalid site visibility "${String(raw)}"`);
}

export function siteVisibilityIdFor(visibility: SiteVisibility): string {
  return site.visibility.values[visibility].id;
}

export function siteVisibilityForId(id: string): SiteVisibility | undefined {
  if (id === site.visibility.values.private.id) return "private";
  if (id === site.visibility.values.public.id) return "public";
  return undefined;
}

export function parseSiteIconPreset(raw: unknown): SiteIconPreset {
  if (siteIconPresets.includes(raw as SiteIconPreset)) return raw as SiteIconPreset;
  throw new Error(`Invalid site icon preset "${String(raw)}"`);
}

export function siteIconPresetIdFor(icon: SiteIconPreset): string {
  return site.iconPreset.values[icon].id;
}

export function siteIconPresetForId(id: string): SiteIconPreset | undefined {
  return siteIconPresets.find((preset) => site.iconPreset.values[preset].id === id);
}

export function parseSitePublicRoute(path: string): SiteItemRoute {
  return {
    kind: "item",
    path: parseSitePath(path),
  };
}

function searchableUrlParts(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const url = new URL(value);
    return [url.toString(), url.host, url.pathname].filter(Boolean);
  } catch {
    return [value];
  }
}

export function siteItemMatchesSearch(item: SiteItemSearchTarget, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (query.length === 0) return true;

  const haystack = [
    item.title,
    item.path,
    ...searchableUrlParts(item.url),
    item.body,
    item.visibility,
    item.icon,
    ...(item.tags ?? []).flatMap((tag) => [tag.key, tag.name]),
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n")
    .toLowerCase();

  return haystack.includes(query);
}

function optionalNumber(value: number | undefined): number {
  return value ?? Number.POSITIVE_INFINITY;
}

function optionalDate(value: string | undefined): string {
  return value ?? "";
}

export function compareSiteItems(left: SiteItemSearchTarget, right: SiteItemSearchTarget): number {
  const leftHasSortOrder = left.sortOrder !== undefined;
  const rightHasSortOrder = right.sortOrder !== undefined;

  if (leftHasSortOrder || rightHasSortOrder) {
    const sortOrder = optionalNumber(left.sortOrder) - optionalNumber(right.sortOrder);
    if (sortOrder !== 0) return sortOrder;
  }

  const createdAt = optionalDate(right.createdAt).localeCompare(optionalDate(left.createdAt));
  if (createdAt !== 0) return createdAt;

  const updatedAt = optionalDate(right.updatedAt).localeCompare(optionalDate(left.updatedAt));
  if (updatedAt !== 0) return updatedAt;

  return left.title.localeCompare(right.title);
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
    recordSurfaces: [siteItemSurface, siteItemViewSurface],
  },
});
