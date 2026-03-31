import {
  defineEnum,
  defineScalar,
  defineType,
  readDefinitionIconId,
  type AnyTypeOutput,
  type DefinitionIconRef,
  type EdgeOutput,
  type GraphIconSeedRecord,
} from "@io/graph-kernel";

import type { GraphBootstrapOptions } from "./contracts.js";

function defineGraphIconSeed(alias: string, name: string): GraphIconSeedRecord {
  return Object.freeze({
    id: `seed:icon:${alias}`,
    key: alias,
    name,
    svg: `<svg data-icon="${alias}"></svg>`,
  });
}

export const graphIconSeeds = {
  date: defineGraphIconSeed("date", "Date"),
  edge: defineGraphIconSeed("edge", "Edge"),
  icon: defineGraphIconSeed("icon", "Icon"),
  string: defineGraphIconSeed("string", "String"),
  svg: defineGraphIconSeed("svg", "SVG"),
  tag: defineGraphIconSeed("tag", "Tag"),
  unknown: defineGraphIconSeed("unknown", "Unknown"),
} as const;

export const graphIconSeedList = Object.values(graphIconSeeds);

function resolveDefinitionIconId(value: DefinitionIconRef | undefined): string {
  return readDefinitionIconId(value) ?? graphIconSeeds.unknown.id;
}

function resolveTypeDefinitionIconId(typeDef: Pick<AnyTypeOutput, "kind" | "values">): string {
  if (typeDef.values.icon) return resolveDefinitionIconId(typeDef.values.icon);
  if (typeDef.kind === "enum") return graphIconSeeds.tag.id;
  return graphIconSeeds.unknown.id;
}

function resolvePredicateDefinitionIconId(
  predicateDef: Pick<EdgeOutput, "icon" | "range">,
  rangeType?: Pick<AnyTypeOutput, "kind" | "values">,
): string {
  if (predicateDef.icon) return resolveDefinitionIconId(predicateDef.icon);
  if (rangeType?.kind === "entity") return graphIconSeeds.edge.id;
  if (rangeType) return resolveTypeDefinitionIconId(rangeType);
  return graphIconSeeds.unknown.id;
}

const string = defineScalar({
  values: { key: "core:string", name: "String", icon: graphIconSeeds.string.id },
  encode: (value: string) => value,
  decode: (raw) => raw,
});

const date = defineScalar({
  values: { key: "core:date", name: "Date", icon: graphIconSeeds.date.id },
  encode: (value: Date) => value.toISOString(),
  decode: (raw) => new Date(raw),
});

const svg = defineScalar({
  values: { key: "core:svg", name: "SVG", icon: graphIconSeeds.svg.id },
  encode: (value: string) => value,
  decode: (raw) => raw,
});

const cardinality = defineEnum({
  values: { key: "core:cardinality", name: "Cardinality" },
  options: {
    many: {
      id: "core:cardinality.many",
      name: "Many",
    },
    one: {
      id: "core:cardinality.one",
      name: "Exactly one",
    },
    oneOptional: {
      id: "core:cardinality.oneOptional",
      name: "Zero or one",
    },
  },
});

const node = defineType({
  values: { key: "core:node", name: "Node" },
  fields: {
    createdAt: {
      range: date,
      cardinality: "one",
      createOptional: true as const,
      icon: graphIconSeeds.date.id,
      onCreate: ({ incoming, now }) => incoming ?? now,
    },
    description: {
      range: string,
      cardinality: "one?",
      icon: graphIconSeeds.string.id,
    },
    name: {
      range: string,
      cardinality: "one",
      icon: graphIconSeeds.string.id,
    },
    type: {
      range: "core:type",
      cardinality: "many",
      icon: graphIconSeeds.edge.id,
    },
    updatedAt: {
      range: date,
      cardinality: "one",
      createOptional: true as const,
      icon: graphIconSeeds.date.id,
      onCreate: ({ incoming, now }) => incoming ?? now,
      onUpdate: ({ changedPredicateKeys, now }) =>
        [...changedPredicateKeys].some(
          (key) => !key.endsWith(":createdAt") && !key.endsWith(":updatedAt"),
        )
          ? now
          : undefined,
    },
  },
});

const icon = defineType({
  values: { key: "core:icon", name: "Icon", icon: graphIconSeeds.icon.id },
  fields: {
    ...node.fields,
    key: {
      range: string,
      cardinality: "one",
      icon: graphIconSeeds.string.id,
    },
    svg: {
      range: svg,
      cardinality: "one",
      icon: graphIconSeeds.svg.id,
    },
  },
});

const type = defineType({
  values: { key: "core:type", name: "Type", icon: graphIconSeeds.tag.id },
  fields: {
    ...node.fields,
    icon: {
      range: icon,
      cardinality: "one?",
      icon: graphIconSeeds.icon.id,
    },
  },
});

const predicate = defineType({
  values: { key: "core:predicate", name: "Predicate", icon: graphIconSeeds.edge.id },
  fields: {
    ...node.fields,
    cardinality: {
      range: cardinality,
      cardinality: "one",
      icon: graphIconSeeds.tag.id,
    },
    icon: {
      range: icon,
      cardinality: "one?",
      icon: graphIconSeeds.icon.id,
    },
    key: {
      range: string,
      cardinality: "one",
      icon: graphIconSeeds.string.id,
    },
    range: {
      range: string,
      cardinality: "one",
      icon: graphIconSeeds.string.id,
    },
  },
});

const enumType = defineType({
  values: { key: "core:enum", name: "Enum", icon: graphIconSeeds.tag.id },
  fields: {
    ...node.fields,
    member: {
      range: node,
      cardinality: "many",
      icon: graphIconSeeds.edge.id,
    },
  },
});

export const core = {
  cardinality,
  date,
  enum: enumType,
  icon,
  node,
  predicate,
  string,
  svg,
  type,
} as const;

export const coreGraphBootstrapOptions = Object.freeze({
  availableDefinitions: core,
  cacheKey: core,
  coreSchema: core,
  iconSeeds: graphIconSeedList,
  resolvePredicateIconId: resolvePredicateDefinitionIconId,
  resolveTypeIconId: resolveTypeDefinitionIconId,
}) satisfies GraphBootstrapOptions;

export const item = defineType({
  values: { key: "test:item", name: "Item" },
  fields: {
    ...core.node.fields,
    title: {
      range: core.string,
      cardinality: "one",
      icon: graphIconSeeds.string.id,
    },
  },
});

export const task = defineType({
  values: { key: "workflow:task", name: "Session", icon: graphIconSeeds.string.id },
  fields: {
    ...core.node.fields,
    dueAt: {
      range: core.date,
      cardinality: "one?",
      icon: graphIconSeeds.date.id,
    },
    title: {
      range: core.string,
      cardinality: "one",
      icon: graphIconSeeds.string.id,
    },
  },
});

export const testGraph = { item } as const;
export const testDefs = { ...core, ...testGraph } as const;
export const workflow = { task } as const;
export const bootstrapTimestampIso = "2000-01-01T00:00:00.000Z";
