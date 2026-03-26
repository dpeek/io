/**
 * Kernel storage primitives now live in `@io/graph-kernel`.
 *
 * This module remains as the local boundary import for higher runtime layers
 * that still live under `src/graph/runtime`.
 */
export {
  cloneGraphStoreSnapshot as cloneStoreSnapshot,
  createGraphStore as createStore,
  type EncodedValue,
  type GraphId,
  type GraphFact,
  type GraphStore,
  type GraphStoreSnapshot,
  type PredicateSlotListener,
} from "@io/graph-kernel";
