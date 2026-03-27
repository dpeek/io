/**
 * Curated graph bootstrap surface.
 *
 * `@io/graph-bootstrap` owns schema bootstrap into live stores and convergent
 * bootstrap snapshots. Implementation details stay in focused internal modules;
 * this entrypoint only re-exports the supported package contract.
 */
export { bootstrap } from "./bootstrap.js";
export { createBootstrappedSnapshot } from "./snapshot.js";
export type {
  GraphBootstrapIconSeed,
  GraphBootstrapIconSeedResolver,
  GraphBootstrapOptions,
  GraphBootstrapPredicateIconResolver,
  GraphBootstrapTypeIconResolver,
} from "./contracts.js";
export { requireGraphBootstrapCoreSchema, type GraphBootstrapCoreSchema } from "./core-schema.js";
