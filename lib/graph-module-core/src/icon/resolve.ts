import {
  readDefinitionIconId,
  type AnyTypeOutput,
  type DefinitionIconRef,
  type EdgeOutput,
} from "@io/graph-kernel";

import { predicate } from "../core/predicate.js";
import { tag } from "../core/tag.js";
import { unknownIconSeed } from "./seed.js";

function resolveFallbackTagIconId(): string {
  return readDefinitionIconId(tag.values.icon) ?? unknownIconSeed.id;
}

function resolveFallbackEdgeIconId(): string {
  return readDefinitionIconId(predicate.values.icon) ?? unknownIconSeed.id;
}

export function resolveDefinitionIconId(value: DefinitionIconRef | undefined): string {
  return readDefinitionIconId(value) ?? unknownIconSeed.id;
}

/**
 * Default icon mapping for core-owned type definitions.
 */
export function resolveTypeDefinitionIconId(
  typeDef: Pick<AnyTypeOutput, "kind" | "values">,
): string {
  if (typeDef.values.icon) return resolveDefinitionIconId(typeDef.values.icon);
  if (typeDef.kind === "enum") return resolveFallbackTagIconId();
  return unknownIconSeed.id;
}

/**
 * Default icon mapping for core-owned predicate definitions.
 */
export function resolvePredicateDefinitionIconId(
  predicateDef: Pick<EdgeOutput, "icon" | "range">,
  rangeType?: Pick<AnyTypeOutput, "kind" | "values">,
): string {
  if (predicateDef.icon) return resolveDefinitionIconId(predicateDef.icon);
  if (rangeType?.kind === "entity") return resolveFallbackEdgeIconId();
  if (rangeType) return resolveTypeDefinitionIconId(rangeType);
  return unknownIconSeed.id;
}
