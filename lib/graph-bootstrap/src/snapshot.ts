import {
  cloneGraphStoreSnapshot,
  createGraphStore,
  type AnyTypeOutput,
  type GraphStoreSnapshot,
} from "@io/graph-kernel";

import { bootstrap } from "./bootstrap.js";
import type { GraphBootstrapOptions } from "./contracts.js";

const defaultBootstrapCacheKey = Object.freeze({});
const bootstrappedSnapshotCache = new WeakMap<
  Record<string, AnyTypeOutput>,
  WeakMap<object, GraphStoreSnapshot>
>();

/**
 * Creates a convergent schema snapshot suitable for local graph clients, sync
 * replay, and other client-safe bootstrap flows.
 */
export function createBootstrappedSnapshot<const T extends Record<string, AnyTypeOutput>>(
  definitions: T,
  options: GraphBootstrapOptions = {},
): GraphStoreSnapshot {
  const cacheKey =
    options.cacheKey ?? (Object.keys(options).length === 0 ? defaultBootstrapCacheKey : options);
  const shouldUseCache = options.timestamp === undefined;
  const cachedByDefinitions = shouldUseCache
    ? bootstrappedSnapshotCache.get(definitions)
    : undefined;
  const cached = shouldUseCache ? cachedByDefinitions?.get(cacheKey) : undefined;
  if (cached) return cloneGraphStoreSnapshot(cached);

  const store = createGraphStore();
  bootstrap(store, definitions, options);

  const snapshot = store.snapshot();
  if (shouldUseCache) {
    const nextCache = cachedByDefinitions ?? new WeakMap<object, GraphStoreSnapshot>();
    nextCache.set(cacheKey, snapshot);
    if (!cachedByDefinitions) {
      bootstrappedSnapshotCache.set(definitions, nextCache);
    }
  }
  return cloneGraphStoreSnapshot(snapshot);
}
