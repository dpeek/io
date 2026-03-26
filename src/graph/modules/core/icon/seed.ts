import {
  type AnyTypeOutput,
  type DefinitionIconRef,
  type EdgeOutput,
  type GraphIconSeedRecord,
  readDefinitionIconId,
} from "@io/graph-kernel";

import booleanSvg from "./seed/boolean.svg?raw";
import colorSvg from "./seed/color.svg?raw";
import countrySvg from "./seed/country.svg?raw";
import dateSvg from "./seed/date.svg?raw";
import edgeSvg from "./seed/edge.svg?raw";
import emailSvg from "./seed/email.svg?raw";
import enumSvg from "./seed/enum.svg?raw";
import iconSvg from "./seed/icon.svg?raw";
import jsonSvg from "./seed/json.svg?raw";
import localeSvg from "./seed/locale.svg?raw";
import markdownSvg from "./seed/markdown.svg?raw";
import numberSvg from "./seed/number.svg?raw";
import secretSvg from "./seed/secret.svg?raw";
import slugSvg from "./seed/slug.svg?raw";
import stringSvg from "./seed/string.svg?raw";
import svgSvg from "./seed/svg.svg?raw";
import tagSvg from "./seed/tag.svg?raw";
import unknownSvg from "./seed/unknown.svg?raw";
import urlSvg from "./seed/url.svg?raw";

export type GraphIconSeed = GraphIconSeedRecord;

function normalizeSeedSvg(svg: string): string {
  return svg.trim().length > 0 ? svg : unknownSvg;
}

function defineGraphIconSeed(alias: string, input: { name: string; svg: string }): GraphIconSeed {
  return Object.freeze({
    id: `seed:icon:${alias}`,
    key: alias,
    name: input.name,
    svg: normalizeSeedSvg(input.svg),
  });
}

/**
 * Canonical built-in core icon catalog.
 *
 * This stays domain-owned so bootstrap can consume it without taking ownership
 * of one global icon registry.
 */
export const graphIconSeeds = {
  boolean: defineGraphIconSeed("boolean", { name: "Boolean", svg: booleanSvg }),
  color: defineGraphIconSeed("color", { name: "Color", svg: colorSvg }),
  country: defineGraphIconSeed("country", { name: "Country", svg: countrySvg }),
  date: defineGraphIconSeed("date", { name: "Date", svg: dateSvg }),
  edge: defineGraphIconSeed("edge", { name: "Edge", svg: edgeSvg }),
  email: defineGraphIconSeed("email", { name: "Email", svg: emailSvg }),
  locale: defineGraphIconSeed("locale", { name: "Locale", svg: localeSvg }),
  markdown: defineGraphIconSeed("markdown", { name: "Markdown", svg: markdownSvg }),
  number: defineGraphIconSeed("number", { name: "Number", svg: numberSvg }),
  string: defineGraphIconSeed("string", { name: "String", svg: stringSvg }),
  tag: defineGraphIconSeed("tag", { name: "Tag", svg: tagSvg }),
  unknown: defineGraphIconSeed("unknown", { name: "Unknown", svg: unknownSvg }),
  url: defineGraphIconSeed("url", { name: "URL", svg: urlSvg }),
  secret: defineGraphIconSeed("secret", { name: "Secret", svg: secretSvg }),
  json: defineGraphIconSeed("json", { name: "JSON", svg: jsonSvg }),
  slug: defineGraphIconSeed("slug", { name: "Slug", svg: slugSvg }),
  icon: defineGraphIconSeed("icon", { name: "Icon", svg: iconSvg }),
  svg: defineGraphIconSeed("svg", { name: "SVG", svg: svgSvg }),
  enum: defineGraphIconSeed("enum", { name: "Enum", svg: enumSvg }),
} as const;

export const graphIconSeedList = Object.values(graphIconSeeds);

export function resolveDefinitionIconId(value: DefinitionIconRef | undefined): string {
  return readDefinitionIconId(value) ?? graphIconSeeds.unknown.id;
}

/**
 * Default icon mapping for core-owned type definitions.
 */
export function resolveTypeDefinitionIconId(
  typeDef: Pick<AnyTypeOutput, "kind" | "values">,
): string {
  if (typeDef.values.icon) return resolveDefinitionIconId(typeDef.values.icon);
  if (typeDef.kind === "enum") return graphIconSeeds.tag.id;
  return graphIconSeeds.unknown.id;
}

/**
 * Default icon mapping for core-owned predicate definitions.
 */
export function resolvePredicateDefinitionIconId(
  predicateDef: Pick<EdgeOutput, "icon" | "range">,
  rangeType?: Pick<AnyTypeOutput, "kind" | "values">,
): string {
  if (predicateDef.icon) return resolveDefinitionIconId(predicateDef.icon);
  if (rangeType?.kind === "entity") return graphIconSeeds.edge.id;
  if (rangeType) return resolveTypeDefinitionIconId(rangeType);
  return graphIconSeeds.unknown.id;
}
