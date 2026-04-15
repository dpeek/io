import {
  edgeId,
  readDefinitionIconId,
  type AnyTypeOutput,
  type DefinitionIconRef,
  type EdgeOutput,
  type GraphStore,
  typeId,
} from "@dpeek/graphle-kernel";

import {
  assertBootstrapManagedTimestampsOnce,
  assertCurrentFactOnce,
  type BootstrapFacts,
} from "./bootstrap-facts.js";
import type {
  GraphBootstrapIconSeed,
  GraphBootstrapIconSeedResolver,
  GraphBootstrapOptions,
} from "./contracts.js";
import type { GraphBootstrapCoreSchema } from "./core-schema.js";

type GraphBootstrapIconCoreSchema = GraphBootstrapCoreSchema & {
  readonly icon: NonNullable<GraphBootstrapCoreSchema["icon"]>;
};

function isBootstrapIconSeed(value: unknown): value is GraphBootstrapIconSeed {
  const candidate = value as Partial<GraphBootstrapIconSeed> | undefined;
  return (
    typeof candidate?.id === "string" &&
    typeof candidate.key === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.svg === "string"
  );
}

function readDefinitionIconSeed(
  value: DefinitionIconRef | undefined,
): GraphBootstrapIconSeed | undefined {
  return isBootstrapIconSeed(value) ? value : undefined;
}

function collectInlineIconSeeds(
  types: readonly AnyTypeOutput[],
  predicates: readonly EdgeOutput[],
): Map<string, GraphBootstrapIconSeed> {
  const seeds = new Map<string, GraphBootstrapIconSeed>();

  for (const typeDef of types) {
    const seed = readDefinitionIconSeed(typeDef.values.icon);
    if (seed) seeds.set(seed.id, seed);
  }

  for (const predicateDef of predicates) {
    const seed = readDefinitionIconSeed(predicateDef.icon);
    if (seed) seeds.set(seed.id, seed);
  }

  return seeds;
}

export function createBootstrapIconSeedLookup(
  types: readonly AnyTypeOutput[],
  predicates: readonly EdgeOutput[],
  options: GraphBootstrapOptions,
): GraphBootstrapIconSeedResolver {
  const inlineSeeds = collectInlineIconSeeds(types, predicates);
  const seedById = new Map<string, GraphBootstrapIconSeed>(inlineSeeds);

  for (const seed of options.iconSeeds ?? []) {
    seedById.set(seed.id, seed);
  }

  return (iconId) => seedById.get(iconId) ?? options.resolveIconSeed?.(iconId);
}

export function resolveBootstrapTypeIconId(
  typeDef: AnyTypeOutput,
  options: GraphBootstrapOptions,
): string | undefined {
  return options.resolveTypeIconId?.(typeDef) ?? readDefinitionIconId(typeDef.values.icon);
}

export function resolveBootstrapPredicateIconId(
  store: GraphStore,
  predicateDef: EdgeOutput,
  rangeType: AnyTypeOutput | undefined,
  options: GraphBootstrapOptions,
  typeIconPredicateId?: string,
): string | undefined {
  const explicitIconId = readDefinitionIconId(predicateDef.icon);
  if (explicitIconId) {
    return options.resolvePredicateIconId?.(predicateDef, rangeType) ?? explicitIconId;
  }

  if (!rangeType && typeIconPredicateId) {
    const existingRangeIcon = store.facts(predicateDef.range, typeIconPredicateId)[0]?.o;
    if (typeof existingRangeIcon === "string" && existingRangeIcon.length > 0) {
      return existingRangeIcon;
    }
  }

  return options.resolvePredicateIconId?.(predicateDef, rangeType);
}

export function seedBootstrapIcon(
  store: GraphStore,
  bootstrapFacts: BootstrapFacts,
  coreSchema: GraphBootstrapIconCoreSchema,
  iconSeed: GraphBootstrapIconSeed,
  bootstrapTimestamp: Date,
  typeById: ReadonlyMap<string, AnyTypeOutput>,
): void {
  const shouldSeedManagedTimestamps = !bootstrapFacts.existingNodeIds.has(iconSeed.id);
  if (shouldSeedManagedTimestamps) {
    assertBootstrapManagedTimestampsOnce(
      store,
      bootstrapFacts,
      iconSeed.id,
      coreSchema,
      bootstrapTimestamp,
      typeById,
    );
  }

  const iconTypeId = typeId(coreSchema.icon);
  const iconKeyPredicateId = edgeId(coreSchema.icon.fields.key);
  const iconSvgPredicateId = edgeId(coreSchema.icon.fields.svg);
  const namePredicateId = edgeId(coreSchema.node.fields.name);
  const nodeTypePredicateId = edgeId(coreSchema.node.fields.type);

  assertCurrentFactOnce(store, bootstrapFacts, iconSeed.id, iconKeyPredicateId, iconSeed.key);
  assertCurrentFactOnce(store, bootstrapFacts, iconSeed.id, iconSvgPredicateId, iconSeed.svg);
  assertCurrentFactOnce(store, bootstrapFacts, iconSeed.id, namePredicateId, iconSeed.name);
  assertCurrentFactOnce(store, bootstrapFacts, iconSeed.id, nodeTypePredicateId, iconTypeId);
}
