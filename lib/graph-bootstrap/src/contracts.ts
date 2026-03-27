import type { AnyTypeOutput, EdgeOutput, GraphIconSeedRecord } from "@io/graph-kernel";

import type { GraphBootstrapCoreSchema } from "./core-schema.js";

/**
 * Bootstrap consumes the shared seed-record contract but does not own a global
 * icon catalog. Callers supply domain-owned records through options.
 */
export type GraphBootstrapIconSeed = GraphIconSeedRecord;

export type GraphBootstrapTypeIconResolver = (
  typeDef: Pick<AnyTypeOutput, "kind" | "values">,
) => string | undefined;

export type GraphBootstrapPredicateIconResolver = (
  predicateDef: Pick<EdgeOutput, "icon" | "range">,
  rangeType?: Pick<AnyTypeOutput, "kind" | "values">,
) => string | undefined;

export type GraphBootstrapIconSeedResolver = (iconId: string) => GraphBootstrapIconSeed | undefined;

export type GraphBootstrapOptions = {
  /**
   * Additional definitions available for icon and scalar resolution when the
   * bootstrapped slice itself does not include every referenced type.
   */
  readonly availableDefinitions?: Record<string, AnyTypeOutput>;
  /**
   * Stable object identity used for snapshot cache hits when callers provide a
   * reusable bootstrap configuration.
   */
  readonly cacheKey?: object;
  /**
   * Explicit core schema contract for bootstrap flows whose definition slice
   * does not include the core namespace directly.
   */
  readonly coreSchema?: GraphBootstrapCoreSchema;
  /**
   * Concrete icon records owned by the caller's domain.
   */
  readonly iconSeeds?: readonly GraphBootstrapIconSeed[];
  /**
   * Optional per-id seed lookup for installable or remapped icon catalogs.
   */
  readonly resolveIconSeed?: GraphBootstrapIconSeedResolver;
  /**
   * Optional type-icon resolver. When omitted, bootstrap only links explicit
   * icon refs already authored on the type definition.
   */
  readonly resolveTypeIconId?: GraphBootstrapTypeIconResolver;
  /**
   * Optional predicate-icon resolver. When omitted, bootstrap only links
   * explicit predicate icon refs or existing range-type icon links.
   */
  readonly resolvePredicateIconId?: GraphBootstrapPredicateIconResolver;
  /**
   * Canonical timestamps applied to bootstrap-created schema entities when the
   * core node contract exposes managed timestamps.
   */
  readonly timestamp?: Date;
};
