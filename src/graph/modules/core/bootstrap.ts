import type { GraphBootstrapOptions } from "@io/graph-bootstrap";

import { core } from "../core.js";
import {
  graphIconSeedList,
  resolvePredicateDefinitionIconId,
  resolveTypeDefinitionIconId,
} from "./icon/seed.js";

/**
 * Domain-owned bootstrap adapter for the built-in core namespace.
 *
 * The concrete core icon catalog stays with the core module tree and plugs into
 * `@io/graph-bootstrap` through its public icon contracts.
 */
export const coreGraphBootstrapOptions = Object.freeze({
  availableDefinitions: core,
  cacheKey: core,
  coreSchema: core,
  iconSeeds: graphIconSeedList,
  resolvePredicateIconId: resolvePredicateDefinitionIconId,
  resolveTypeIconId: resolveTypeDefinitionIconId,
}) satisfies GraphBootstrapOptions;
